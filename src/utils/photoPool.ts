// =============================================================================
// photoPool —— 池化后前台的「照片 ID -> PhotoEntry」唯一查表口径（admin-v2.md D 组）
//
// 为什么单独成模块：池化之后全站只有一份元数据（src/content/pool/photos.meta.json），
// 系列详情 / 首页 / 两个目次页 / 随笔详情都要做同一件事——拿 frontmatter 里的照片 ID
// （`night-01.webp`）去池里查那一条 PhotoEntry（真宽高 / 缩略图 / EXIF）。
// 各页面各写一遍 = 口径漂移，故收在这里。
//
// 边界（勿偏离）：
//   ① 本模块只读，不写盘、不移动照片（raw/ 原图永不移动是 import 脚本的硬约束）；
//   ② 照片 ID 口径 = 池内完整文件名（含 .webp），与 sidecar 的 file 末段一致；
//      「条目相对路径 / 池内相对路径 / 带查询串的 URL」都按末段归一，由 photoIdOf 负责；
//   ③ 封面三级回退（A5 / K1）：cover（非空）→ photos[0] → 空串（调用方据此整块不渲染）；
//   ④ 查不到就返回 undefined，**绝不**伪造宽高 —— 页面按「跳过该图 + 构建期告警」处理。
//
// 读 sidecar 用 import.meta.glob（构建期静态解析，与 contentImages 同一手法），
// 因此本模块在 Vitest 里也能读到真实 JSON（vitest 走 Vite 转换），单测不必 mock 文件。
// =============================================================================

import { photoIdOf } from './contentImages';
import type { PhotoEntry, PhotoSidecar } from '../types/photoSidecar';

/** 全局 sidecar 的站点绝对路径（import.meta.glob 的 key 口径）。 */
export const POOL_SIDECAR_GLOB = '/src/content/pool/photos.meta.json';

const poolSidecarModules = import.meta.glob('/src/content/pool/photos.meta.json', {
  eager: true,
  import: 'default',
}) as Record<string, PhotoSidecar>;

/**
 * 全局照片元数据（PhotoEntry 数组）。
 * 文件缺失 / 不是数组时退化为空数组 —— 页面因此自然渲染「无照片」，而不是构建崩掉。
 */
export const poolSidecar: PhotoSidecar = (() => {
  const first = Object.values(poolSidecarModules)[0];
  return Array.isArray(first) ? first : [];
})();

/**
 * 收掉插图协议头：`photo:night-01.webp` → `night-01.webp`。
 * photoIdOf 只按路径末段归一，不认自定协议；这里补上这一层（页面的封面/插图两种来源共用）。
 */
function withoutPhotoScheme(token: string | null | undefined): string {
  return String(token ?? '').trim().replace(/^photo:/i, '');
}

/**
 * 按照片 ID（或任意形路径）在池里查那一条 PhotoEntry。
 *
 * 匹配口径 = 末段文件名相等（`night-01.webp`），所以这些写法都能查中：
 * ID 本身、池内相对路径 `photos/night-01.webp`、旧条目路径
 * `series/<id>/photos/night-01.webp`、`photo:` 前缀的插图引用（body/cover 共用一入口）。
 * 缩略图文件名（`x.thumb.webp`）与展示图（`x.webp`）是两个不同 ID，不会互相命中。
 *
 * @param sidecar 全局 sidecar（默认用模块级 poolSidecar，显式传入便于单测）
 * @param idOrPath 照片 ID / 任意形路径
 */
export function findPoolPhoto(
  sidecar: PhotoSidecar | null | undefined,
  idOrPath: string,
): PhotoEntry | undefined {
  const id = photoIdOf(withoutPhotoScheme(idOrPath));
  if (!id || !Array.isArray(sidecar)) return undefined;
  return sidecar.find((entry) => photoIdOf(entry.file) === id);
}

/**
 * A5 封面三级回退：`cover`（非空）→ `photos[0]` → 空串。
 *
 * 返回的是**照片 ID**（不是路径）；空串表示「没有封面 → 调用方整块封面区不渲染」，
 * 对应 K1 的两个坏 cover 条目（wip-empty 的 photos 也为空）。
 *
 * @param cover  frontmatter 的 cover（照片 ID，允许空串）
 * @param photos frontmatter 的 photos（照片 ID 列表，顺序 = 照片流顺序）
 */
export function resolveCoverPhotoId(
  cover: string | null | undefined,
  photos: readonly string[] | null | undefined,
): string {
  const explicit = photoIdOf(withoutPhotoScheme(cover));
  if (explicit) return explicit;
  const list = Array.isArray(photos) ? photos : [];
  return photoIdOf(withoutPhotoScheme(list[0]));
}

export default poolSidecar;
