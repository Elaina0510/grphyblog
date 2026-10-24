// =============================================================================
// check-image-sources —— 照片「唯一入库通道 + 池化落位」的构建期硬检查
//                            （admin-v2.md C 组：照片池化改造 v0.1.1）
//
// 为什么要有这个文件：
//   design §4 规定所有照片只能由 `npm run import`（scripts/import-photos.mjs）生成，
//   /admin 后台只动文字与「挑哪张已入库的图当封面 / 插图」。
//   池化后照片唯一位置是 src/content/pool/photos/、唯一元数据是 pool/photos.meta.json，
//   后台（自建单页）的封面对话框只从这个池里挑图，不带上传入口；
//   浏览器直传那条通道（E6）走 Canvas 重编码后同样落进池并登记 sidecar。
//   所以本脚本是这条红线的**唯一防线**：任何从别处进来的图都没有 sidecar 登记，
//   命中下面任一条即退出码 1，Pages 构建失败 → 进不了生产。
//   那种图也进不了灯箱、拿不到拍摄单，还会白白撑大仓库。
//
// 池化口径（admin-v2.md A1/A2/A3/A4/A5）：
//   照片唯一位置：src/content/pool/photos/（展示版 + 缩略图同目录，全站唯一收纳处）
//   唯一元数据  ：src/content/pool/photos.meta.json（PhotoEntry 数组，全局一份）
//   条目侧只存照片 ID（frontmatter 的 photos[] / cover，ID = 池内完整文件名含 .webp）。
//
// 检查规则：
//   R1 落位    src/content 下的图片只能位于 src/content/pool/photos/；
//              其余任何位置（旧 <集合>/<条目>/photos/、条目目录根、src/content 根…）
//              出现图片即违规。**只认图片扩展名**，故 pool/photos.meta.json 不会被误伤（K5）。
//   R2 成对    全局 sidecar 必须存在且是 PhotoEntry 数组（解析失败 / 非数组皆违规）；
//              池化后只允许这一份 sidecar，旧的逐条目 photos.meta.json 残留也违规。
//   R3 认领    pool/photos/ 里每个文件（含 .thumb.webp 复合后缀）都要被 sidecar 的
//              file / thumb 登记 —— 脚本产物一定被登记，没登记的就是脚本外来的图。
//   R4 反查    sidecar 登记的 file / thumb 在磁盘上必须真的存在（改名/删图后的死链）。
//   R5 public  public/ 下不许出现图片（站点图标需显式加进 ALLOWED_PUBLIC_IMAGES）。
//   R6 引用    条目 frontmatter 的 photos[] 里每个 ID 必须是池内**展示版** ID；
//              cover 非空串时同样只认展示版（空串合法 = 不指定封面，走 A5 三级回退）。
//              刻意不收缩略图 ID：前台 findPoolPhoto 只按 sidecar 的 file 末段匹配，
//              引用 `xxx.thumb.webp` 会静默查不到（封面/照片流消失且不报错），比构建失败更坏。
//
// 结构（照 import-photos.mjs 的口径：纯函数 + I/O 分离，便于 Vitest 真断言）：
//   纯函数：isImageFile / poolPhotoIdOf / splitFrontmatter / parseFrontmatterMeta /
//           auditImageSources / parseArgs
//   I/O  ：walkFiles / collectImageSources / runCheck（编排 + 打印） / runCli / main
// 被 import 时不执行 CLI；`node scripts/check-image-sources.mjs` 才进命令行。
// 本脚本只读不写（与 import-photos.mjs 的「原图不动」同一条红线，有单测钉住）。
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

/** 内容根前缀（判断「是否内容文件」与剥前缀都用它，避免出现第二种口径）。 */
const CONTENT_PREFIX = CONTENT_ROOT + '/';

/** 照片池目录（池化后内容照片的唯一收纳处）。 */
export const POOL_DIR = CONTENT_ROOT + '/pool';

/** 池内照片目录（展示版 + 缩略图同放这里）。 */
export const POOL_PHOTOS_DIR = POOL_DIR + '/photos';

/** 池内照片目录前缀（判落位用）。 */
const POOL_PHOTOS_PREFIX = POOL_PHOTOS_DIR + '/';

