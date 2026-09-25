// =============================================================================
// check-image-sources —— 照片「唯一入库通道」的构建期兜底（decap-cms 任务 6）
//
// 为什么要有这个文件：
//   design §4 规定所有照片只能由 `npm run import`（scripts/import-photos.mjs）生成，
//   /admin 后台只动文字。配置侧已把上传口关死（public/admin/config.yml 顶部注释：
//   全站与 collection 两级都不设 media_folder + cover 用 string widget 而非 image widget），
//   但那终究是「CDN 上的第三方脚本 + 人」的行为。万一将来换 CMS 版本、迁 Sveltia、
//   或有人手工往仓库塞图，就会冒出「没有 EXIF sidecar 的图」——
//   那种图进不了灯箱、拿不到拍摄单，还会白白撑大仓库。
//   本脚本把约束变成**构建必然经过的硬检查**：发现非脚本来源图片 → 退出码 1，构建失败。
//
// 检查规则（都围绕「src/content 的照片必须出自脚本」）：
//   R1 结构    src/content 下的图片必须位于 <集合>/<条目>/photos/ 里
//   R2 sidecar photos/ 必须与同级 photos.meta.json 成对出现；sidecar 必须是 PhotoEntry 数组
//   R3 来源    photos/ 里每个文件都要在 sidecar 的 file / thumb 里登记（脚本产物必登记）
//   R4 反向    sidecar 登记的 file / thumb 在磁盘上必须真的存在
//   R5 public  public/ 下不许出现图片（照片通道只有 src/content；站点图标需显式加白名单）
//
// 结构（照 import-photos.mjs 的口径：纯函数 + I/O 分离，便于 Vitest 真断言）：
//   纯函数：isImageFile / photoOwnershipOf / auditImageSources / parseArgs
//   I/O  ：walkFiles / collectImageSources / runCheck（编排 + 打印） / main（CLI）
// 被 import 时不执行 CLI；`node scripts/check-image-sources.mjs` 才进命令行。
// =============================================================================

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 认定为「图片」的扩展名（比较时统一小写）。含原图格式，免得有人把 raw 拷进内容夹。 */
export const IMAGE_EXTENSIONS = Object.freeze([
  '.webp',
  '.avif',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.svg',
  '.ico',
]);

/** sidecar 固定文件名（与 src/types/photoSidecar.ts、import-photos.mjs 同口径）。 */
export const SIDECAR_FILE = 'photos.meta.json';

/** 内容根（相对仓库根，恒用正斜杠）。 */
export const CONTENT_ROOT = 'src/content';

/** 内容根前缀（判断「是否内容图片」与剥前缀都用它，避免出现第二种口径）。 */
const CONTENT_PREFIX = CONTENT_ROOT + '/';

/** 照片资源夹的固定名字（import-photos 的落位口径：<条目>/photos/<base>.webp）。 */
export const PHOTOS_DIR = 'photos';

/** 站点静态目录：照片不走这里。确需放 favicon 之类的站点图标时，在这里点名放行。 */
export const ALLOWED_PUBLIC_IMAGES = Object.freeze([]);

/** 被扫描的两个根目录（相对仓库根）。 */
export const SCAN_ROOTS = Object.freeze([CONTENT_ROOT, 'public']);

