// =============================================================================
// photos.js —— 照片池的「ID 口径 + 勾选排序 + sidecar 追加」（纯函数）
//
// 口径（必须与 src/utils/contentImages.ts / photoPool.ts 一致，改一边就两边都改）：
//   · 照片 ID = 池内完整文件名含 .webp，如 `night-01.webp`
//   · 展示版 <base>.webp 与缩略图 <base>.thumb.webp 是两个不同 ID，互不命中
//   · sidecar 的 file / thumb 存池内相对路径 `photos/<文件名>`
//   · frontmatter 的 photos[] 顺序 = 前台照片流顺序（后台拖拽顺序直接落成它）
//
// 单测：tests/unit/admin-photos.test.ts
// =============================================================================

import { POOL_PHOTOS_DIR, PHOTO_BASENAME_PATTERN } from './config.js';

/** `photos/` 前缀（sidecar 的 file / thumb 口径）。 */
export const PHOTOS_PREFIX = 'photos/';

/**
 * 照片 ID：取末段文件名（含扩展名）。
 * 入参可宽：ID 本身、`photos/x.webp`、旧条目路径、带查询串的 URL —— 与前台 photoIdOf 同规则。
 */
export function photoIdOf(idOrPath) {
  const clean = String(idOrPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('?')[0]
    .split('#')[0];
  return clean.split('/').filter(Boolean).pop() ?? '';
}

/** 照片 ID → 池内相对路径 `photos/<id>`（sidecar file/thumb 口径）。 */
export function poolRelPath(idOrPath) {
  const id = photoIdOf(idOrPath);
  return id ? `${PHOTOS_PREFIX}${id}` : '';
}

/** 照片 ID → 仓库内真实路径（PUT 的目标）。 */
export function poolPhotoPath(idOrPath) {
  const id = photoIdOf(idOrPath);
  return id ? `${POOL_PHOTOS_DIR}/${id}` : '';
}

/** 照片 ID → 缩略图 ID（`x.webp` → `x.thumb.webp`）。 */
export function thumbIdOf(idOrPath) {
  const id = photoIdOf(idOrPath);
  if (!id) return '';
  if (id.endsWith('.thumb.webp')) return id;
  return id.replace(/\.webp$/i, '') + '.thumb.webp';
}

/** 是否缩略图 ID。 */
export function isThumbId(idOrPath) {
  return /\.thumb\.webp$/i.test(photoIdOf(idOrPath));
}

/** sidecar 条目 → 照片 ID。 */
export function entryPhotoId(entry) {
  return photoIdOf(entry?.file);
}

/** 勾选 / 取消勾选：返回新数组（不原地改，方便 React 式的状态对比与单测）。 */
export function togglePhoto(list, id) {
  const target = photoIdOf(id);
  const current = Array.isArray(list) ? list.slice() : [];
  if (!target) return current;
  const index = current.indexOf(target);
  if (index === -1) current.push(target);
  else current.splice(index, 1);
  return current;
}

/** 把 from 位置的照片移到 to 位置（越界自动夹紧；from === to 原样返回副本）。 */
export function movePhoto(list, from, to) {
  const current = Array.isArray(list) ? list.slice() : [];
  if (current.length === 0) return current;
  const start = Number(from);
  const end = Number(to);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return current;
  if (start < 0 || start >= current.length) return current;
  const target = Math.min(Math.max(end, 0), current.length - 1);
  if (start === target) return current;
  const [moved] = current.splice(start, 1);
  current.splice(target, 0, moved);
  return current;
}

/** 按 ID 移动（拖拽落在某张图上时，用它算出目标下标）。 */
export function movePhotoToId(list, id, toIndex) {
  const current = Array.isArray(list) ? list : [];
  const from = current.indexOf(photoIdOf(id));
  if (from === -1) return current.slice();
  return movePhoto(current, from, toIndex);
}

/** 池 sidecar 里是否已有这张图（按 ID 判定）。 */
export function hasPhoto(sidecar, id) {
  const target = photoIdOf(id);
  if (!target || !Array.isArray(sidecar)) return false;
  return sidecar.some((entry) => entryPhotoId(entry) === target);
}

/** sidecar 里查一条（按 ID）。 */
export function findPhoto(sidecar, id) {
  const target = photoIdOf(id);
  if (!target || !Array.isArray(sidecar)) return undefined;
  return sidecar.find((entry) => entryPhotoId(entry) === target);
}

/**
 * 追加一条 PhotoEntry：同 ID 已存在则整条替换（幂等），否则追加到末尾。
 * 返回新数组，不动入参（sidecar 是唯一元数据源，改写前先留旧值便于回滚）。
 */
export function appendPhotoEntry(sidecar, entry) {
  const current = Array.isArray(sidecar) ? sidecar.slice() : [];
  const id = photoIdOf(entry?.file);
  if (!id) throw new TypeError('appendPhotoEntry 需要 entry.file');
  const index = current.findIndex((item) => entryPhotoId(item) === id);
  if (index === -1) current.push(entry);
  else current[index] = entry;
  return current;
}

/** 生成直传条目要用的文件名基：`web-20261024-153012-a1b2`。 */
export function makeBaseName(now = new Date(), random = Math.random) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(
    now.getUTCHours(),
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const salt = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `web-${stamp}-${salt}`;
}

/** 文件名基是否合法（小写字母/数字/连字符/下划线，长度 1~80）。 */
export function isValidBaseName(name) {
  const text = String(name ?? '').trim();
  if (!text || text.length > 80) return false;
  return PHOTO_BASENAME_PATTERN.test(text);
}

/**
 * 直传产物 → 一条 sidecar 条目。
 *
 * E6 既定取舍：浏览器读不到 EXIF，所以 exif 全空并打 `exifIncomplete: true`
 * （池页与前台 EXIF 卡据此显示「EXIF 待补」）；宽高取自 Canvas 产物的真实尺寸，不按常量推算。
 *
 * @param {{baseName:string, width:number, height:number, thumbWidth:number, thumbHeight:number}} spec
 */
export function buildUploadEntry(spec) {
  const base = String(spec?.baseName ?? '').trim();
  if (!isValidBaseName(base)) {
    throw new TypeError(`文件名基不合法：${base}（只用小写字母、数字、- 或 _）`);
  }
  const id = `${base}.webp`;
  const dims = ['width', 'height', 'thumbWidth', 'thumbHeight'].map((key) => {
    const value = Number(spec?.[key]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${key} 必须是正整数（来自 Canvas 产物的真实宽高）`);
    }
    return Math.round(value);
  });
  const [width, height, thumbWidth, thumbHeight] = dims;
  return {
    file: `${PHOTOS_PREFIX}${id}`,
    thumb: `${PHOTOS_PREFIX}${thumbIdOf(id)}`,
    width,
    height,
    thumbWidth,
    thumbHeight,
    exif: {
      camera: null,
      lens: null,
      focalLength: null,
      aperture: null,
      shutter: null,
      iso: null,
      dateTaken: null,
      // 渲染用镜像：页面只把 exif 交给 EXIF 卡（不改页面），故标记随 exif 一起走（见 photoSidecar.ts 注释）
      exifIncomplete: true,
    },
    exifIncomplete: true,
  };
}

/**
 * 预览 URL。
 *
 * ⚠️ 与 imageUrl.ts 的约定：后台不能 import 前台模块，预览拼串自己实现一份同规则
 * （同源根 '/' + 可选 PUBLIC_IMAGE_BASE）。但照片池在 src/content 下，构建后**不由站点
 * 按原路径服务**（Astro 会把它变成 /_astro/ 的资源），所以池里的图只能从仓库原始地址预览：
 * publicly readable 仓库 → raw.githubusercontent.com；拼串规则仍然是「base + 相对路径」。
 *
 * @param {{owner:string, repo:string, branch:string, rawBase?:string, path?:string}} options
 */
export function rawPhotoUrl({ owner, repo, branch, rawBase = 'https://raw.githubusercontent.com', path } = {}) {
  const rel = String(path ?? '').replace(/^\/+/, '');
  if (!rel) return '';
  const base = String(rawBase).replace(/\/+$/, '');
  return `${base}/${owner}/${repo}/${branch}/${rel}`;
}

export default {
  photoIdOf,
  poolRelPath,
  poolPhotoPath,
  togglePhoto,
  movePhoto,
  appendPhotoEntry,
  buildUploadEntry,
};
