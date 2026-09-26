// =============================================================================
// import-photos —— 全站照片的唯一入库通道（design §4，含 2026-09-24 随笔同通道补拍板）
//
// 做什么：扫描 raw/ 的相机原图（jpg/jpeg/png）→ 每张产出
//   ① 展示版 photos/<base>.webp        长边 DISPLAY_LONG_EDGE，WebP，DISPLAY_QUALITY
//   ② 缩略图 photos/<base>.thumb.webp  长边 THUMB_LONG_EDGE， WebP，THUMB_QUALITY
//   ③ EXIF sidecar photos.meta.json    PhotoEntry[]（file/thumb/宽高/exif；顺序即灯箱帧序列）
// 落到 src/content/<series|posts>/<标识>/；条目或 .md 不存在则以 draft:true 当场新建。
//
// 不做什么（硬约束）：
//   - 原图**永不移动、永不删除**：本文件对 raw/ 只读不写，不出现任何 unlink / rm / rename /
//     rmdir 调用（tests 有一条源码扫描用例守住这点）。
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
//     sidecar 组装与合并 / 落位路径 / Markdown 骨架 / 参数解析 / 导入清单
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
  '用法：npm run import -- --series <系列标识> | --post <日期-标题> [options]',
  '',
  '  --series, -s <标识>   导入到 src/content/series/<标识>/（不存在则当场新建草稿系列）',
  '  --post,    -p <标识>  导入到 src/content/posts/<标识>/（<标识>.md 不存在则新建草稿骨架）',
  '  --only <a,b.jpg>      本次只导入指定的 raw/ 文件名（逗号分隔，可省扩展名）',
  '  --title <标题>        新建骨架用的标题；省略则由标识派生',
  '  --date <YYYY-MM-DD>   新建骨架用的日期；省略则随笔取标识前缀、系列取今天',
  '  --help,  -h           显示本帮助',
  '',
  '两个目标参数都不给时，脚本交互式询问类型与标识。',
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
 * @param {string[]} argv
 * @returns {{
 *   collection: 'series'|'posts'|null,
 *   identifier: string|null,
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
  /** @type {string[]} */
  const only = [];
  let title = null;
  let date = null;
  let help = false;

  const flag = (name) => (name === '--series' || name === '-s' ? '--series' : '--post');
  const assign = (next, value, name) => {
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

  // assign() 已保证 collection 与 identifier 同生同灭（缺值当场报错），故此处无需再校验组合。
  return { collection, identifier, only, title, date, help, interactive: collection === null };
}

/**
 * 落位约定（design §4 + progress.md 2026-09-24 编排拍板：展示图与缩略图同放 photos/，
 * 而非任务 7 字面的 images/+thumbnails/ 双目录）。
 *   series → src/content/series/<标识>/{photos/<b>.webp, photos/<b>.thumb.webp, photos.meta.json, index.md}
 *   posts  → src/content/posts/<日期-标题>/{photos/…, photos.meta.json} + 同级 <日期-标题>.md
 * 返回路径全部相对 src/content（绝对路径由调用方拼 root，便于集成测把 root 指到临时目录）。
 *
 * @param {'series'|'posts'} collection
 * @param {string} identifier
 */
export function resolveTarget(collection, identifier) {
  if (collection !== 'series' && collection !== 'posts') {
    throw new Error(`未知的目标类型：${String(collection)}（只支持 series / posts）`);
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

  lines.push(`目标条目：${p.target.collection}/${p.target.identifier}（资源夹 src/content/${p.target.entryDir}/）`);
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
 * @param {{
 *   collection?: 'series'|'posts',
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
    /** @type {'series'|'posts'} */ (opts.collection),
    opts.identifier ?? '',
  );
  const contentRoot = path.join(root, 'src', 'content');
  const entryAbs = path.join(contentRoot, target.entryDir);
  const photosAbs = path.join(entryAbs, PHOTOS_DIR_NAME);
  const sidecarAbs = path.join(contentRoot, target.sidecarPath);
  const markdownAbs = path.join(contentRoot, target.markdownPath);
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
  let createdEntry = false;
  let skeletonPath = null;
  if (!existsSync(markdownAbs)) {
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
// CLI：runCli 是可注入的决策核心，main() 只是薄壳（入口 = npm run import）
// -----------------------------------------------------------------------------

/** 非交互终端（stdin 不是 TTY）时的提示语：CI / 重定向 / 双击运行下不至于挂住。 */
export const NON_INTERACTIVE_HINT =
  '当前不是可交互的终端，无法问你目标：请直接把参数写全，例如 npm run import -- --series daily-frames 或 npm run import -- --post 2026-09-24-evening-stroll';

/** 交互第一问的文案（测试与 README 以此为準）。 */
export const PROMPT_KIND = '导入到哪里？输入 1 = 系列(series)，2 = 随笔(posts)［默认 1］：';
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
 * CLI 决策核心：解析参数 → （必要时）问目标 → 调导入 → 定退出码。
 * log / logError / stdinIsTty / runImport / ask 都可注入，
 * 于是「help、参数错、非交互、坏图退 1」这些分支能被真断言，而不必真的往 src/content 写盘。
 *
 * @param {string[]} argv
 * @param {{
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 *   stdinIsTty?: boolean,
 *   runImport?: typeof runImport,
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

  /** @type {'series'|'posts'|null} */
  let collection = parsed.collection;
  let identifier = parsed.identifier;
  if (!collection || !identifier) {
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

  /** @type {'series'|'posts'} */
  const targetCollection = /** @type {'series'|'posts'} */ (collection);
  /** @type {string} */
  const targetIdentifier = /** @type {string} */ (identifier);

  try {
    const { manifest } = await doImport({
      collection: targetCollection,
      identifier: targetIdentifier,
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