/** 全局 sidecar 的仓库根相对路径。 */
export const POOL_SIDECAR_PATH = POOL_DIR + '/' + SIDECAR_FILE;

/** 全局 sidecar 相对 src/content 的键（auditImageSources 的 sidecars 表统一用这个口径）。 */
const POOL_SIDECAR_KEY = 'pool/' + SIDECAR_FILE;

/** sidecar 内 file/thumb 的路径前缀（契约：恒为 photos/<basename>）。 */
export const PHOTOS_DIR_NAME = 'photos';

/** 站点静态目录：照片不走这里。确需放 favicon 之类的站点图标时，在这里点名放行。 */
export const ALLOWED_PUBLIC_IMAGES = Object.freeze([]);

/** 被扫描的两个根目录（相对仓库根）。 */
export const SCAN_ROOTS = Object.freeze([CONTENT_ROOT, 'public']);

/** 被扫描 frontmatter 的两个条目集合：series/<标识>/index.md 与 posts/<日期-标题>.md。 */
export const ENTRY_ROOTS = Object.freeze(['series', 'posts']);

/** 路径归一：反斜杠 → 正斜杠（Windows 工具链也要吃得下）。 */
function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

/** @param {string} name 文件名或路径 @returns {boolean} 是否图片扩展名 */
export function isImageFile(name) {
  const lower = String(name).toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 判定一张「src/content 下的图片」的池内身份。
 * @param {string} relPath 仓库根相对路径（反斜杠会被归一成正斜杠）
 * @returns {string|null} 池内相对路径（= 该图的展示版/缩略版 ID），不在 pool/photos/ 下返回 null
 *   例：src/content/pool/photos/night-01.webp → 'night-01.webp'
 *       src/content/series/city-lights/photos/night-01.webp → null（旧布局，R1 拦）
 */
export function poolPhotoIdOf(relPath) {
  const posix = toPosix(relPath);
  if (!posix.startsWith(POOL_PHOTOS_PREFIX)) return null;
  const rest = posix.slice(POOL_PHOTOS_PREFIX.length);
  return rest.length > 0 ? rest : null;
}

/**
 * 把 sidecar 里的 file/thumb 值归一成「池内相对路径」（与磁盘扫描同口径）。
 * 契约写的是 photos/<basename>.webp；这里同时容忍 ./photos/x、/photos/x 与裸文件名 x，
 * 免得旧产物因一个前缀差异被误报成 R4 死链（但不做扩展名/大小写之类的猜测）。
 */
function normalizeDeclaredPath(value) {
  let out = toPosix(value).trim();
  while (out.startsWith('./')) out = out.slice(2);
  out = out.replace(/^\/+/, '');
  if (out === PHOTOS_DIR_NAME) return '';
  if (out.startsWith(PHOTOS_DIR_NAME + '/')) out = out.slice(PHOTOS_DIR_NAME.length + 1);
  return out;
}

// -----------------------------------------------------------------------------
// frontmatter 轻量解析（不引第三方 YAML 库；行尾 CRLF/LF 混排都要吃得下）
// -----------------------------------------------------------------------------

/**
 * 取出第一个 `---` 分隔块的内容（不含首尾分隔线）。
 * @param {string} source 文件全文
 * @returns {string|null} 无 frontmatter 返回 null；有空 frontmatter 返回 ''（不是 null）
 */
export function splitFrontmatter(source) {
  const text = String(source ?? '').replace(/^\uFEFF/, '');
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) return null;
  const rest = text.slice(open[0].length);
  // 空 frontmatter：开线之后紧接着就是收线
  if (/^---[ \t]*(?:\r?\n|$)/.test(rest)) return '';
  const close = /\r?\n---[ \t]*(?=\r?\n|$)/.exec(rest);
  if (!close) return null;
  return rest.slice(0, close.index);
}