/** @param {string} name 文件名或路径 @returns {boolean} 是否图片扩展名 */
export function isImageFile(name) {
  const lower = String(name).toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 判定一张「src/content 下的图片」的归属。
 *
 * @param {string} relPath 仓库根相对路径（反斜杠会被归一成正斜杠）
 * @returns {{ entryDir: string, relInEntry: string, inPhotosDir: boolean }}
 *   - 形如 src/content/series/city-lights/photos/night-01.webp
 *     → { entryDir: 'series/city-lights', relInEntry: 'photos/night-01.webp', inPhotosDir: true }
 *   - 不在 photos/ 下（或不在 src/content 下）→ inPhotosDir: false，
 *     entryDir 取其所在目录（相对 src/content），relInEntry 为文件名。
 */
export function photoOwnershipOf(relPath) {
  const posix = String(relPath).replace(/\\/g, '/');
  if (!posix.startsWith(CONTENT_PREFIX)) {
    return { entryDir: '', relInEntry: '', inPhotosDir: false };
  }
  const parts = posix.slice(CONTENT_PREFIX.length).split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || '';
  const photosAt = parts.lastIndexOf(PHOTOS_DIR);
  const inPhotosDir = photosAt >= 1 && photosAt === parts.length - 2;
  if (!inPhotosDir) {
    return { entryDir: parts.slice(0, -1).join('/'), relInEntry: fileName, inPhotosDir: false };
  }
  return {
    entryDir: parts.slice(0, photosAt).join('/'),
    relInEntry: parts.slice(photosAt).join('/'),
    inPhotosDir: true,
  };
}

/** sidecar 里的值（photos/a.webp、./photos/a.webp）归一成与磁盘扫描同口径的键。 */
function normalizeDeclared(value) {
  return String(value).replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * 核心审计：纯数据进、中文违规清单出，不碰文件系统（Vitest 直接喂夹具断言这段）。
 *
 * @param {{ files: string[], sidecars: Record<string, unknown> }} input
 *   files    —— 仓库根相对路径清单（含 src/content 与 public 下的全部文件）
 *   sidecars —— 键为**相对 src/content** 的 sidecar 路径（如 'series/city-lights/photos.meta.json'），
 *               值为 JSON.parse 结果；解析失败时传 { __parseError: true }
 * @returns {{ violations: string[], checkedImages: number }} violations 为空即通过。
 */
export function auditImageSources({ files, sidecars }) {
  /** @type {string[]} */
  const violations = [];
  const all = (files || []).map((f) => String(f).replace(/\\/g, '/'));
  const imageFiles = all.filter(isImageFile);

  // ── R5：public/ 下不得出现图片（后台若被绕过、上传落到 public/，这里立刻炸）
  for (const rel of imageFiles) {
    if (!rel.startsWith('public/')) continue;
    if (ALLOWED_PUBLIC_IMAGES.includes(rel)) continue;
    violations.push(
      `R5 public/ 下出现图片 ${rel}：站点图片请放 src/assets，内容照片走 npm run import；` +
        '确需的站点图标（favicon 等）请显式加进 scripts/check-image-sources.mjs 的 ALLOWED_PUBLIC_IMAGES。',
    );
  }

  const contentImages = imageFiles.filter((rel) => rel.startsWith(CONTENT_ROOT + '/'));

  /** entryDir -> Set<'photos/xxx.webp'>（磁盘上真实存在的照片） */
  const photosByEntry = new Map();
  /** @type {{ rel: string, entryDir: string }[]} */
  const stray = [];

  for (const rel of contentImages) {
    const own = photoOwnershipOf(rel);
    if (own.inPhotosDir) {
      const set = photosByEntry.get(own.entryDir) || new Set();
      set.add(own.relInEntry);
      photosByEntry.set(own.entryDir, set);
    } else {
      stray.push({ rel, entryDir: own.entryDir });
    }
  }

  // ── R1：src/content 里的图片必须落在 <条目>/photos/ 下
  for (const item of stray) {
    violations.push(
      `R1 非脚本来源的图片：${item.rel}` +
        `（src/content 下的照片必须位于 <集合>/<条目>/${PHOTOS_DIR}/ 里，由 npm run import 产出）。`,
    );
  }

  /** 归一 sidecar 表（键去掉内容根前缀，容忍传入绝对内容路径） */
  const parsedSidecars = new Map();
  for (const [key, raw] of Object.entries(sidecars || {})) {
    const posix = String(key).replace(/\\/g, '/');
    parsedSidecars.set(
      posix.startsWith(CONTENT_PREFIX) ? posix.slice(CONTENT_PREFIX.length) : posix,
      raw,
    );
  }

  /** 条目全集 = 有照片的 ∪ 有 sidecar 的 ∪ 有散图的 */
  const entries = new Set(photosByEntry.keys());
  for (const sidecarPath of parsedSidecars.keys()) {
    if (sidecarPath.endsWith('/' + SIDECAR_FILE)) {
      entries.add(sidecarPath.slice(0, -('/' + SIDECAR_FILE).length));
    }
  }
  for (const item of stray) if (item.entryDir) entries.add(item.entryDir);

  for (const entryDir of entries) {
    const sidecarPath = entryDir ? `${entryDir}/${SIDECAR_FILE}` : SIDECAR_FILE;
    const onDisk = photosByEntry.get(entryDir) || new Set();

    // ── R2a：有 photos/ 却没 sidecar
    if (onDisk.size > 0 && !parsedSidecars.has(sidecarPath)) {
      violations.push(
        `R2 ${entryDir}/${PHOTOS_DIR}/ 里有 ${onDisk.size} 个文件，但同级缺 ${SIDECAR_FILE}：` +
          '照片与 EXIF 必须成对（重跑 npm run import 生成）。',
      );
      continue;
    }
    if (!parsedSidecars.has(sidecarPath)) continue;

    const sidecar = parsedSidecars.get(sidecarPath);
    // ── R2b：sidecar 存在但不是 PhotoEntry 数组
    if (!Array.isArray(sidecar)) {
      violations.push(
        `R2 ${sidecarPath} 不是合法的 PhotoEntry 数组（契约见 src/types/photoSidecar.ts）。`,
      );
      continue;
    }

    /** sidecar 登记过的路径集合（photos/xxx.webp 口径） */
    const declared = new Set();
    sidecar.forEach((item, index) => {
      const record = item && typeof item === 'object' ? item : {};
      for (const key of ['file', 'thumb']) {
        const value = record[key];
        if (typeof value !== 'string' || value.length === 0) continue;
        const normalized = normalizeDeclared(value);
        declared.add(normalized);
        // ── R4：登记了就得磁盘上真有
        if (!onDisk.has(normalized)) {
          violations.push(
            `R4 ${sidecarPath}[${index}].${key} 指向 ${value}，但 ${entryDir}/${PHOTOS_DIR}/ 下没有这个文件：` +
              '照片被改名或删过，重跑 npm run import 回填。',
          );
        }
      }
    });

    // ── R3：photos/ 里每个文件都得被 sidecar 认领（脚本产物一定被认领）
    for (const relInEntry of onDisk) {
      if (!declared.has(relInEntry)) {
        violations.push(
          `R3 ${CONTENT_ROOT}/${entryDir}/${relInEntry} 未被 ${sidecarPath} 登记：` +
            '它不是 npm run import 的产物（后台没有上传口，照片不该从别处进来）。',
        );
      }
    }
  }

  return { violations, checkedImages: contentImages.length };
}

// -----------------------------------------------------------------------------
// I/O 区
// -----------------------------------------------------------------------------

/** 递归列目录，返回仓库根相对、正斜杠路径的文件清单；目录不存在返回空数组。 */
export async function walkFiles(root, relDir) {
  const abs = path.join(root, relDir);
  /** @type {string[]} */
  const out = [];
  /** @type {import('node:fs').Dirent[] | undefined} */
  let dirents;
  try {
    dirents = await fsp.readdir(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    const rel = `${relDir}/${d.name}`;
    if (d.isDirectory()) out.push(...(await walkFiles(root, rel)));
    else out.push(rel);
  }
  return out;
}

/** 走盘：收集扫描根下的全部文件 + 解析每个 photos.meta.json（键相对 src/content）。 */
export async function collectImageSources(root) {
  /** @type {string[]} */
  const files = [];
  for (const relDir of SCAN_ROOTS) files.push(...(await walkFiles(root, relDir)));

  /** @type {Record<string, unknown>} */
  const sidecars = {};
  for (const rel of files) {
    if (!rel.startsWith(CONTENT_PREFIX) || !rel.endsWith('/' + SIDECAR_FILE)) continue;
    try {
      sidecars[rel.slice(CONTENT_PREFIX.length)] = JSON.parse(
        await fsp.readFile(path.join(root, rel), 'utf8'),
      );
    } catch (err) {
      sidecars[rel.slice(CONTENT_PREFIX.length)] = {
        __parseError: true,
        message: String(err && err.message ? err.message : err),
      };
    }
  }
  return { files, sidecars };
}

/**
 * 编排：收集 + 审计 + 打印。返回退出码（0 通过 / 1 有违规）。
 * @param {{ root?: string, log?: (line: string) => void, quietOnPass?: boolean }} [options]
 */
export async function runCheck(options = {}) {
  const root = options.root || fileURLToPath(new URL('..', import.meta.url));
  const log = options.log || ((line) => console.log(line));
  const { files, sidecars } = await collectImageSources(root);
  const { violations, checkedImages } = auditImageSources({ files, sidecars });

  if (violations.length === 0) {
    if (!options.quietOnPass) {
      log(
        `[check-image-sources] 通过：${checkedImages} 张内容图片都有 sidecar 登记（照片只出自 npm run import）。`,
      );
    }
    return 0;
  }
  log(`[check-image-sources] 发现 ${violations.length} 个图片来源问题（照片必须由 scripts/import-photos.mjs 入库）：`);
  for (const line of violations) log(`[check-image-sources]   - ${line}`);
  log(
    '[check-image-sources]   处理办法：删掉这些从别处进来的图片；要加照片就回本地跑 ' +
      'npm run import（随笔用 npm run import -- --post <日期-标题>）。',
  );
  return 1;
}

const HELP_TEXT = [
  '用法：npm run check-images   （或 node scripts/check-image-sources.mjs [--root <目录>] [--quiet])',
  '',
  '扫描 src/content 与 public，确认每张内容图片都出自 npm run import：',
  '  R1 图片必须位于 <集合>/<条目>/photos/ 下',
  '  R2 photos/ 必须与同级 photos.meta.json 成对，且 sidecar 是 PhotoEntry 数组',
  '  R3 photos/ 里每个文件都要被 sidecar 的 file / thumb 登记',
  '  R4 sidecar 登记的 file / thumb 磁盘上必须真的存在',
  '  R5 public/ 下不得出现图片（站点图标需加 ALLOWED_PUBLIC_IMAGES 白名单）',
  '',
  '这是 /admin 后台「禁上传」的构建期兜底（design §4 / decap-cms 任务 6）。',
  '退出码 0 = 通过；1 = 存在非脚本来源图片（prebuild 会因此中断构建）。',
].join('\n');

/** 解析命令行参数：只认 --help / --quiet / --root <dir>。 */
export function parseArgs(argv) {
  const parsed = { help: false, quiet: false, root: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--quiet' || arg === '-q') parsed.quiet = true;
    else if (arg === '--root') {
      i += 1;
      parsed.root = argv[i] ? path.resolve(argv[i]) : null;
    }
  }
  return parsed;
}

/** CLI 编排（与 import-photos.mjs 同形状：返回退出码，不自己 process.exit）。 */
export async function runCli(argv, io = {}) {
  const log = io.log || ((line) => console.log(line));
  const parsed = parseArgs(argv);
  if (parsed.help) {
    log(HELP_TEXT);
    return 0;
  }
  return runCheck({ root: parsed.root || undefined, log, quietOnPass: parsed.quiet });
}

async function main() {
  process.exitCode = await runCli(process.argv.slice(2));
}

// 只有「直接跑本文件」时才进 CLI；被 Vitest 或其他模块 import 时不执行。
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  await main();
}
