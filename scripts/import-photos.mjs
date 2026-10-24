// =============================================================================
// import-photos —— 全站照片的唯一入库通道（design §4，含 2026-09-24 随笔同通道补拍板）
//
// 做什么：扫描 raw/ 的相机原图（jpg/jpeg/png）→ 每张产出
//   ① 展示版 photos/<base>.webp        长边 DISPLAY_LONG_EDGE，WebP，DISPLAY_QUALITY
//   ② 缩略图 photos/<base>.thumb.webp  长边 THUMB_LONG_EDGE， WebP，THUMB_QUALITY
//   ③ EXIF sidecar photos.meta.json    PhotoEntry[]（file/thumb/宽高/exif；顺序即灯箱帧序列）
// 落到 src/content/<series|posts>/<标识>/；条目或 .md 不存在则以 draft:true 当场新建。
//
// 照片池化（admin-v2.md A/B 组，2026-10 拍板）：
//   照片唯一位置 src/content/pool/photos/（展示版 <base>.webp + 缩略图 <base>.thumb.webp 同目录），
//   唯一元数据 src/content/pool/photos.meta.json（PhotoEntry[] 全局一份），
//   照片 ID = 完整文件名含扩展名（night-01.webp / P1230888.webp）。
//   单条目落位（series/posts 模式）作为迁移期兼容保留；新照片默认进池（--pool，且不带目标参数时默认池）。
//   --migrate 负责把旧条目的 photos/ 与 5 份 sidecar 收进池并回填 frontmatter（四步各自可独立跑）。
//
// 不做什么（硬约束）：
//   - 原图**永不移动、永不删除**：本文件对 raw/ 只读不写，不出现任何针对 raw/ 的 unlink / rm /
//     rename / rmdir 调用（tests 有一条源码扫描用例守住这点）。--migrate 的删除面只有
//     src/content 下的 webp 产物与旧 sidecar，绝不指向 raw/。
//   - 不执行任何 git 命令：raw/ 与 thumbs/ 已由 .gitignore 排除，提交由人（或主 Agent）决定。
//   - 图片规格数值只在 astro.config.mjs 一处：下面全部 import 常量，不写死像素/质量。
//     （唯一例外 SIZE_BUDGET_*：那是 §6 的「验收阈值」而非编码参数，只用于超标时打印告警。）
//
// HEIC 为什么不进 v1：sharp 官方预构建二进制没编译 libvips 的 HEIF 解码器，喂 .heic 只会得到
//   "Unsupported image format"；要支持得自带 libvips-heif 编译链或额外转码依赖，代价与「相机
//   直接导出 jpg」的收益不成比例 → 列为试验项（progress.md 已记），此处跳过并给用户一句提示。
//
// 结构（I/O 与计算分离，便于 Vitest 真断言）：
//   纯函数区（export，无 fs/sharp/exifr）：文件名派生 / EXIF→Exif 映射 / 幂等判定 /
//     sidecar 组装与合并 / 落位路径 / Markdown 骨架 / 参数解析 / 导入清单 / 正文插图引用行
//   I/O 区（sharp + exifr + fs）：runImport() 编排；main() 只做 CLI 与交互
// 集成测试直接调 runImport({ root: 临时目录, … })，打真实 sharp/exifr，不 mock 文件读写。
// =============================================================================

import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  IMAGE_FORMAT,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  scaleToLongEdge,
} from '../astro.config.mjs';

// -----------------------------------------------------------------------------
// 纯函数区
// -----------------------------------------------------------------------------

/** v1 支持的输入扩展名（HEIC 见文件头注释）。比较时统一小写。 */
export const SUPPORTED_RAW_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png']);

/** 明确不支持的输入：扫到就跳过并提示，免得用户以为漏图。 */
export const KNOWN_UNSUPPORTED_EXTENSIONS = Object.freeze([
  '.heic',
  '.heif',
  '.raw',
  '.cr2',
  '.nef',
  '.arw',
  '.tif',
  '.tiff',
]);

/** 缩略图暂存目录名（design §4：中间产物，不进仓库）。 */
export const THUMBS_DIR_NAME = 'thumbs';
/** 资源夹内的照片目录名。 */
export const PHOTOS_DIR_NAME = 'photos';
/** sidecar 文件名（content-model 任务 6 锁定）。 */
export const SIDECAR_FILE_NAME = 'photos.meta.json';

/** 照片池目录名（相对 src/content）：池化后照片的唯一位置（admin-v2.md A1）。 */
export const POOL_DIR_NAME = 'pool';
/** 池内照片目录（相对 src/content）：展示版与缩略图同目录，靠 .thumb. 后缀区分。 */
export const POOL_PHOTOS_REL = `${POOL_DIR_NAME}/${PHOTOS_DIR_NAME}`;
/** 全局 sidecar（相对 src/content）：唯一元数据源（admin-v2.md A2）。 */
export const POOL_SIDECAR_REL = `${POOL_DIR_NAME}/${SIDECAR_FILE_NAME}`;

/**
 * §6 性能预算（验收阈值，非编码参数）：展示图 ≤2MB、缩略图 ≤160KB。
 * 原为 800KB/80KB（种子图是缩小样例）。75 张真机原图导入后，2560px 长边展示图 p95≈1.4MB、max≈1.7MB，
 * 为保展示清晰度（DISPLAY_QUALITY 仍 82）而放宽阈值，而非降画质。缩略图列表页仍小、仍懒加载。
 */
export const SIZE_BUDGET = Object.freeze({
  displayBytes: 2048 * 1024,
  thumbBytes: 160 * 1024,
});

/** 相对内容条目资源夹的路径前缀。 */
const PHOTOS_PREFIX = `${PHOTOS_DIR_NAME}/`;