/** 去掉 YAML 标量两端的引号（单/双引号），'' 与 "" 归一成空串。 */
function unquoteScalar(raw) {
  const value = String(raw ?? '').trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

/** 解析 `[a, b]` 形式的行内列表；`[]` → 空数组。 */
function parseFlowList(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((item) => unquoteScalar(item))
    .filter((item) => item.length > 0);
}

/**
 * 从 frontmatter 里取检查要用的两个字段：`photos`（照片 ID 列表）与 `cover`（照片 ID 或空串）。
 *
 * 只做本检查需要的极窄解析（键在行首 + 块列表 / 行内列表），刻意不实现通用 YAML：
 * 键的合法性由 Astro 的 zod schema 负责，这里只负责「引用有没有指向池里的真图」。
 *
 * @param {string} source 文件全文（md 原文，CRLF/LF 混排均可）
 * @returns {{ hasFrontmatter: boolean, cover: string, photos: string[] }}
 */
export function parseFrontmatterMeta(source) {
  const block = splitFrontmatter(source);
  if (block === null) return { hasFrontmatter: false, cover: '', photos: [] };

  const lines = block.split(/\r?\n/);
  let cover = '';
  let photos = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const coverLine = /^cover[ \t]*:[ \t]*(.*)$/.exec(line);
    if (coverLine) {
      cover = unquoteScalar(coverLine[1]);
      continue;
    }

    const photosLine = /^photos[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!photosLine) continue;

    const inline = photosLine[1].trim();
    if (inline.length > 0) {
      photos = parseFlowList(inline);
      continue;
    }

    // 块列表：紧随其后的 `- xxx` 行；遇到第一个非列表行即结束（后面的 tags 之类不受影响）
    const collected = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = /^[ \t]*-[ \t]*(.*)$/.exec(lines[j]);
      if (!item) break;
      const value = unquoteScalar(item[1]);
      if (value.length > 0) collected.push(value);
    }
    photos = collected;
  }

  return { hasFrontmatter: true, cover, photos };
}

/** 是否「条目 markdown」：series/<标识>/index.md 或 posts/<日期-标题>.md。 */
export function isEntryMarkdown(relPath) {
  const posix = toPosix(relPath);
  if (!posix.startsWith(CONTENT_PREFIX) || !posix.toLowerCase().endsWith('.md')) return false;
  const parts = posix.slice(CONTENT_PREFIX.length).split('/');
  if (parts.length === 3 && parts[0] === 'series' && parts[2] === 'index.md') return true;
  if (parts.length === 2 && parts[0] === 'posts') return true;
  return false;
}

// -----------------------------------------------------------------------------
// 核心审计（纯函数）
// -----------------------------------------------------------------------------

/**
 * 核心审计：纯数据进、中文违规清单出，不碰文件系统（Vitest 直接喂夹具断言这段）。
 *
 * @param {{
 *   files?: string[],
 *   sidecars?: Record<string, unknown>,
 *   entries?: { path: string, cover?: string, photos?: string[] }[],
 * }} input
 *   files    —— 仓库根相对路径清单（含 src/content 与 public 下的全部文件）
 *   sidecars —— 键为**相对 src/content** 的 sidecar 路径（全局那份是 'pool/photos.meta.json'），
 *               值为 JSON.parse 结果；解析失败时传 { __parseError: true }
 *   entries  —— 条目 frontmatter 摘要（path 为仓库根相对路径，photos/cover 见 parseFrontmatterMeta）
 * @returns {{ violations: string[], checkedImages: number }} violations 为空即通过。
 */
