// =============================================================================
// photoCount —— 「一个条目有几帧」的共享口径（home-page 落地，series/posts 复用）
//
// 为什么单独成模块：张数同时出现在首页系列卡 / 系列页章题 / 随笔目次 / 灯箱页码片，
// 口径必须唯一。边界①「内容与代码分离」：张数的事实源是条目 frontmatter 的 photos 列表，
// 页面不得数缩略图、也不得数池里的文件。
//
// 池化口径（admin-v2.md G1 / K4，2026-10）：
//   照片只有一份全局元数据（src/content/pool/photos.meta.json），条目只保存照片 ID 列表，
//   所以张数 = `photos.length` —— 唯一读法，不再有「缺 sidecar 就数 photos/ 下的 webp」
//   的兜底分支（那套兜底随池化一起消失，留着只会变成永远不执行的死代码）。
//   空数组 = 0 帧，据实返回、不告警（0 图条目是合法内容，如 wip-empty）。
//
// 设计：纯计算、零 I/O、不 import Astro/Node。脏数据（null / 非数组）一律记 0，
//      页面因此不会因为一个坏 frontmatter 就构建崩掉。
// =============================================================================

/**
 * photos 列表 → 张数。
 * 入参是 frontmatter 的 `photos`（照片 ID 数组）；非数组（缺键 / 脏数据）一律 0。
 */
export function countEntryPhotos(photos: readonly string[] | null | undefined): number {
  return Array.isArray(photos) ? photos.length : 0;
}

/** resolveSeriesCount 的入参：只剩 photos 一个事实源。 */
export interface EntryPhotoCountInput {
  /** frontmatter 的 photos[]（照片 ID 列表，顺序 = 前台照片流顺序） */
  photos?: readonly string[] | null;
}

/**
 * 统一的条目张数解析：`photos.length`。
 *
 * 名字保留 `resolveSeriesCount`（系列页 / 目次页的既有调用点与 posts-pages 的源码护栏都认它），
 * 语义收敛为「条目照片 ID 列表长度」，随笔与系列共用一套。
 * 纯函数——不发 console、不读盘、不接受兜底文件列表。
 */
export function resolveSeriesCount(input: EntryPhotoCountInput): number {
  return countEntryPhotos(input.photos);
}

export default resolveSeriesCount;