/** 去掉目录与扩展名，得到派生产物使用的 basename（相机名如 P1230857 原样保留）。 */
export function baseName(fileName) {
  const name = path.basename(String(fileName ?? ''));
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/** 该文件名是否为 v1 支持的输入图片。 */
export function isSupportedRawImage(fileName) {
  return SUPPORTED_RAW_EXTENSIONS.includes(path.extname(String(fileName)).toLowerCase());
}

/** 该文件名是否为「明确不支持」的格式（给用户一句人话提示用）。 */
export function isKnownUnsupportedImage(fileName) {
  return KNOWN_UNSUPPORTED_EXTENSIONS.includes(path.extname(String(fileName)).toLowerCase());
}

/** 展示版文件名：`<base>.webp`。 */
export function displayFileNameOf(fileNameBase) {
  return `${fileNameBase}.${IMAGE_FORMAT}`;
}

/** 缩略图文件名：`<base>.thumb.webp`（复合后缀口径与种子内容一致）。 */
export function thumbFileNameOf(fileNameBase) {
  return `${fileNameBase}.thumb.${IMAGE_FORMAT}`;
}

/**
 * 一张原图对应的两个产物「相对内容条目」路径（写进 sidecar 的就是这两个字符串）。
 * @param {string} fileNameBase
 * @returns {{ file: string, thumb: string }}
 */
export function entryRelPaths(fileNameBase) {
  return {
    file: `${PHOTOS_PREFIX}${displayFileNameOf(fileNameBase)}`,
    thumb: `${PHOTOS_PREFIX}${thumbFileNameOf(fileNameBase)}`,
  };
}

/** 反推：从 sidecar 的 file 字段取回 basename（幂等判定用）。 */
export function baseNameFromDisplayPath(displayRelPath) {
  const name = path.basename(String(displayRelPath ?? ''));
  const suffix = `.${IMAGE_FORMAT}`;
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

// ---- EXIF → Exif 字段映射 ---------------------------------------------------

/** 只保留有限正数（接受纯数字字符串），否则 null。 */
function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** EXIF 里常见的占位垃圾值。 */
const JUNK_STRING = /^(|-{1,}|n\/?a|unknown|none|generic|default|0)$/i;

/** 取有意义的字符串（数组先 join），空串与占位值一律当缺失。 */
function meaningfulString(value) {
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(' ') : String(value);
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed === '' || JUNK_STRING.test(trimmed)) return null;
  return trimmed;
}

/** 机型：Make + Model 合成人话名；Model 已含厂商名时不重复。 */
export function composeCamera(raw) {
  const src = raw ?? {};
  const make = meaningfulString(src.Make);
  const model = meaningfulString(src.Model);
  if (make && model) {
    return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
  }
  return meaningfulString(src.CameraModel) ?? model ?? make ?? null;
}

/** 镜头：优先 LensModel（必要时带 LensMake 前缀），退回 LensInfo / Lens。 */
export function composeLens(raw) {
  const src = raw ?? {};
  const lensModel = meaningfulString(src.LensModel);
  const lensMake = meaningfulString(src.LensMake);
  if (lensModel) {
    if (lensMake && !lensModel.toLowerCase().startsWith(lensMake.toLowerCase())) {
      return `${lensMake} ${lensModel}`;
    }
    return lensModel;
  }
  return meaningfulString(src.LensInfo) ?? meaningfulString(src.Lens) ?? null;
}

/**
 * 快门：把曝光秒数格式化成拍摄单惯用的分数串。
 * 0.008 → "1/125"，0.01 → "1/100"，0.00125 → "1/800"，2 → "2s"，2.5 → "2.5s"。
 * @param {number|string|null|undefined} exposureSeconds
 * @returns {string|null}
 */
export function formatShutter(exposureSeconds) {
  const s = finiteNumber(exposureSeconds);
  if (s === null) return null;
  if (s >= 1) {
    const rounded = Math.round(s * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }
  return `1/${Math.max(1, Math.round(1 / s))}`;
}

/** 快门兜底：EXIF 只有 ShutterSpeedValue（AV 秒对数）时按 2^-SV 反算。 */
function shutterFromSpeedValue(speedValue) {
  const sv = finiteNumber(speedValue);
  return sv === null ? null : formatShutter(2 ** -sv);
}

/**
 * 拍摄日期：统一输出 `YYYY-MM-DD`（与种子 sidecar 口径一致，前端只读展示）。
 * exifr 把 EXIF 墙上时间按 UTC 构造 Date，故取 UTC 分量就是相机面板上那个日期；
 * 也接受 "2026:08:10 03:08:28" / ISO 串 / 毫秒时间戳。
 */
export function formatDateTaken(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  // 数字（毫秒时间戳）单独走一支：NaN / Infinity 直接当缺失，避免掉到字符串分支写出 "NaN" 这种脏值。
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : null;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : meaningfulString(s);
}

/**
 * exifr 原始对象 → 本项目 Exif 结构（字段名映射 + 缺字段容错留空）。
 *
 * | Exif 字段    | exifr key（优先级从左到右）                        |
 * |-------------|---------------------------------------------------|
 * | camera      | Make + Model（合成）/ CameraModel                |
 * | lens        | LensModel(+LensMake) / LensInfo / Lens          |
 * | focalLength | FocalLength / FocalLengthIn35mmFilm             |
 * | aperture    | FNumber / ApertureValue                         |
 * | shutter     | ExposureTime（→分数串）/ ShutterSpeedValue（反算）|
 * | iso         | ISO / ISOSpeedRatings / PhotographicSensitivity  |
 * | dateTaken   | DateTimeOriginal / CreateDate / ModifyDate      |
 *
 * 读不到的项写 null（不抛错、不省键），保证 sidecar 形状稳定、前端渲染不因缺字段报错。
 * @param {Record<string, unknown>|null|undefined} raw
 */
export function mapExif(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
  const isoRaw = src.ISO ?? src.ISOSpeedRatings ?? src.PhotographicSensitivity;
  const isoValue = Array.isArray(isoRaw) ? isoRaw.find((v) => finiteNumber(v) !== null) : isoRaw;
  return {
    camera: composeCamera(src),
    lens: composeLens(src),
    focalLength: finiteNumber(src.FocalLength) ?? finiteNumber(src.FocalLengthIn35mmFilm),
    aperture: finiteNumber(src.FNumber) ?? finiteNumber(src.ApertureValue),
    shutter: formatShutter(src.ExposureTime) ?? shutterFromSpeedValue(src.ShutterSpeedValue),
    iso: finiteNumber(isoValue),
    dateTaken:
      formatDateTaken(src.DateTimeOriginal) ??
      formatDateTaken(src.CreateDate) ??
      formatDateTaken(src.ModifyDate) ??
      null,
  };
}

/**
 * 组装一条 PhotoEntry：相对路径 + 真实像素宽高 + EXIF。
 * 宽高由调用方从 sharp 的**输出** metadata 提供（不是按常量推算的期望值）。
 * @param {{
 *   basename: string,
 *   width: number,
 *   height: number,
 *   thumbWidth: number,
 *   thumbHeight: number,
 *   exif?: Record<string, unknown>|null,
 * }} p
 */
export function buildPhotoEntry(p) {
  const { file, thumb } = entryRelPaths(p.basename);
  return {
    file,
    thumb,
    width: Number(p.width),
    height: Number(p.height),
    thumbWidth: Number(p.thumbWidth),
    thumbHeight: Number(p.thumbHeight),
    exif: mapExif(p.exif ?? {}),
  };
}

// ---- 幂等判定（新图识别） ---------------------------------------------------

/**
 * 纯函数：哪些原图算「新图」。
 * 判定为已导入 = sidecar 里有同 basename 的条目 **且** 展示图与缩略图两个产物都在盘上。
 * 只在 sidecar 里出现但产物丢了 → 当新图重导（产物与 sidecar 自愈）。
 *
 * @param {{
 *   rawFiles: string[],
 *   sidecar?: Array<{ file?: string }>|null,
 *   existingRels?: Set<string>|string[],
 * }} p
 * @returns {{
 *   newOnes: Array<{ file: string, basename: string, replacing: boolean }>,
 *   skipped: Array<{ file: string, basename: string, reason: string }>,
 * }}
 */
export function planImports({ rawFiles, sidecar, existingRels }) {
  /** @type {Map<string, { file: string }>} */
  const known = new Map();
  for (const entry of sidecar ?? []) {
    const basename = baseNameFromDisplayPath(entry?.file);
    if (basename) known.set(basename, entry);
  }
  const onDisk = existingRels instanceof Set ? existingRels : new Set(existingRels ?? []);

  /** @type {Array<{ file: string, basename: string, replacing: boolean }>} */
  const newOnes = [];
  /** @type {Array<{ file: string, basename: string, reason: string }>} */
  const skipped = [];

  for (const rawFile of rawFiles ?? []) {
    const basename = baseName(rawFile);
    const { file, thumb } = entryRelPaths(basename);
    const hasEntry = known.has(basename);
    if (hasEntry && onDisk.has(file) && onDisk.has(thumb)) {
      skipped.push({ file: rawFile, basename, reason: '已导入' });
    } else {
      newOnes.push({ file: rawFile, basename, replacing: hasEntry });
    }
  }
  return { newOnes, skipped };
}

/**
 * 合并 sidecar：已有条目按 file 原位替换（保持照片流顺序），新条目按导入顺序追加。
 * 顶层数组顺序 = 照片流 / 灯箱帧序列，故绝不排序。
 * @param {Array<{ file: string }>} existing
 * @param {Array<{ file: string }>} added
 */
export function mergeSidecar(existing, added) {
  /** @type {Map<string, { file: string }>} */
  const byFile = new Map();
  for (const entry of existing ?? []) {
    if (entry && typeof entry.file === 'string') byFile.set(entry.file, entry);
  }
  for (const entry of added ?? []) {
    if (entry && typeof entry.file === 'string') byFile.set(entry.file, entry);
  }
  return [...byFile.values()];
}

/** 序列化 sidecar：稳定 2 空格缩进 + 结尾换行，便于 git diff 阅读。 */
export function serializeSidecar(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

// ---- 参数解析 / 落位约定 ---------------------------------------------------

/** 帮助文本（--help 与参数报错时复用）。 */
export const HELP_TEXT = [
  '用法：npm run import -- [--pool] [--series <系列标识> | --post <日期-标题>] [options]',
  '      npm run import -- --migrate[=step]   把旧条目照片收进池（四步可单跑）',
  '',
  '  --pool                导入到照片池 src/content/pool/（不带 --series/--post 时就是默认目标）',
  '  --series, -s <标识>   导入到 src/content/series/<标识>/（不存在则当场新建草稿系列）',
  '  --post,    -p <标识>  导入到 src/content/posts/<标识>/（<标识>.md 不存在则新建草稿骨架）',
  '  --only <a,b.jpg>      本次只导入指定的 raw/ 文件名（逗号分隔，可省扩展名）',
  '  --title <标题>        新建骨架用的标题；省略则由标识派生',
  '  --date <YYYY-MM-DD>   新建骨架用的日期；省略则随笔取标识前缀、系列取今天',
  '  --ask                 交互式询问导入目标（池为默认，故平时不必问）',
  '  --migrate[=step]      迁移旧条目照片到池；step ∈ move / merge / backfill / cover，',
  '                        可逗号组合（如 --migrate=move,merge），省略 step = 全四步',
  '  --help,  -h           显示本帮助',
  '',
  '目标三选一（池 / 系列 / 随笔），都不给时默认进池。',
  '原图始终留在 raw/ 原地不动；raw/ 与 thumbs/ 已被 .gitignore 排除，不进仓库。',
].join('\n');

/**
 * 校验条目标识：允许字母/数字/中文与 `.` `_` `-`，禁止路径分隔与 `..`（防越界写盘）。
 * @param {string} identifier
 */
export function validateIdentifier(identifier) {
  const id = String(identifier ?? '').trim();
  if (id === '') throw new Error('条目标识不能为空');
  if (/[\\/]/.test(id) || id.includes('..')) {
    throw new Error(`条目标识不能包含路径分隔符或 ".."：${id}`);
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) {
    throw new Error(`条目标识只能用字母/数字/中文与 . _ -：${id}`);
  }
  return id;
}

/**
 * 解析 CLI 参数（纯函数；argv = process.argv.slice(2)）。
 *
 * 三个导入目标互斥：--pool / --series <标识> / --post <标识>；都不给时 collection 与 pool 均为空，
 * 由 runCli 兜底成「默认进池」（B1），--ask 才回到交互式提问（旧行为，保留给人工排障）。
 * --migrate 与导入目标互斥（它只搬已入库的产物，不碰 raw/）。
 *
 * @param {string[]} argv
 * @returns {{
 *   collection: 'series'|'posts'|null,
 *   identifier: string|null,
 *   pool: boolean,
 *   migrate: string[]|null,
 *   ask: boolean,
 *   only: string[],
 *   title: string|null,
 *   date: string|null,
 *   help: boolean,
 *   interactive: boolean,
 * }}
 */
export function parseArgs(argv) {
  /** @type {'series'|'posts'|null} */
  let collection = null;
  /** @type {string|null} */
  let identifier = null;
  let pool = false;
  /** @type {string[]|null} */
  let migrate = null;
  let ask = false;
  /** @type {string[]} */
  const only = [];
  let title = null;
  let date = null;
  let help = false;

  const flag = (name) => (name === '--series' || name === '-s' ? '--series' : '--post');
  const assign = (next, value, name) => {
    if (pool) throw new Error(`--pool 与 ${flag(name)} 不能同时使用：照片要么进池，要么挂到某个条目下`);
    if (collection !== null && collection !== next) {
      throw new Error('--series 与 --post 不能同时使用，请二选一');
    }
    if (value === undefined || String(value).trim() === '') {
      throw new Error(`参数 ${flag(name)} 缺少取值\n\n${HELP_TEXT}`);
    }
    collection = next;
    identifier = validateIdentifier(value);
  };

  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    const name = arg.split('=')[0];
    const inline = arg.startsWith('--') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : null;
    const takeNext = () => {
      if (inline !== null) return inline;
      i += 1;
      return args[i];
    };
    switch (name) {
      case '--pool':
        if (collection !== null) {
          throw new Error('--pool 与 --series/--post 不能同时使用：照片要么进池，要么挂到某个条目下');
        }
        if (inline !== null) throw new Error(`--pool 不带取值\n\n${HELP_TEXT}`);
        pool = true;
        break;
      case '--migrate': {
        // 三种写法等价：--migrate / --migrate=merge / --migrate merge
        let spec = inline;
        if (spec === null && args[i + 1] && MIGRATE_STEPS.includes(String(args[i + 1]).toLowerCase())) {
          i += 1;
          spec = args[i];
        }
        migrate = parseMigrateSteps(spec === null ? 'all' : spec);
        break;
      }
      case '--ask':
        ask = true;
        break;
      case '--series':
      case '-s':
        assign('series', takeNext(), name);
        break;
      case '--post':
      case '-p':
        assign('posts', takeNext(), name);
        break;
      case '--only':
      case '-o':
        only.push(
          ...String(takeNext() ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case '--title':
        title = meaningfulString(takeNext());
        break;
      case '--date':
        date = meaningfulString(takeNext());
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`未识别的参数：${arg}\n\n${HELP_TEXT}`);
    }
  }

  if (migrate && (pool || collection !== null)) {
    throw new Error('--migrate 不能与 --pool/--series/--post 同用：迁移只整理已入库产物，不导入 raw/');
  }

  // assign() 已保证 collection 与 identifier 同生同灭（缺值当场报错），故此处无需再校验组合。
  return {
    collection,
    identifier,
    pool,
    migrate,
    ask,
    only,
    title,
    date,
    help,
    interactive: collection === null && !pool && migrate === null,
  };
}

/**
 * 落位约定（design §4 + progress.md 2026-09-24 编排拍板：展示图与缩略图同放 photos/，
 * 而非任务 7 字面的 images/+thumbnails/ 双目录）。
 *   pool   → src/content/pool/photos/{<b>.webp, <b>.thumb.webp} + src/content/pool/photos.meta.json（无 .md）
 *   series → src/content/series/<标识>/{photos/<b>.webp, photos/<b>.thumb.webp, photos.meta.json, index.md}
 *   posts  → src/content/posts/<日期-标题>/{photos/…, photos.meta.json} + 同级 <日期-标题>.md
 * 返回路径全部相对 src/content（绝对路径由调用方拼 root，便于集成测把 root 指到临时目录）。
 *
 * 池化的三个关键口径（A 组 A6 + B1）：
 *   - entryDir = 'pool'，photosDir = 'pool/photos'，因此 sidecar 的 file/thumb 仍是
 *     `photos/x.webp`（池内相对路径），真实磁盘路径 = src/content/pool/photos/x.webp；
 *   - markdownPath = null：池是照片仓库，不承载正文，也不写条目骨架；
 *   - 全局 sidecar 只有一份，多批导入靠 mergeSidecar 追加，不重排。
 *
 * @param {'pool'|'series'|'posts'} collection
 * @param {string} [identifier]
 */
export function resolveTarget(collection, identifier) {
  if (collection === POOL_DIR_NAME) {
    return {
      collection: 'pool',
      identifier: POOL_DIR_NAME,
      /** 资源夹（相对 src/content）= 池根，与 sidecar 的 photos/ 前缀同口径 */
      entryDir: POOL_DIR_NAME,
      /** 池没有正文文件 */
      markdownPath: null,
      sidecarPath: POOL_SIDECAR_REL,
      photosDir: POOL_PHOTOS_REL,
    };
  }
  if (collection !== 'series' && collection !== 'posts') {
    throw new Error(`未知的目标类型：${String(collection)}（只支持 pool / series / posts）`);
  }
  const id = validateIdentifier(identifier);
  const entryDir = `${collection}/${id}`;
  return {
    collection,
    identifier: id,
    /** 资源夹（相对 src/content），与 contentImages.entryResourceDir 口径一致 */
    entryDir,
    /** 条目 Markdown：系列 <id>/index.md；随笔 <id>.md */
    markdownPath: collection === 'series' ? `${entryDir}/index.md` : `${collection}/${id}.md`,
    /** sidecar 相对路径 */
    sidecarPath: `${entryDir}/${SIDECAR_FILE_NAME}`,
    /** 产物目录相对 src/content */
    photosDir: `${entryDir}/${PHOTOS_DIR_NAME}`,
  };
}

/** 由标识派生骨架标题：连字符/下划线转空格并首字母大写（中文等原样保留）。 */
export function deriveTitle(identifier) {
  const id = validateIdentifier(identifier);
  if (/^\d+$/.test(id)) return id;
  // 随笔标识常是「YYYY-MM-DD-标题」：前导日期不适合当标题，先剥掉再派生。
  const withoutDate = id.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '');
  const seed = withoutDate === '' ? id : withoutDate;
  return seed
    .replace(/[-_.]+/g, ' ')
    .trim()
    .replace(/^(\p{Ll})/u, (m) => m.toUpperCase())
    .replace(/ (\p{Ll})/gu, (m, c) => ` ${c.toUpperCase()}`);
}

/** 从「日期-标题」形式的随笔标识里取出 YYYY-MM-DD；没有则 null。 */
export function dateFromIdentifier(identifier) {
  const m = String(identifier ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 校验/归一日期：能识别的 YYYY-MM-DD 才返回，否则 null（调用方再兜底）。 */
export function normalizeDate(value) {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 今天（YYYY-MM-DD，本地时区）：骨架日期兜底。 */
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** YAML 标量：含特殊字符时加引号，保证 frontmatter 被 Astro 正确解析。 */
function yamlScalar(value) {
  const s = String(value);
  return /[:#\[\]{}&*!|>'"%@`,]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/** frontmatter 的 tags：骨架阶段一般空数组（标签由用户在后台补）。 */
function yamlTags(tags) {
  const list = (tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  return list.length > 0 ? `[${list.map(yamlScalar).join(', ')}]` : '[]';
}

/**
 * 新建系列骨架 index.md（draft: true；满足 seriesSchema 必填 title/date/cover/tags/order/draft）。
 * @param {{ identifier: string, title?: string|null, date: string, cover: string, order: number, tags?: string[] }} p
 */
export function renderSeriesMarkdown(p) {
  const id = validateIdentifier(p.identifier);
  return [
    '---',
    `title: ${yamlScalar(p.title || deriveTitle(id))}`,
    `date: ${p.date}`,
    `cover: ${yamlScalar(p.cover)}`,
    `tags: ${yamlTags(p.tags)}`,
    `order: ${p.order}`,
    'draft: true',
    '---',
    '',
    `<!-- 由 npm run import 新建（系列标识 ${id}，${p.date}）。照片与 photos.meta.json 已入库；手记写完、本地预览确认后，把 draft 改成 false 再发布。 -->`,
    '',
  ].join('\n');
}

/**
 * 新建随笔骨架 <日期-标题>.md（draft: true；满足 postsSchema 必填 title/date/cover/tags/draft）。
 * @param {{ identifier: string, title?: string|null, date: string, cover: string, tags?: string[] }} p
 */
export function renderPostMarkdown(p) {
  const id = validateIdentifier(p.identifier);
  return [
    '---',
    `title: ${yamlScalar(p.title || deriveTitle(id))}`,
    `date: ${p.date}`,
    `cover: ${yamlScalar(p.cover)}`,
    `tags: ${yamlTags(p.tags)}`,
    'draft: true',
    '---',
    '',
    `<!-- 由 npm run import 新建（随笔标识 ${id}，${p.date}）。插图与 photos.meta.json 已写入同名资源夹；正文写完、本地预览确认后，把 draft 改成 false 再发布。 -->`,
    '',
  ].join('\n');
}

/**
 * 期望输出尺寸：先按 EXIF orientation 交换被旋转的宽高，再走 astro.config 的 scaleToLongEdge。
 * 与 sharp .rotate() 自动转正后的产物同口径（真正写进 sidecar 的是实测尺寸）。
 * @param {number} width @param {number} height @param {number|undefined} orientation @param {number} longEdge
 */
export function planOutputSize(width, height, orientation, longEdge) {
  const swapped = [5, 6, 7, 8].includes(Number(orientation)) ? [height, width] : [width, height];
  const planned = scaleToLongEdge(swapped[0], swapped[1], longEdge);
  return { width: planned.width, height: planned.height };
}

/** 人类可读字节数（清单与报告用）。 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '未知';
  return `${(n / 1024).toFixed(1)}KB`;
}

/**
 * 导入清单（纯函数）：把一次导入摊成人话行数组，供 CLI 打印与测试断言。
 * @param {{
 *   target: { collection: string, identifier: string, entryDir: string, sidecarPath: string, markdownPath?: string },
 *   createdEntry?: boolean,
 *   skeletonPath?: string|null,
 *   added?: Array<{ basename: string, file: string, thumb: string, width: number, height: number, thumbWidth: number, thumbHeight: number, bytes: number, thumbBytes: number }>,
 *   skipped?: Array<{ file: string, basename: string, reason: string }>,
 *   failed?: Array<{ file: string, message: string }>,
 *   ignored?: string[],
 *   budget?: { displayBytes: number, thumbBytes: number },
 * }} p
 */
export function buildManifest(p) {
  const added = p.added ?? [];
  const skipped = p.skipped ?? [];
  const failed = p.failed ?? [];
  const budget = p.budget ?? SIZE_BUDGET;
  /** @type {string[]} */
  const lines = [];

  if (p.target.collection === POOL_DIR_NAME) {
    lines.push(`目标：照片池 src/content/${POOL_PHOTOS_REL}/（全局 sidecar src/content/${POOL_SIDECAR_REL}）`);
  } else {
    lines.push(`目标条目：${p.target.collection}/${p.target.identifier}（资源夹 src/content/${p.target.entryDir}/）`);
  }
  if (p.createdEntry) {
    lines.push(`  ↳ 新建草稿骨架：${p.skeletonPath ?? p.target.markdownPath ?? p.target.entryDir}（draft: true，预览确认后再去掉草稿标记）`);
  }
  if (p.ignored && p.ignored.length > 0) {
    lines.push(
      `  ↳ 已忽略 ${p.ignored.length} 个不支持的文件（v1 只收 jpg/jpeg/png，HEIC 需自编译 libvips 故未纳入）：${p.ignored.join(', ')}`,
    );
  }
  lines.push(`结果：新增 ${added.length} 张、跳过 ${skipped.length} 张。`);
  for (const a of added) {
    lines.push(
      `  + ${a.basename} → ${a.file}（${a.width}×${a.height}，${formatBytes(a.bytes)}）` +
        ` + ${a.thumb}（${a.thumbWidth}×${a.thumbHeight}，${formatBytes(a.thumbBytes)}）`,
    );
    if (a.bytes > budget.displayBytes) {
      lines.push(
        `    ⚠️ 展示图超出 §6 预算 ${formatBytes(budget.displayBytes)}：把 astro.config.mjs 的 DISPLAY_QUALITY 调低后重跑`,
      );
    }
    if (a.thumbBytes > budget.thumbBytes) {
      lines.push(
        `    ⚠️ 缩略图超出 §6 预算 ${formatBytes(budget.thumbBytes)}：把 astro.config.mjs 的 THUMB_QUALITY 调低后重跑`,
      );
    }
  }
  for (const s of skipped) {
    lines.push(`  = ${s.file}（${s.reason}，产物与原图均未改动）`);
  }
  if (failed.length > 0) {
    lines.push(`  ✗ 处理失败 ${failed.length} 张（未入库，其余照片不受影响；换掉坏图后重跑会再试一次）：`);
    for (const f of failed) {
      lines.push(`    · ${f.file} — ${f.message}`);
    }
  }
  lines.push(`sidecar：src/content/${p.target.sidecarPath}（脚本生成与维护，人工不编辑）`);
  lines.push('原图仍留在 raw/ 原地：未移动、未删除，脚本也没有执行任何 git 操作。');

  return {
    addedCount: added.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    createdEntry: Boolean(p.createdEntry),
    /** 幂等验收的快捷判据：有跳过、无新增、无失败 = 「全部跳过」。 */
    allSkipped: added.length === 0 && failed.length === 0 && skipped.length > 0,
    lines,
  };
}

// ---- 正文插图引用行（后台「以 Markdown 编辑」用；纯文本产物，无 fs/console）-----

/** 引用行里的 alt/说明 占位文案：用户粘进正文后须换成真实描述。 */
const ILLUSTRATION_ALT = '说明';

/** 引用行块标题：仅在本次确实新增了照片时由 runImport 打印。 */
const ILLUSTRATION_REF_HEADER = '可粘贴到后台「正文」的插图引用行（Markdown 模式）：';

/** 引用行块尾的一行提醒。 */
const ILLUSTRATION_REF_TIP =
  '提示：把上面每行的「说明」改成真实的图片描述，再整行复制进后台正文（Markdown 模式）。';

/**
 * 生成可粘贴到后台「正文（以 Markdown 编辑）」的插图引用行（纯函数）。
 *
 * 为什么需要：后台正文的插图必须引用池里已入库的照片（池化后没有第二条上传通道），
 * 手写容易拼错；本函数把刚导入的 sidecar 摊成人能照抄的行。
 * 池化口径（admin-v2.md D2a）下正文统一写 `![说明](photo:照片ID)`，见同文件
 * buildPoolIllustrationRefLines；本函数输出的是迁移期兼容的单条目相对路径形。
 *
 * 落位口径与 resolveTarget 一致：
 *   series → 正文在 <标识>/index.md，photos 与之同目录 → `photos/x.webp`
 *   posts  → 正文是扁平的 <标识>.md，photos 在同名资源夹 → `<标识>/photos/x.webp`
 *
 * 只取展示图（sidecar 的 file 字段，即 <base>.webp）：跳过缩略图（含 `.thumb.`）、
 * 非 webp（用 IMAGE_FORMAT 常量判、不写死扩展名）、空 / 缺 file 的条目；顺序 = 传入 sidecar 顺序。
 *
 * @param {{
 *   sidecar?: Array<{ file?: string }>|null,
 *   collection?: 'series'|'posts'|string,
 *   entryId?: string,
 * }} [p]
 * @returns {string[]}
 */
export function buildIllustrationRefLines({ sidecar, collection, entryId } = {}) {
  const id = String(entryId ?? '').trim();
  const prefix = collection === 'posts' && id !== '' ? `${id}/` : '';
  const displaySuffix = `.${IMAGE_FORMAT}`.toLowerCase();
  /** @type {string[]} */
  const lines = [];
  for (const entry of sidecar ?? []) {
    const rel = typeof entry?.file === 'string' ? entry.file.trim() : '';
    if (rel === '') continue;
    if (rel.includes('.thumb.')) continue;
    if (!path.basename(rel).toLowerCase().endsWith(displaySuffix)) continue;
    lines.push(`![${ILLUSTRATION_ALT}](${prefix}${rel})`);
  }
  return lines;
}

// -----------------------------------------------------------------------------
// 池化迁移（--migrate）：纯函数区（无 fs / 无 console，Vitest 直接喂夹具断言）
//
// 四步与 admin-v2.md B2a~B2d 一一对应，且**各自可独立跑**：
//   move     旧条目 photos/ 下的 webp → pool/photos/（原图 raw/ 不参与，K6）
//   merge    旧条目的 5 份 sidecar → 全局 pool/photos.meta.json，按文件名去重（先比对四项宽高 + EXIF）
//   backfill 7 个条目 frontmatter 回填 photos[]；cover 从相对路径换算成照片 ID
//   cover    K1 坏 cover：无法解析到池内照片的 cover 置空串，并打印待办提醒
// -----------------------------------------------------------------------------

/** 迁移四步（数组顺序即执行顺序）。 */
export const MIGRATE_STEPS = Object.freeze(['move', 'merge', 'backfill', 'cover']);

/**
 * 解析 --migrate 的步骤取值（'all' / '' / 'move,merge' …）→ 规范化的步骤数组。
 * 顺序恒按 MIGRATE_STEPS 归一，重复项去重；出现未知步骤当场报错（不猜、不静默跑半套）。
 * @param {string} [spec]
 * @returns {string[]}
 */
export function parseMigrateSteps(spec) {
  const raw = String(spec ?? '').trim();
  if (raw === '' || raw.toLowerCase() === 'all') return [...MIGRATE_STEPS];
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = parts.filter((p) => !MIGRATE_STEPS.includes(p));
  if (unknown.length > 0) {
    throw new Error(`未知的迁移步骤：${unknown.join(', ')}（可选 ${MIGRATE_STEPS.join(' / ')}，或 all）`);
  }
  const wanted = new Set(parts);
  return MIGRATE_STEPS.filter((step) => wanted.has(step));
}

/**
 * 照片 ID = 路径末段的完整文件名（含扩展名，如 `night-01.webp`）。
 * 与 contentImages.photoIdOf 同口径，这里不 import 那个模块（脚本不依赖 src/ 的 TS 源码）。
 * @param {string} relPath
 */
export function photoIdFromPath(relPath) {
  const clean = String(relPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * 展示图 ID：缩略图（含 `.thumb.` 复合后缀）返回空串 —— frontmatter 的 photos[] 只存展示版 ID，
 * 缩略图由前台按约定后缀自己拼，不该混进照片流。
 * @param {string} relPath
 */
export function displayPhotoIdOf(relPath) {
  const id = photoIdFromPath(relPath);
  if (id === '' || id.includes('.thumb.')) return '';
  return id;
}

/**
 * 一条 PhotoEntry 的「一致性指纹」：file / thumb / 宽高四项 / exif 全参与。
 * 去重前必须比对（B2b）：同名但元数据不同的两条记录是**冲突**，不是能随便丢掉一份的重复。
 * @param {Record<string, any>|null|undefined} entry
 */
export function photoSignature(entry) {
  const rec = entry && typeof entry === 'object' ? entry : {};
  const exif = rec.exif && typeof rec.exif === 'object' ? rec.exif : {};
  const exifPairs = Object.keys(exif)
    .sort()
    .map((k) => [k, exif[k] === undefined ? null : exif[k]]);
  return JSON.stringify([
    String(rec.file ?? ''),
    String(rec.thumb ?? ''),
    Number(rec.width ?? 0),
    Number(rec.height ?? 0),
    Number(rec.thumbWidth ?? 0),
    Number(rec.thumbHeight ?? 0),
    exifPairs,
  ]);
}

/** 旧条目 sidecar 的固定位置：<series|posts>/<标识>/photos.meta.json。 */
const LEGACY_SIDECAR_RE = /^(series|posts)\/([^/]+)\/photos\.meta\.json$/;

/** 旧条目 photos/ 下的产物（只认 webp，含 .thumb.webp 复合后缀）。 */
const LEGACY_PHOTO_RE = /^(series|posts)\/[^/]+\/photos\/[^/]+\.webp$/i;

/** 旧条目排序：先系列后随笔，各自按标识字典序（保证合并顺序稳定、可复现）。 */
function legacyEntryOrder(a, b) {
  if (a.collection !== b.collection) return a.collection === 'series' ? -1 : 1;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * 从「相对 src/content 的文件清单」里认出仍带旧 sidecar 的条目（纯函数：不碰盘）。
 * @param {string[]} files
 * @returns {Array<{ collection: 'series'|'posts', id: string, entryDir: string, sidecarPath: string, photosDir: string, markdownPath: string }>}
 */
export function discoverLegacyEntries(files) {
  const out = [];
  const seen = new Set();
  for (const raw of files ?? []) {
    const rel = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
    const m = LEGACY_SIDECAR_RE.exec(rel);
    if (!m) continue;
    const collection = /** @type {'series'|'posts'} */ (m[1]);
    const id = m[2];
    const entryDir = `${collection}/${id}`;
    if (seen.has(entryDir)) continue;
    seen.add(entryDir);
    out.push({
      collection,
      id,
      entryDir,
      sidecarPath: rel,
      photosDir: `${entryDir}/${PHOTOS_DIR_NAME}`,
      markdownPath: collection === 'series' ? `${entryDir}/index.md` : `posts/${id}.md`,
    });
  }
  return out.sort(legacyEntryOrder);
}

/**
 * 从文件清单里认出所有内容条目的 Markdown（系列的 <id>/index.md、随笔的 <id>.md）。
 * 回填要覆盖「有照片的 5 个」+「没照片的 2 个」，所以必须按 .md 走，而不是按 sidecar 走。
 * @param {string[]} files
 */
export function discoverEntryMarkdowns(files) {
  const out = [];
  for (const raw of files ?? []) {
    const rel = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
    const series = /^series\/([^/]+)\/index\.md$/.exec(rel);
    if (series) {
      out.push({
        collection: 'series',
        id: series[1],
        entryDir: `series/${series[1]}`,
        markdownPath: rel,
      });
      continue;
    }
    const post = /^posts\/([^/]+)\.md$/.exec(rel);
    if (post) {
      out.push({
        collection: 'posts',
        id: post[1],
        entryDir: `posts/${post[1]}`,
        markdownPath: rel,
      });
    }
  }
  return out.sort(legacyEntryOrder);
}

/**
 * B2a 的搬运计划（纯函数）：把每个条目 sidecar 登记的 file / thumb 映射到池内同名文件。
 *
 * 去重口径（B2b 的前置校验）：
 *   - 同一目标名来自多条目时，**指纹必须完全一致**才归入 duplicates（可安全丢弃）；
 *   - 指纹不一致 → 进 conflicts，调用方必须报错中止（绝不静默丢数据）。
 * photos/ 里存在但 sidecar 没登记的文件进 unregistered：只报告、不搬（来源不明，不能猜）。
 *
 * @param {{ sources?: Array<{ entryDir: string, entries: any[] }>, files?: string[] }} [input]
 */
export function planPoolMoves({ sources, files } = {}) {
  /** @type {Array<{ from: string, to: string, basename: string }>} */
  const moves = [];
  /** @type {Array<{ from: string, to: string, basename: string, keptFrom: string }>} */
  const duplicates = [];
  /** @type {Array<{ basename: string, from: string, keptFrom: string, reason: string }>} */
  const conflicts = [];
  /** to -> { from, signature } */
  const claimed = new Map();
  /** sidecar 已经认领的旧条目相对路径 */
  const declared = new Set();

  for (const source of sources ?? []) {
    const entryDir = String(source?.entryDir ?? '').replace(/\/+$/, '');
    for (const entry of source?.entries ?? []) {
      const signature = photoSignature(entry);
      for (const key of ['file', 'thumb']) {
        const relPath = typeof entry?.[key] === 'string' ? entry[key].trim() : '';
        if (relPath === '') continue;
        const from = `${entryDir}/${relPath.replace(/^\.?\//, '')}`;
        declared.add(from);
        const basename = photoIdFromPath(relPath);
        if (basename === '') continue;
        const to = `${POOL_PHOTOS_REL}/${basename}`;
        const prior = claimed.get(to);
        if (!prior) {
          claimed.set(to, { from, signature });
          moves.push({ from, to, basename });
          continue;
        }
        if (prior.signature === signature) {
          duplicates.push({ from, to, basename, keptFrom: prior.from });
        } else {
          conflicts.push({
            basename,
            from,
            keptFrom: prior.from,
            reason: '同名文件但宽高/EXIF 元数据不一致，去重会丢数据',
          });
        }
      }
    }
  }

  /** @type {string[]} */
  const unregistered = [];
  for (const raw of files ?? []) {
    const rel = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!LEGACY_PHOTO_RE.test(rel)) continue;
    if (declared.has(rel)) continue;
    unregistered.push(rel);
  }

  return { moves, duplicates, conflicts, unregistered };
}

/**
 * 去重例的展示口径（纯函数）：把 planPoolMoves 的 duplicates（逐文件）归成「每个照片名一例」。
 * 展示图与缩略图是同一张照片的两个文件，故先把 `.thumb` 复合后缀折回展示图名 ——
 * 报告里说「去重 6 例」时，指的是 6 个不同的照片（每例带 2~3 个来源目录）。
 * @param {Array<{ basename: string, from: string, keptFrom: string }>|undefined} duplicates
 */
export function groupDuplicateBasenames(duplicates) {
  /** @type {Map<string, { basename: string, sources: string[] }>} */
  const groups = new Map();
  /** 来源统一成条目目录（series/a/photos/x.webp → series/a），展示图与缩略图算同一来源。 */
  const entryDirOf = (filePath) => String(filePath).replace(/\/photos\/[^/]*$/, '');
  for (const item of duplicates ?? []) {
    const key = String(item.basename).replace(/\.thumb(?=\.)/, '');
    const group = groups.get(key) ?? { basename: key, sources: [] };
    for (const from of [item.keptFrom, item.from]) {
      const dir = entryDirOf(from);
      if (dir !== '' && !group.sources.includes(dir)) group.sources.push(dir);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * B2b 的合并（纯函数）：多份旧 sidecar → 一份全局 sidecar 数组。
 *
 * 顺序：按传入 sources 顺序（调用方给的是「系列先、随笔后，各自标识字典序」），
 * 每个条目内部保持原 sidecar 顺序 —— 顶层顺序即照片流/灯箱帧序列，绝不排序。
 * 去重键 = 展示图文件名（照片 ID）；重复且指纹一致才算一例，指纹冲突进 conflicts。
 *
 * @param {Array<{ entryDir: string, entries: any[] }>|undefined} sources
 */
export function mergeLegacySidecars(sources) {
  /** @type {any[]} */
  const entries = [];
  /** @type {Map<string, { entry: any, entryDir: string }>} */
  const byId = new Map();
  /** @type {Array<{ basename: string, sources: string[] }>} */
  const deduped = [];
  /** @type {Array<{ basename: string, from: string[], a: any, b: any }>} */
  const conflicts = [];

  for (const source of sources ?? []) {
    const entryDir = String(source?.entryDir ?? '');
    for (const entry of source?.entries ?? []) {
      const id = displayPhotoIdOf(entry?.file);
      if (id === '') continue;
      const prior = byId.get(id);
      if (!prior) {
        byId.set(id, { entry, entryDir });
        entries.push(entry);
        continue;
      }
      if (photoSignature(prior.entry) === photoSignature(entry)) {
        const group = deduped.find((g) => g.basename === id);
        if (group) group.sources.push(entryDir);
        else deduped.push({ basename: id, sources: [prior.entryDir, entryDir] });
      } else {
        conflicts.push({ basename: id, from: [prior.entryDir, entryDir], a: prior.entry, b: entry });
      }
    }
  }

  return { entries, deduped, conflicts };
}

// ---- frontmatter 就地回填（保留行尾风格与其它字段原样）------------------------

/**
 * 把 Markdown 切成「frontmatter 行块 + 其余行」，并记录原文件的换行风格。
 * 现有内容 md 是 CRLF，个别是 LF —— 回填必须保持各自原样，不能把整个仓库的行尾洗一遍。
 * @param {string} markdown
 * @returns {{ eol: string, lines: string[], head: string[], fields: string[], tail: string[] }|null}
 */
export function splitFrontmatter(markdown) {
  const text = String(markdown ?? '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  return {
    eol,
    lines,
    head: lines.slice(0, 1),
    fields: lines.slice(1, end),
    tail: lines.slice(end),
  };
}

/** 去掉 YAML 标量的成对引号（只处理我们写出的两种形）。 */
function unquoteYaml(value) {
  const s = String(value ?? '').trim();
  const single = /^'(.*)'$/.exec(s);
  if (single) return single[1];
  const double = /^"(.*)"$/.exec(s);
  if (double) return double[1];
  return s;
}

/** 读 frontmatter 里某个键的标量值；没有该键返回 null。 */
export function frontmatterValueOf(markdown, key) {
  const fm = splitFrontmatter(markdown);
  if (!fm) return null;
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (const line of fm.fields) {
    const m = re.exec(line);
    if (m) return unquoteYaml(m[1]);
  }
  return null;
}

/**
 * 读 frontmatter 的 photos 列表（块序列与行内 `[a, b]` 两种写法都认）。
 * 没有该键返回 null（调用方据此区分「键不存在」与「空列表」）。
 */
export function frontmatterPhotosOf(markdown) {
  const fm = splitFrontmatter(markdown);
  if (!fm) return null;
  const index = fm.fields.findIndex((line) => /^photos\s*:/.test(line));
  if (index < 0) return null;
  /** @type {string[]} */
  const items = [];
  const head = fm.fields[index].replace(/^photos\s*:\s*/, '').trim();
  if (head !== '') {
    const inline = head.replace(/^\[/, '').replace(/\]$/, '').trim();
    if (inline !== '') {
      items.push(...inline.split(',').map((s) => unquoteYaml(s)).filter(Boolean));
    }
  }
  for (let i = index + 1; i < fm.fields.length && /^[ \t]/.test(fm.fields[i]); i += 1) {
    const m = /^\s*-\s*(.+)$/.exec(fm.fields[i]);
    if (m) items.push(unquoteYaml(m[1]));
  }
  return items;
}

/**
 * 就地替换/追加一个 frontmatter 键：老键连同它的缩进续行一起替换，反复跑结果不变（幂等）。
 * @param {string[]} fields frontmatter 内的行（不含两条 ---）
 * @param {string} key
 * @param {string[]} valueLines 该键要写入的行（可多行）
 */
function upsertFrontmatterField(fields, key, valueLines) {
  /** @type {string[]} */
  const out = [];
  const re = new RegExp(`^${key}\\s*:`);
  let replaced = false;
  for (let i = 0; i < fields.length; i += 1) {
    const line = fields[i];
    if (!re.test(line)) {
      out.push(line);
      continue;
    }
    out.push(...valueLines);
    replaced = true;
    let j = i + 1;
    while (j < fields.length && /^[ \t]/.test(fields[j])) j += 1;
    i = j - 1;
  }
  if (!replaced) out.push(...valueLines);
  return out;
}

/**
 * B2c 的落盘文本：把 photos / cover 写回 frontmatter，其余字节原样不动。
 * photos 用块序列（75 张的照片流用行内数组不可读），空列表写 `photos: []`；
 * cover 空串写 `cover: ''`（A5：schema 允许空串，前台退回 photos[0]）。
 *
 * @param {string} markdown
 * @param {{ photos?: string[], cover?: string }} [patch]
 * @returns {{ text: string, changed: boolean, ok: boolean, eol: string }}
 */
export function applyFrontmatterBackfill(markdown, patch = {}) {
  const fm = splitFrontmatter(markdown);
  if (!fm) return { text: String(markdown ?? ''), changed: false, ok: false, eol: '\n' };
  const ids = (patch.photos ?? []).map((id) => String(id).trim()).filter(Boolean);
  const cover = String(patch.cover ?? '').trim();

  let fields = upsertFrontmatterField(fm.fields, 'cover', [
    cover === '' ? "cover: ''" : `cover: ${yamlScalar(cover)}`,
  ]);
  fields = upsertFrontmatterField(
    fields,
    'photos',
    ids.length === 0 ? ['photos: []'] : ['photos:', ...ids.map((id) => `  - ${yamlScalar(id)}`)],
  );

  const text = [...fm.head, ...fields, ...fm.tail].join(fm.eol);
  return { text, changed: text !== String(markdown ?? ''), ok: true, eol: fm.eol };
}

/**
 * B2c + B2d 的取数（纯函数）：条目自己的 photos 列表与 cover，全部按池口径算好再交给回填。
 *
 * photos：原 sidecar 顺序的展示图 ID（sidebar 没有就沿用 frontmatter 现有的，仍没有则 []）。
 * cover ：原相对路径（photos/x.webp）→ 照片 ID（x.webp），并且**必须在池里真实存在**；
 *         解析不出（如两个条目的 photos/tbd.webp 占位串）→ 空串，由前台按 A5 退回 photos[0]。
 *
 * @param {{ markdown?: string, sidecarEntries?: any[], poolIds?: Set<string>|string[] }} [input]
 */
export function planBackfill({ markdown, sidecarEntries, poolIds } = {}) {
  const markdownText = String(markdown ?? '');
  const entries = Array.isArray(sidecarEntries) ? sidecarEntries : [];
  const pool = poolIds instanceof Set ? poolIds : new Set(poolIds ?? []);

  /** @type {string[]} */
  const photos = [];
  for (const entry of entries) {
    const id = displayPhotoIdOf(entry?.file);
    if (id !== '' && !photos.includes(id)) photos.push(id);
  }
  const existingPhotos = frontmatterPhotosOf(markdownText);
  const effectivePhotos = entries.length > 0 ? photos : (existingPhotos ?? []);

  const previousCover = frontmatterValueOf(markdownText, 'cover');
  const coverId = previousCover === null ? '' : photoIdFromPath(previousCover);
  const coverResolved = coverId !== '' && pool.has(coverId);

  return {
    photos: effectivePhotos,
    cover: coverResolved ? coverId : '',
    previousCover,
    coverId,
    coverResolved,
    hadSidecar: entries.length > 0,
    hasPhotosKey: existingPhotos !== null,
  };
}

/** 池口的正文插图引用行（D2a 语法）：`![说明](photo:照片ID)`。 */
export function buildPoolIllustrationRefLines(entries) {
  /** @type {string[]} */
  const lines = [];
  for (const entry of entries ?? []) {
    const id = displayPhotoIdOf(entry?.file);
    if (id === '') continue;
    lines.push(`![${ILLUSTRATION_ALT}](photo:${id})`);
  }
  return lines;
}

/**
 * B3 的迁移报告（纯函数）：清单（搬了几张 / 跳了几张 / 去重几例）+ 各条目 photos 列表 +
 * 可复制的插图引用行 + 坏 cover 待办。CLI 与集成测共用同一份文本，避免口径漂移。
 *
 * @param {{
 *   steps?: string[],
 *   moved?: Array<{ from: string, to: string }>,
 *   skipped?: string[],
 *   dedupedGroups?: Array<{ basename: string, sources: string[] }>,
 *   dedupedFiles?: number,
 *   removedSidecars?: string[],
 *   mergedCount?: number,
 *   unregistered?: string[],
 *   entries?: Array<{ label: string, photos: string[], cover: string, coverResolved?: boolean, changed?: boolean }>,
 *   todos?: string[],
 * }} p
 */
export function buildMigrationReport(p) {
  const moved = p.moved ?? [];
  const skipped = p.skipped ?? [];
  const dedupedGroups = p.dedupedGroups ?? [];
  const entries = p.entries ?? [];
  const todos = p.todos ?? [];
  /** @type {string[]} */
  const lines = [];

  lines.push(`迁移步骤：${(p.steps ?? MIGRATE_STEPS).join(' → ')}`);
  lines.push(
    `文件搬运：移动 ${moved.length} 个 webp、跳过 ${skipped.length} 个（目标已存在且内容一致）。`,
  );
  if (dedupedGroups.length > 0) {
    const detail = dedupedGroups.map((g) => `${g.basename}（${g.sources.length} 份）`).join('、');
    lines.push(
      `按文件名去重 ${dedupedGroups.length} 例、共少 ${p.dedupedFiles ?? 0} 个文件（四条宽高 + EXIF 逐项一致才丢）：${detail}`,
    );
  } else {
    lines.push('按文件名去重：0 例（没有同名照片被多条目引用）。');
  }
  if (p.mergedCount !== undefined) {
    lines.push(`全局 sidecar：${p.mergedCount} 条 PhotoEntry（src/content/${POOL_SIDECAR_REL}）。`);
  }
  if ((p.removedSidecars ?? []).length > 0) {
    lines.push(`已删除旧条目 sidecar ${p.removedSidecars.length} 份：${(p.removedSidecars ?? []).join('、')}`);
  }
  if ((p.unregistered ?? []).length > 0) {
    lines.push(
      `⚠️ 有 ${(p.unregistered ?? []).length} 个产物没被任何 sidecar 登记，按「来源不明不猜」留在原地：${(p.unregistered ?? []).join('、')}`,
    );
  }

  if (entries.length > 0) {
    lines.push('各条目的 photos 列表（顺序 = 前台照片流顺序）：');
    for (const entry of entries) {
      const list = entry.photos.length === 0 ? '（空）' : `[${entry.photos.join(', ')}]`;
      const cover =
        entry.cover === ''
          ? entry.photos.length > 0
            ? '（空串 → 前台退回 photos[0]）'
            : '（空串，且 photos 也为空 → 封面区整块不渲染）'
          : entry.cover;
      lines.push(`  · ${entry.label}：${entry.photos.length} 张 ${list}｜cover = ${cover}`);
    }
  }

  const refLines = buildPoolIllustrationRefLines(
    entries.flatMap((entry) => entry.photos.map((id) => ({ file: `photos/${id}` }))),
  );
  if (refLines.length > 0) {
    lines.push(ILLUSTRATION_REF_HEADER.replace('后台「正文」的', '正文的'));
    for (const line of refLines) lines.push(line);
    lines.push(ILLUSTRATION_REF_TIP);
  }

  if (todos.length > 0) {
    lines.push('待办（人工决策，脚本不替你做）：');
    for (const todo of todos) lines.push(`  · ${todo}`);
  }

  return {
    lines,
    movedCount: moved.length,
    skippedCount: skipped.length,
    dedupedCount: dedupedGroups.length,
    dedupedFiles: p.dedupedFiles ?? 0,
    entryCount: entries.length,
  };
}


// -----------------------------------------------------------------------------
// I/O 区：sharp / exifr / fs 只出现在这里
// -----------------------------------------------------------------------------

/** 仓库根（本文件在 scripts/ 下）。 */
function repoRootFromMetaUrl() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * 读 EXIF：exifr 对无 EXIF / 损坏文件会抛错或返回 undefined，一律容错成 {}（字段全留空）。
 * @param {string} file
 */
async function readExif(file) {
  try {
    const { default: exifr } = await import('exifr');
    const parsed = await exifr.parse(file, true);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn(
      `  · EXIF 读取失败，按「全部留空」继续：${path.basename(file)} — ${/** @type {Error} */ (err).message}`,
    );
    return {};
  }
}

/** 列出 raw/ 下候选文件（排序保证清单稳定），并收集被忽略的格式名。 */
async function listRawFiles(rawDir) {
  /** @type {import('node:fs').Dirent[]} */
  let dirents;
  try {
    dirents = await fsp.readdir(rawDir, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      throw new Error(`找不到原图目录：${rawDir}（先把相机导出的 jpg/png 丢进去，再跑 npm run import）`);
    }
    throw err;
  }
  const supported = [];
  /** @type {string[]} */
  const ignored = [];
  for (const d of dirents) {
    if (!d.isFile()) continue;
    if (isSupportedRawImage(d.name)) supported.push(d.name);
    else if (isKnownUnsupportedImage(d.name)) ignored.push(d.name);
  }
  return { supported: supported.sort(), ignored: ignored.sort() };
}

/** 资源夹里已存在的产物相对路径集合（幂等判定的「盘上事实」）。 */
async function listExistingRels(photosAbs) {
  try {
    const names = await fsp.readdir(photosAbs);
    return new Set(names.map((n) => `${PHOTOS_PREFIX}${n}`));
  } catch {
    return new Set();
  }
}

/** 读 sidecar：不存在 → []；损坏 → 告警并按空处理（本批产物会重写出一份干净文件）。 */
async function readSidecar(sidecarAbs) {
  let text;
  try {
    text = await fsp.readFile(sidecarAbs, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('顶层不是数组');
    return /** @type {Array<{ file: string }>} */ (parsed.filter(isPhotoEntry));
  } catch (err) {
    console.warn(
      `  · 已有 sidecar 解析失败，本次按空重写：${sidecarAbs} — ${/** @type {Error} */ (err).message}`,
    );
    return [];
  }
}

/** sidecar 条目的最小形状检查（挡住外部误写的非对象/缺路径行）。 */
function isPhotoEntry(value) {
  if (!value || typeof value !== 'object') return false;
  const e = /** @type {Record<string, unknown>} */ (value);
  return typeof e.file === 'string' && typeof e.thumb === 'string';
}

/** 长边等比缩放参数：fit inside + withoutEnlargement ⇒ 长边至多 longEdge，小图不放大。 */
function resizeOptions(longEdge) {
  return { width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true };
}

/**
 * 单张图的完整加工：读尺寸/EXIF → 编码展示图与缩略图 → 写盘（缩略图先落 thumbs/ 暂存再拷进 photos/）
 * → 把编码结果里的真实宽高与字节数交给 sidecar / 清单。
 * 原图只作为 sharp 的 input 被读取，绝不被写、移、删。
 *
 * 尺寸与字节数取自 sharp 的编码输出（OutputInfo + buffer），**不再回读产物文件**：
 * 回读会让 Windows 上的文件句柄一直挂着，同一进程内重写同一路径就会 "unable to open for write"，
 * 而且白多一遍磁盘 IO。集成测试里另有独立一遍「按盘上的 webp 反查尺寸」来交叉验证这个口径。
 *
 * @param {{ rawAbs: string, entryAbs: string, thumbsAbs: string, basename: string }} p
 */
async function processPhoto({ rawAbs, entryAbs, thumbsAbs, basename }) {
  const { default: sharp } = await import('sharp');
  const rel = entryRelPaths(basename);
  const displayAbs = path.join(entryAbs, rel.file);
  const thumbAbs = path.join(entryAbs, rel.thumb);
  const thumbStagingAbs = path.join(thumbsAbs, thumbFileNameOf(basename));

  const [exifRaw, inputMeta] = await Promise.all([
    readExif(rawAbs),
    sharp(rawAbs).metadata().catch(() => ({ width: 0, height: 0, orientation: undefined })),
  ]);

  await fsp.mkdir(path.dirname(displayAbs), { recursive: true });
  await fsp.mkdir(thumbsAbs, { recursive: true });

  const display = await sharp(rawAbs)
    .rotate()
    .resize(resizeOptions(DISPLAY_LONG_EDGE))
    .webp({ quality: DISPLAY_QUALITY })
    .toBuffer({ resolveWithObject: true });
  await fsp.writeFile(displayAbs, display.data);

  // 缩略图先写进 thumbs/ 暂存区（design §4），再拷进内容资源夹；暂存副本 gitignore 掉。
  const thumb = await sharp(rawAbs)
    .rotate()
    .resize(resizeOptions(THUMB_LONG_EDGE))
    .webp({ quality: THUMB_QUALITY })
    .toBuffer({ resolveWithObject: true });
  await fsp.writeFile(thumbStagingAbs, thumb.data);
  await fsp.copyFile(thumbStagingAbs, thumbAbs);

  const planned = planOutputSize(
    /** @type {number} */ (inputMeta.width),
    /** @type {number} */ (inputMeta.height),
    inputMeta.orientation,
    DISPLAY_LONG_EDGE,
  );
  if (planned.width !== display.info.width || planned.height !== display.info.height) {
    console.warn(
      `  · 注意：${basename} 实际编码出的展示图 ${display.info.width}×${display.info.height} 与按常量推算的 ${planned.width}×${planned.height} 不一致，sidecar 以实测为准`,
    );
  }
  const longEdgeOut = Math.max(display.info.width, display.info.height);
  if (longEdgeOut > DISPLAY_LONG_EDGE) {
    console.warn(`  · 注意：${basename} 展示图长边 ${longEdgeOut} 超出常量 ${DISPLAY_LONG_EDGE}`);
  }

  return {
    entry: buildPhotoEntry({
      basename,
      width: display.info.width,
      height: display.info.height,
      thumbWidth: thumb.info.width,
      thumbHeight: thumb.info.height,
      exif: exifRaw,
    }),
    basename,
    file: rel.file,
    thumb: rel.thumb,
    bytes: display.data.length,
    thumbBytes: thumb.data.length,
    abs: { display: displayAbs, thumb: thumbAbs },
  };
}

/**
 * 统计已有系列数 → 给新系列一个递增的 order（免得后台里两个系列抢同一权重）。
 * 排除目标条目自身：photos/ 目录在本函数被调用前就已建好，否则新系列会把自己算成“已有”。
 */
async function nextSeriesOrder(contentRoot, selfIdentifier) {
  try {
    const dirents = await fsp.readdir(path.join(contentRoot, 'series'), { withFileTypes: true });
    return dirents.filter((d) => d.isDirectory() && d.name !== selfIdentifier).length + 1;
  } catch {
    return 1;
  }
}

/**
 * 编排一次导入：CLI 与集成测试共用的程序化入口。
 * root 可指向临时目录（不落 mock，纯参数注入），方便真实 sharp/exifr 跑完整管线。
 *
 * collection 省略即进池（B1）：池没有正文，因此不写草稿骨架、也不产出「条文相对」的插图引用行，
 * 而是给 D2a 语法 `![说明](photo:照片ID)`。
 *
 * @param {{
 *   collection?: 'pool'|'series'|'posts',
 *   identifier?: string,
 *   root?: string,
 *   rawDir?: string,
 *   thumbsDir?: string,
 *   only?: string[],
 *   title?: string|null,
 *   date?: string|null,
 *   log?: (line: string) => void,
 * }} [opts]
 */
export async function runImport(opts = {}) {
  const log = opts.log ?? ((line) => console.log(line));
  const root = path.resolve(opts.root ?? repoRootFromMetaUrl());
  const target = resolveTarget(
    /** @type {'pool'|'series'|'posts'} */ (opts.collection ?? POOL_DIR_NAME),
    opts.identifier ?? '',
  );
  const contentRoot = path.join(root, 'src', 'content');
  const entryAbs = path.join(contentRoot, target.entryDir);
  const photosAbs = path.join(entryAbs, PHOTOS_DIR_NAME);
  const sidecarAbs = path.join(contentRoot, target.sidecarPath);
  const markdownAbs = target.markdownPath ? path.join(contentRoot, target.markdownPath) : null;
  const rawDir = path.resolve(opts.rawDir ?? path.join(root, 'raw'));
  const thumbsAbs = path.resolve(opts.thumbsDir ?? path.join(root, THUMBS_DIR_NAME));

  const { supported, ignored } = await listRawFiles(rawDir);
  let rawFiles = supported;
  if (opts.only && opts.only.length > 0) {
    const wanted = new Set(opts.only.map((name) => baseName(String(name))));
    rawFiles = supported.filter((f) => wanted.has(baseName(f)));
    const missed = [...wanted].filter((b) => !rawFiles.some((f) => baseName(f) === b));
    if (missed.length > 0) {
      throw new Error(`--only 指定的文件不在 raw/ 里（或不是 jpg/jpeg/png）：${missed.join(', ')}`);
    }
  }

  const [existingSidecar, existingRels] = await Promise.all([
    readSidecar(sidecarAbs),
    listExistingRels(photosAbs),
  ]);
  const { newOnes, skipped } = planImports({ rawFiles, sidecar: existingSidecar, existingRels });

  /** @type {Array<Awaited<ReturnType<typeof processPhoto>>>} */
  const results = [];
  /** @type {Array<{ file: string, message: string }>} */
  const failed = [];
  if (newOnes.length > 0) {
    await fsp.mkdir(photosAbs, { recursive: true });
    for (const item of newOnes) {
      try {
        results.push(
          await processPhoto({
            rawAbs: path.join(rawDir, item.file),
            entryAbs,
            thumbsAbs,
            basename: item.basename,
          }),
        );
      } catch (err) {
        // 单张坏图不该拖垮整批：记进清单即可。它没进 sidecar，下次重跑的幂等判定仍会把它当新图再试。
        failed.push({ file: item.file, message: String(/** @type {Error} */ (err).message) });
      }
    }
    if (results.length > 0) {
      const merged = mergeSidecar(
        existingSidecar,
        results.map((r) => r.entry),
      );
      await fsp.mkdir(path.dirname(sidecarAbs), { recursive: true });
      await fsp.writeFile(sidecarAbs, serializeSidecar(merged), 'utf8');
    }
  }

  // 条目 Markdown 不存在才写草稿骨架；已存在的 .md 一个字都不碰（文字归人和后台）。
  // 池模式没有正文（markdownAbs === null），整块跳过。
  let createdEntry = false;
  let skeletonPath = null;
  if (markdownAbs && !existsSync(markdownAbs)) {
    const coverRel = results[0]?.entry?.file ?? existingSidecar[0]?.file ?? null;
    if (coverRel === null) {
      throw new Error(
        failed.length > 0
          ? `本批 ${failed.length} 张都处理失败（raw/ 里的文件可能损坏或不是真图），没有照片可当封面，条目骨架未创建：${markdownAbs}`
          : `raw/ 里没有任何待导入的图片，条目骨架未创建：${markdownAbs}`,
      );
    }
    const date = normalizeDate(opts.date) ?? dateFromIdentifier(target.identifier) ?? todayISO();
    const markdown =
      target.collection === 'series'
        ? renderSeriesMarkdown({
            identifier: target.identifier,
            title: opts.title,
            date,
            cover: coverRel,
            order: await nextSeriesOrder(contentRoot, target.identifier),
          })
        : renderPostMarkdown({ identifier: target.identifier, title: opts.title, date, cover: coverRel });
    await fsp.mkdir(path.dirname(markdownAbs), { recursive: true });
    await fsp.writeFile(markdownAbs, markdown, 'utf8');
    createdEntry = true;
    skeletonPath = path.relative(root, markdownAbs).split(path.sep).join('/');
  }

  const manifest = buildManifest({
    target,
    createdEntry,
    skeletonPath: skeletonPath ?? target.markdownPath,
    added: results.map((r) => ({
      basename: r.basename,
      file: r.file,
      thumb: r.thumb,
      width: r.entry.width,
      height: r.entry.height,
      thumbWidth: r.entry.thumbWidth,
      thumbHeight: r.entry.thumbHeight,
      bytes: r.bytes,
      thumbBytes: r.thumbBytes,
    })),
    skipped,
    failed,
    ignored,
  });

  log(`开始导入：raw=${path.relative(root, rawDir) || '.'} → src/content/${target.entryDir}`);
  for (const line of manifest.lines) log(line);

  // 本次确实新增了照片时，附一段「可粘贴到后台正文（Markdown 模式）」的插图引用行，
  // 非技术用户照抄即可（口径与逻辑见纯函数区 buildIllustrationRefLines 的注释）。
  // 池模式用 D2a 语法 `![说明](photo:照片ID)`：照片只有一份，正文不必再拼条目相对路径。
  if (results.length > 0) {
    const refLines =
      target.collection === POOL_DIR_NAME
        ? buildPoolIllustrationRefLines(results.map((r) => r.entry))
        : buildIllustrationRefLines({
            sidecar: results.map((r) => r.entry),
            collection: target.collection,
            entryId: target.identifier,
          });
    if (refLines.length > 0) {
      log(ILLUSTRATION_REF_HEADER);
      for (const line of refLines) log(line);
      log(ILLUSTRATION_REF_TIP);
    }
  }

  return {
    target,
    manifest,
    added: results,
    skipped,
    failed,
    createdEntry,
    paths: { entryAbs, photosAbs, sidecarAbs, markdownAbs, rawDir, thumbsDir: thumbsAbs },
  };
}

// -----------------------------------------------------------------------------
// 迁移 I/O（--migrate）：只有这一节会删/移 src/content 下的产物，且绝不指向 raw/
// -----------------------------------------------------------------------------

/**
 * 递归列出目录下所有文件（相对给定根的 POSIX 路径，排序保证每次跑的顺序一致）。
 * 目录不存在返回空数组（全新的临时仓库也能跑）。
 * @param {string} absDir
 */
async function walkRelFiles(absDir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} abs @param {string} prefix */
  const walk = async (abs, prefix) => {
    /** @type {import('node:fs').Dirent[]} */
    let dirents;
    try {
      dirents = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) await walk(path.join(abs, dirent.name), rel);
      else out.push(rel);
    }
  };
  await walk(absDir, '');
  return out;
}

/**
 * 迁移用的严格 sidecar 读取：解析失败或出现非 PhotoEntry 行就停下。
 * 导入期的 readSidecar 会「按空重写」自愈；迁移期这么做等于静默删数据，故必须失败。
 * @param {string} absPath
 */
async function readSidecarForMigration(absPath) {
  const text = await fsp.readFile(absPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`sidecar 不是合法 JSON，迁移中止（人工修好后再跑）：${absPath} — ${String(/** @type {Error} */ (err).message)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`sidecar 顶层不是数组，迁移中止：${absPath}`);
  }
  parsed.forEach((item, index) => {
    if (!isPhotoEntry(item)) {
      throw new Error(`sidecar 第 ${index + 1} 条不是合法 PhotoEntry，迁移中止（缺 file/thumb）：${absPath}`);
    }
  });
  return parsed;
}

/** 把一个文件搬到目标位置（同盘 rename；跨盘/权限受限时 copy + 删源）。 */
async function moveArtifact(fromAbs, toAbs) {
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  try {
    await fsp.rename(fromAbs, toAbs);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err;
    await fsp.copyFile(fromAbs, toAbs);
    await fsp.unlink(fromAbs);
  }
}

/** 两个文件是否逐字节一致（去重/覆盖前的最后一道证据，比文件名可信）。 */
async function sameBytes(aAbs, bAbs) {
  const [a, b] = await Promise.all([fsp.readFile(aAbs), fsp.readFile(bAbs)]);
  return a.equals(b);
}

/** 读全局 sidecar 里的展示图 ID 集合（迁移的「池里真有什么」判据）。 */
async function readPoolIds(poolSidecarAbs) {
  const entries = await readSidecar(poolSidecarAbs);
  /** @type {Set<string>} */
  const ids = new Set();
  for (const entry of entries) {
    const id = displayPhotoIdOf(entry?.file);
    if (id !== '') ids.add(id);
  }
  return ids;
}

/**
 * 执行池化迁移（--migrate）。四步各自可独立跑，也可一次跑全套：
 *   move → merge → backfill → cover（顺序固定，与 B2a~B2d 一致）
 *
 * 原图完全不参与：本函数只在 src/content 下移动/删除 webp 产物与旧 sidecar，
 * raw/ 既不读入清单、也不出现在任何路径拼接里（K6）。
 *
 * @param {{ root?: string, steps?: string[], log?: (line: string) => void }} [opts]
 */
export async function runMigration(opts = {}) {
  const log = opts.log ?? ((line) => console.log(line));
  const root = path.resolve(opts.root ?? repoRootFromMetaUrl());
  const steps =
    Array.isArray(opts.steps) && opts.steps.length > 0
      ? parseMigrateSteps(opts.steps.join(','))
      : [...MIGRATE_STEPS];
  const contentRoot = path.join(root, 'src', 'content');
  const poolPhotosAbs = path.join(contentRoot, POOL_PHOTOS_REL);
  const poolSidecarAbs = path.join(contentRoot, POOL_SIDECAR_REL);

  const files = await walkRelFiles(contentRoot);
  const legacyEntries = discoverLegacyEntries(files);
  const markdowns = discoverEntryMarkdowns(files);
  /** @type {Array<{ entryDir: string, collection: string, id: string, entries: any[] }>} */
  const sources = [];
  for (const entry of legacyEntries) {
    sources.push({
      entryDir: entry.entryDir,
      collection: entry.collection,
      id: entry.id,
      entries: await readSidecarForMigration(path.join(contentRoot, entry.sidecarPath)),
    });
  }

  const plan = planPoolMoves({ sources, files });
  if (plan.conflicts.length > 0) {
    const detail = plan.conflicts.map((c) => `${c.basename}（${c.keptFrom} vs ${c.from}：${c.reason}）`).join('；');
    throw new Error(`迁移中止：同名照片的 sidecar 记录不一致，去重会丢数据 —— ${detail}`);
  }

  /** @type {Array<{ from: string, to: string, basename?: string }>} */
  const moved = [];
  /** @type {string[]} */
  const skippedMoves = [];
  /** @type {string[]} 因同名同内容而删掉的重复副本 */
  const droppedDuplicates = [];
  /** @type {string[]} */
  const removedSidecars = [];
  let mergedCount;

  // ── B2a 文件搬运：侧车登记的 file / thumb → pool/photos/ 同名文件
  if (steps.includes('move')) {
    for (const item of plan.moves) {
      const fromAbs = path.join(contentRoot, item.from);
      const toAbs = path.join(contentRoot, item.to);
      if (!existsSync(fromAbs)) {
        if (existsSync(toAbs)) {
          skippedMoves.push(item.from);
          continue;
        }
        throw new Error(`迁移中止：sidecar 登记的 ${item.from} 在磁盘上不存在（先修好 sidecar 或补回文件）`);
      }
      if (existsSync(toAbs)) {
        if (!(await sameBytes(fromAbs, toAbs))) {
          throw new Error(`迁移中止：池里已有同名但内容不同的文件 ${item.to}（来源 ${item.from}），不覆盖`);
        }
        await fsp.unlink(fromAbs);
        droppedDuplicates.push(item.from);
        continue;
      }
      await moveArtifact(fromAbs, toAbs);
      moved.push({ from: item.from, to: item.to });
    }
    for (const dup of plan.duplicates) {
      const fromAbs = path.join(contentRoot, dup.from);
      const toAbs = path.join(contentRoot, dup.to);
      if (!existsSync(fromAbs)) {
        skippedMoves.push(dup.from);
        continue;
      }
      if (!existsSync(toAbs)) {
        throw new Error(`迁移中止：去重目标 ${dup.to} 不存在（先跑 move 再跑去重）`);
      }
      if (!(await sameBytes(fromAbs, toAbs))) {
        throw new Error(`迁移中止：同名文件内容不同 ${dup.from} vs ${dup.keptFrom}，不删任何一份`);
      }
      await fsp.unlink(fromAbs);
      droppedDuplicates.push(dup.from);
    }
  }

  // ── B2b sidecar 合并：多份旧 sidecar → 一份全局，按文件名去重（指纹一致才丢）
  // 注意：旧 sidecar 不在这里删。各条目的 photos 列表要靠它才能按原顺序回填（B2c），
  // 删除动作放到 backfill 末尾（且只在全局 sidecar 已覆盖它时）——这样四步分开跑也不丢归属。
  if (steps.includes('merge')) {
    const merged = mergeLegacySidecars(sources);
    if (merged.conflicts.length > 0) {
      const detail = merged.conflicts.map((c) => `${c.basename}（${c.from.join(' vs ')}）`).join('；');
      throw new Error(`迁移中止：同名照片的元数据不一致 —— ${detail}`);
    }
    const existingPool = await readSidecar(poolSidecarAbs);
    const finalEntries = mergeSidecar(existingPool, merged.entries);
    await fsp.mkdir(path.dirname(poolSidecarAbs), { recursive: true });
    await fsp.writeFile(poolSidecarAbs, serializeSidecar(finalEntries), 'utf8');
    mergedCount = finalEntries.length;
  }

  // 全局 sidecar 自己覆盖了哪些照片（判断旧 sidecar 能否安全删除，不掺本次 sources）
  const globalPoolIds = await readPoolIds(poolSidecarAbs);

  // 「池里真有什么」= 全局 sidecar ∪ 本次旧 sidecar ∪ 搬过来的目标文件
  // （后两项让 --migrate=backfill / cover 单独跑也不会把合法 cover 误判成坏 cover）
  const poolIds = await readPoolIds(poolSidecarAbs);
  for (const source of sources) {
    for (const entry of source.entries) {
      const id = displayPhotoIdOf(entry?.file);
      if (id !== '') poolIds.add(id);
    }
  }
  for (const item of plan.moves) {
    const id = displayPhotoIdOf(item.to);
    if (id !== '') poolIds.add(id);
  }

  /** @type {Array<{ label: string, photos: string[], cover: string, changed: boolean }>} */
  const entryReports = [];
  /** @type {string[]} */
  const todos = [];

  /** 写回一个条目的 photos/cover，返回它最终落在盘上的状态。 */
  const backfillOne = async (md) => {
    const abs = path.join(contentRoot, md.markdownPath);
    const before = await fsp.readFile(abs, 'utf8');
    const source = sources.find((s) => s.entryDir === md.entryDir);
    const planned = planBackfill({
      markdown: before,
      sidecarEntries: source?.entries ?? [],
      poolIds,
    });
    const applied = applyFrontmatterBackfill(before, {
      photos: planned.photos,
      cover: planned.cover,
    });
    if (applied.changed) await fsp.writeFile(abs, applied.text, 'utf8');
    return {
      label: `${md.collection}/${md.id}`,
      photos: planned.photos,
      cover: planned.cover,
      previousCover: planned.previousCover ?? null,
      coverResolved: planned.coverResolved,
      changed: applied.changed,
      eol: applied.eol,
    };
  };

  // ── B2c frontmatter 回填：photos 按原 sidecar 顺序；cover 从相对路径换算成照片 ID
  if (steps.includes('backfill')) {
    for (const md of markdowns) entryReports.push(await backfillOne(md));
    // 回填完成后，旧 sidecar 才允许删除：必须已被全局 sidecar 完整覆盖，
    // 否则留着（否则后续再跑 backfill 就无从知道这些照片原本属于哪个条目）。
    for (const entry of legacyEntries) {
      const ids = sources
        .filter((source) => source.entryDir === entry.entryDir)
        .flatMap((source) => source.entries.map((item) => displayPhotoIdOf(item?.file)))
        .filter(Boolean);
      const covered = ids.every((id) => globalPoolIds.has(id));
      if (!covered) continue;
      const abs = path.join(contentRoot, entry.sidecarPath);
      if (!existsSync(abs)) continue;
      await fsp.unlink(abs);
      removedSidecars.push(entry.sidecarPath);
    }
  }

  // ── B2d 坏 cover（K1 + A5）：解析不到池内照片的 cover 置空串，并留下待办
  if (steps.includes('cover')) {
    for (const md of markdowns) {
      const result = await backfillOne(md);
      if (!steps.includes('backfill')) entryReports.push(result);
      const abs = path.join(contentRoot, md.markdownPath);
      const text = await fsp.readFile(abs, 'utf8');
      const photos = frontmatterPhotosOf(text) ?? [];
      const cover = frontmatterValueOf(text, 'cover') ?? '';
      if (cover === '' && photos.length === 0) {
        todos.push(
          `${md.collection}/${md.id}：cover 已置空串且 photos 为空 —— 前台封面区整块不渲染；要出图请在后台从池里挑一张顶上（K1/A5）。`,
        );
      } else if (cover === '') {
        todos.push(
          `${md.collection}/${md.id}：cover 已置空串 —— 前台退回 photos[0]（${photos[0]}）；想指定别的封面就填对应照片 ID。`,
        );
      }
    }
  }

  const report = buildMigrationReport({
    steps,
    moved,
    skipped: skippedMoves,
    dedupedGroups: groupDuplicateBasenames(plan.duplicates),
    dedupedFiles: droppedDuplicates.length,
    removedSidecars,
    mergedCount,
    unregistered: plan.unregistered,
    entries: entryReports,
    todos,
  });

  log(`开始迁移：src/content（原图 raw/ 不参与，永不移动、永不删除）`);
  for (const line of report.lines) log(line);
  if (steps.length < MIGRATE_STEPS.length) {
    log(
      `注意：本次只跑了 ${steps.join(' / ')}（共 ${MIGRATE_STEPS.length} 步），中途状态可能过不了 check-images；` +
        '跑满 `npm run import -- --migrate` 才算迁移完成。',
    );
  }

  return {
    steps,
    moved,
    skipped: skippedMoves,
    dedupedFiles: droppedDuplicates,
    dedupedGroups: groupDuplicateBasenames(plan.duplicates),
    removedSidecars,
    mergedCount,
    unregistered: plan.unregistered,
    entries: entryReports,
    todos,
    report,
    paths: { contentRoot, poolPhotosAbs, poolSidecarAbs },
  };
}

// -----------------------------------------------------------------------------
// CLI：runCli 是可注入的决策核心，main() 只是薄壳（入口 = npm run import）
// -----------------------------------------------------------------------------

/** 非交互终端（stdin 不是 TTY）时的提示语：CI / 重定向 / 双击运行下不至于挂住。 */
export const NON_INTERACTIVE_HINT =
  '当前不是可交互的终端，无法问你目标：不带参数时默认进池，要指定条目请把参数写全，例如 npm run import -- --pool 或 npm run import -- --series daily-frames 或 npm run import -- --post 2026-09-24-evening-stroll';

/** 交互第一问的文案（测试与 README 以此为準）。 */
export const PROMPT_KIND = '导入到哪里？输入 1 = 系列(series)，2 = 随笔(posts)［默认 1，进池请直接用 --pool］：';
/** 第二问：系列标识。 */
export const PROMPT_SERIES_ID = '系列标识（英文小写-连字符，如 daily-frames；不存在则当场新建草稿系列）：';
/** 第二问：随笔标识。 */
export const PROMPT_POST_ID = '随笔标识（日期-标题，如 2026-09-24-evening-stroll；对应 .md 不存在则新建草稿骨架）：';

/** 第一问的答案 → 目标类型：以 2 开头算随笔，其余（含直接回车）走系列。 */
export function pickCollection(kindAnswer) {
  /** @type {'series'|'posts'} */
  const collection = String(kindAnswer ?? '').trim().startsWith('2') ? 'posts' : 'series';
  return collection;
}

/**
 * 解释交互式的两个回答（纯函数，便于单测）：1/回车 = 系列，2 = 随笔；标识再过一遍校验。
 * @param {string} kindAnswer
 * @param {string} identifierAnswer
 * @returns {{ collection: 'series'|'posts', identifier: string }}
 */
export function interpretPromptAnswers(kindAnswer, identifierAnswer) {
  return { collection: pickCollection(kindAnswer), identifier: validateIdentifier(identifierAnswer) };
}

/**
 * 交互式询问目标类型与标识（只在 runCli 判定 stdin 可交互时被调用）。
 * input / output 可注入（测试用 PassThrough 真跑一遍问答序列），默认接进程的 stdio。
 *
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, log?: (line: string) => void }} [streams]
 * @returns {Promise<{ collection: 'series'|'posts', identifier: string }>}
 */
export async function promptTarget(streams = {}) {
  const { createInterface } = await import('node:readline/promises');
  const log = streams.log ?? ((line) => console.log(line));
  const rl = createInterface({
    input: /** @type {import('node:readline').Readable} */ (streams.input ?? process.stdin),
    output: /** @type {import('node:readline').Writable} */ (streams.output ?? process.stdout),
  });
  try {
    const kind = String(await rl.question(PROMPT_KIND));
    const hint = pickCollection(kind) === 'series' ? PROMPT_SERIES_ID : PROMPT_POST_ID;
    let identifier = '';
    for (let attempt = 0; attempt < 3 && identifier === ''; attempt += 1) {
      identifier = String(await rl.question(hint)).trim();
      if (identifier === '') log('标识不能为空，请再输入一次。');
    }
    return interpretPromptAnswers(kind, identifier);
  } finally {
    rl.close();
  }
}

/**
 * CLI 决策核心：解析参数 → （迁移分支 / 问目标）→ 调导入 → 定退出码。
 * log / logError / stdinIsTty / runImport / runMigration / ask 都可注入，
 * 于是「help、参数错、非交互、坏图退 1、迁移步骤」这些分支能被真断言，
 * 而不必真的往 src/content 写盘。
 *
 * @param {string[]} argv
 * @param {{
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 *   stdinIsTty?: boolean,
 *   runImport?: typeof runImport,
 *   runMigration?: typeof runMigration,
 *   ask?: () => Promise<{ collection: 'series'|'posts', identifier: string }>,
 *   input?: NodeJS.ReadableStream,
 *   output?: NodeJS.WritableStream,
 * }} [io]
 * @returns {Promise<number>} 进程退出码
 */
export async function runCli(argv, io = {}) {
  const log = io.log ?? ((line) => console.log(line));
  const logError = io.logError ?? ((line) => console.error(line));
  const doImport = io.runImport ?? runImport;
  const doMigrate = io.runMigration ?? runMigration;
  const isTty = io.stdinIsTty ?? Boolean(process.stdin.isTTY);

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    logError(String(/** @type {Error} */ (err).message));
    return 1;
  }
  if (parsed.help) {
    log(HELP_TEXT);
    return 0;
  }

  // --migrate：只整理已入库产物（不碰 raw/），与导入目标互斥（parseArgs 已拦住组合）。
  if (parsed.migrate) {
    try {
      await doMigrate({ steps: parsed.migrate, log });
      return 0;
    } catch (err) {
      logError(`迁移失败：${String(/** @type {Error} */ (err).message)}`);
      return 1;
    }
  }

  /** @type {'pool'|'series'|'posts'} */
  let collection = parsed.pool ? POOL_DIR_NAME : /** @type {any} */ (parsed.collection);
  /** @type {string} */
  let identifier = parsed.identifier ?? '';

  // --ask 才走交互（池是默认目标，平时不必问）；非交互终端下 --ask 要报错而不是挂住。
  if (parsed.ask && !parsed.collection) {
    if (!isTty && !io.ask) {
      logError(NON_INTERACTIVE_HINT);
      return 1;
    }
    try {
      const asked = io.ask ? await io.ask() : await promptTarget(io);
      collection = asked.collection;
      identifier = asked.identifier;
    } catch (err) {
      logError(String(/** @type {Error} */ (err).message));
      return 1;
    }
  }

  // 不带任何目标参数 → 默认进池（B1）。池没有标识，传空串即可（resolveTarget 会补齐）。
  if (!collection) collection = /** @type {'pool'} */ (POOL_DIR_NAME);

  try {
    const { manifest } = await doImport({
      collection,
      identifier,
      only: parsed.only,
      title: parsed.title,
      date: parsed.date,
    });
    if (manifest.failedCount > 0) {
      logError(
        `有 ${manifest.failedCount} 张没导入成功，见上面清单里的原因（退出码 1）。原图与其它照片都未受影响。`,
      );
      return 1;
    }
    return 0;
  } catch (err) {
    logError(`导入失败：${String(/** @type {Error} */ (err).message)}`);
    return 1;
  }
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