export function auditImageSources({ files, sidecars, entries } = {}) {
  /** @type {string[]} */
  const violations = [];
  const all = (files || []).map(toPosix);
  const imageFiles = all.filter(isImageFile);

  // ── R5：public/ 下不得出现图片（后台若被绕过、直传落到 public/，这里立刻炸）
  for (const rel of imageFiles) {
    if (!rel.startsWith('public/')) continue;
    if (ALLOWED_PUBLIC_IMAGES.includes(rel)) continue;
    violations.push(
      `R5 public/ 下出现图片 ${rel}：内容照片只能放 ${POOL_PHOTOS_DIR}/ 并由 npm run import 入库；` +
        '确需的站点图标（favicon 等）请显式加进 scripts/check-image-sources.mjs 的 ALLOWED_PUBLIC_IMAGES。',
    );
  }

  const contentImages = imageFiles.filter((rel) => rel.startsWith(CONTENT_PREFIX));

  // ── R1：src/content 下的图片只能在 pool/photos/ 里（旧布局一律拦下）
  /** 池内相对路径 → 仓库根相对路径（磁盘上真实存在的池内文件） */
  const poolPhotos = new Map();
  for (const rel of contentImages) {
    const id = poolPhotoIdOf(rel);
    if (id === null) {
      violations.push(
        `R1 图片落位不对：${rel}（照片池化后 src/content 下的图片只能位于 ${POOL_PHOTOS_DIR}/，` +
          '旧的 <集合>/<条目>/photos/ 布局已废弃；要加照片就回本地跑 npm run import）。',
      );
      continue;
    }
    poolPhotos.set(id, rel);
  }

  // ── sidecar 表归一（键去掉内容根前缀，容忍传入带前缀的路径）
  const declaredSidecars = new Map();
  for (const [key, raw] of Object.entries(sidecars || {})) {
    const posix = toPosix(key);
    declaredSidecars.set(
      posix.startsWith(CONTENT_PREFIX) ? posix.slice(CONTENT_PREFIX.length) : posix,
      raw,
    );
  }

  // ── R2c：池化后只允许一份全局 sidecar（旧的逐条目 photos.meta.json 残留要清掉）
  for (const key of declaredSidecars.keys()) {
    if (key === POOL_SIDECAR_KEY) continue;
    violations.push(
      `R2 池化后只允许一份全局 sidecar（${POOL_SIDECAR_PATH}）：发现多余的 ${CONTENT_ROOT}/${key}。` +
        '逐条目 sidecar 已随迁移合并，请删除这个残留文件。',
    );
  }

  const hasPoolSidecar = declaredSidecars.has(POOL_SIDECAR_KEY);
  const poolSidecar = hasPoolSidecar ? declaredSidecars.get(POOL_SIDECAR_KEY) : undefined;
  const sidecarIsArray = Array.isArray(poolSidecar);

  // ── R2a：池里有照片却没 sidecar
  if (!hasPoolSidecar) {
    if (poolPhotos.size > 0) {
      violations.push(
        `R2 ${POOL_PHOTOS_DIR}/ 里有 ${poolPhotos.size} 个文件，但缺全局 sidecar ${POOL_SIDECAR_PATH}：` +
          '照片与 EXIF 必须成对（重跑 npm run import -- --pool 生成）。',
      );
    }
  } else if (!sidecarIsArray) {
    // ── R2b：sidecar 存在但不是 PhotoEntry 数组（含 JSON 解析失败）
    const parseMessage =
      poolSidecar && typeof poolSidecar === 'object' && poolSidecar.__parseError
        ? `（JSON 解析失败：${poolSidecar.message || '未知原因'}）`
        : `（实际是 ${typeof poolSidecar}）`;
    violations.push(
      `R2 ${POOL_SIDECAR_PATH} 不是合法的 PhotoEntry 数组${parseMessage}：` +
        '契约见 src/types/photoSidecar.ts。',
    );
  }

  /**
   * sidecar 登记过的池内路径集合（展示版 + 缩略图，都是 sidecar 的一份存档）→ R3/R4 用。
   * displayIds 单独收**展示版** ID（`file` 末段）→ R6 用。
   * 为什么分两个集合：frontmatter 的 photos[] / cover 只能引用展示版（前台 findPoolPhoto 只按
   * file 末段匹配）。若把它们混在一起，`xxx.thumb.webp` 会被误判成「已登记」而放行，
   * 结果封面与照片流静默消失、且不报任何错——那是比构建失败更坏的故障。
   */
  const declaredIds = new Set();
  const displayIds = new Set();
  if (sidecarIsArray) {
    poolSidecar.forEach((item, index) => {
      const record = item && typeof item === 'object' ? item : {};
      for (const key of ['file', 'thumb']) {
        const value = record[key];
        if (typeof value !== 'string' || value.length === 0) continue;
        const normalized = normalizeDeclaredPath(value);
        if (normalized.length === 0) continue;
        declaredIds.add(normalized);
        // 展示版 ID 单独收（R6 的判据）：thumb 字段不进这个集合。
        // sidecar 的 file 是池内相对路径（photos/night-01.webp），取末段文件名即照片 ID；
        // 这里不能用 poolPhotoIdOf——它判的是「仓库根相对路径且必须在 pool/photos/ 下」，
        // 喂 sidecar 的相对路径会一律返回 null。
        if (key === 'file') displayIds.add(path.basename(toPosix(value)));
        // ── R4：登记了就得磁盘上真有
        if (!poolPhotos.has(normalized)) {
          violations.push(
            `R4 ${POOL_SIDECAR_PATH}[${index}].${key} 指向 ${value}，但 ${POOL_PHOTOS_DIR}/ 下没有这个文件：` +
              '照片被改名、删过，或 sidecar 是手改的；重跑 npm run import -- --pool 回填。',
          );
        }
      }
    });

    // ── R3：pool/photos/ 里每个文件都得被 sidecar 认领（脚本产物一定被认领）
    for (const [id, rel] of poolPhotos) {
      if (declaredIds.has(id)) continue;
      violations.push(
        `R3 ${rel} 未被 ${POOL_SIDECAR_PATH} 登记：它不是 npm run import 的产物` +
          '（后台直传/手工拷入的图没有 EXIF，也进不了灯箱）。要加照片就回本地跑 npm run import -- --pool。',
      );
    }
  }

  // ── R6：条目 frontmatter 的照片引用必须在池里有真身
  // sidecar 本身不合法时（R2 已红）跳过 R6，避免「一份坏 JSON 导致所有条目引用全报」的噪音。
  if (sidecarIsArray) {
    for (const entry of entries || []) {
      const entryPath = toPosix(entry && entry.path ? entry.path : '<未知条目>');
      const photos = Array.isArray(entry && entry.photos) ? entry.photos : [];
      photos.forEach((rawId, index) => {
        const id = String(rawId ?? '').trim();
        // 判据是展示版 ID（displayIds），不是 declaredIds——后者含缩略图，
        // 会把 `xxx.thumb.webp` 误判成合法引用（前台查不到，静默丢图）。
        if (displayIds.has(id)) return;
        violations.push(
          `R6 ${entryPath} 的 photos[${index}] = ${JSON.stringify(id)} 不是池内已有照片 ID` +
            `${describeIdHint(id)}：前台会指向空图。改正 ID，或把这张图补进池（npm run import -- --pool）。`,
        );
      });

      const cover = typeof (entry && entry.cover) === 'string' ? entry.cover.trim() : '';
      // 空串合法：A5 三级回退（cover → photos[0] → 整块封面不渲染）
      if (cover.length === 0) continue;
      if (displayIds.has(cover)) continue;
      violations.push(
        `R6 ${entryPath} 的 cover = ${JSON.stringify(cover)} 不是池内已有照片 ID` +
          `${describeIdHint(cover)}：封面会指向空图。请改成池内照片 ID，或置空串（空串 = 不指定封面，前台退回 photos[0]）。`,
      );
    }
  }

  return { violations, checkedImages: contentImages.length };
}

/** 常见误写提示：照片 ID 是完整文件名，不带 photos/ 前缀。 */
function describeIdHint(id) {
  const normalized = normalizeDeclaredPath(id);
  if (normalized !== id && normalized.length > 0) {
    return `（照片 ID 是池内完整文件名，写成 "${normalized}" 而不是 "${id}"）`;
  }
  if (id.toLowerCase().endsWith('.thumb.webp')) {
    return '（这里应填展示版 ID，不是缩略图文件名）';
  }
  return '';
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

/**
 * 走盘：收集扫描根下的全部文件、解析每个 photos.meta.json（键相对 src/content）、
 * 读出条目 markdown 的 frontmatter 摘要。
 */
export async function collectImageSources(root) {
  /** @type {string[]} */
  const files = [];
  for (const relDir of SCAN_ROOTS) files.push(...(await walkFiles(root, relDir)));

  /** @type {Record<string, unknown>} */
  const sidecars = {};
  /** @type {{ path: string, hasFrontmatter: boolean, cover: string, photos: string[] }[]} */
  const entries = [];

  for (const rel of files) {
    if (!rel.startsWith(CONTENT_PREFIX)) continue;
    const fileName = rel.slice(rel.lastIndexOf('/') + 1);
    const key = rel.slice(CONTENT_PREFIX.length);

    if (fileName === SIDECAR_FILE) {
      try {
        sidecars[key] = JSON.parse(await fsp.readFile(path.join(root, rel), 'utf8'));
      } catch (err) {
        sidecars[key] = {
          __parseError: true,
          message: String(err && err.message ? err.message : err),
        };
      }
      continue;
    }

    if (!isEntryMarkdown(rel)) continue;
    try {
      const text = await fsp.readFile(path.join(root, rel), 'utf8');
      entries.push({ path: rel, ...parseFrontmatterMeta(text) });
    } catch {
      // 读不出来就当没有 frontmatter；文件本身缺失交给构建期其他环节报
    }
  }

  return { files, sidecars, entries };
}

/**
 * 编排：收集 + 审计 + 打印。返回退出码（0 通过 / 1 有违规）。
 * @param {{ root?: string, log?: (line: string) => void, quietOnPass?: boolean }} [options]
 */
export async function runCheck(options = {}) {
  const root = options.root || fileURLToPath(new URL('..', import.meta.url));
  const log = options.log || ((line) => console.log(line));
  const { files, sidecars, entries } = await collectImageSources(root);
  const { violations, checkedImages } = auditImageSources({ files, sidecars, entries });

  if (violations.length === 0) {
    if (!options.quietOnPass) {
      log(
        `[check-image-sources] 通过：${checkedImages} 张内容图片全部位于 ${POOL_PHOTOS_DIR}/ 并与 ${POOL_SIDECAR_PATH} 成对。`,
      );
    }
    return 0;
  }
  log(
    `[check-image-sources] 发现 ${violations.length} 个图片来源问题（照片唯一通道是 npm run import -- --pool）：`,
  );
  for (const line of violations) log(`[check-image-sources]   - ${line}`);
  log(
    '[check-image-sources]   处理办法：删掉这些脚本外来的图片；要加照片就回本地跑 ' +
      'npm run import -- --pool（或带 --series / --post 追加到条目）。',
  );
  return 1;
}

const HELP_TEXT = [
  '用法：npm run check-images   （或 node scripts/check-image-sources.mjs [--root <目录>] [--quiet])',
  '',
  `扫描 ${CONTENT_ROOT} 与 public，确认照片只落在照片池里且与全局 sidecar 成对：`,
  `  R1 图片只能位于 ${POOL_PHOTOS_DIR}/（src/content 其他位置不得有图片；JSON 不算图片）`,
  `  R2 ${POOL_SIDECAR_PATH} 必须存在且是 PhotoEntry 数组，且是全站唯一一份 sidecar`,
  '  R3 pool/photos/ 里每个文件（含 .thumb.webp）都要被 sidecar 的 file / thumb 登记',
  '  R4 sidecar 登记的 file / thumb 磁盘上必须真的存在',
  '  R5 public/ 下不得出现图片（站点图标需加 ALLOWED_PUBLIC_IMAGES 白名单）',
  '  R6 条目 frontmatter 的 photos[] / cover 必须是池内已有照片 ID（cover 允许空串）',
  '',
  '这是「照片只能出自脚本」的构建期防线（admin-v2.md C 组 / design §4）。',
  '退出码 0 = 通过；1 = 存在图片来源问题（prebuild 会因此中断构建）；2 = 命令行参数错误。',
].join('\n');

/** 解析命令行参数：只认 --help / --quiet / --root <dir>；未知参数忽略。 */
export function parseArgs(argv) {
  const parsed = { help: false, quiet: false, root: null, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--quiet' || arg === '-q') parsed.quiet = true;
    else if (arg === '--root') {
      const value = argv[i + 1];
      i += 1;
      if (!value || value.startsWith('-')) parsed.errors.push('--root 需要一个目录参数');
      else parsed.root = path.resolve(value);
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
  if (parsed.errors.length > 0) {
    log(`[check-image-sources] 参数错误：${parsed.errors.join('；')}`);
    log('  用 --help 查看用法。');
    return 2;
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
