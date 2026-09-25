// =============================================================================
// contentImages —— 把「内容夹里的图片」解析成构建期可服务 URL，再经 imageUrl 输出
//
// 为什么要它：契约 (a) 里 frontmatter 的 cover、sidecar 的 file/thumb 存的都是
// 「相对内容条目」的路径（如 photos/night-01.webp）。但浏览器要拿到能加载的 URL，
// 需要构建期把这些真实文件交给 Vite/Astro 资源管线处理。用 import.meta.glob(..., { query:'?url' })
// 一次性把 src/content 下所有 webp 变成「路径 -> 可服务 URL」映射，本模块负责查表 + 拼接。
//
// 出口仍统一走 imageUrl()（边界③）：本模块只负责「相对内容路径 -> 构建 URL」，
// base 前缀的语义完全交给 imageUrl，迁移图床时依旧只改一处。
//
// 与后台的关系（decap-cms 任务 8）：/admin 里 cover 存的就是本模块认得的「相对条目路径」
// （photos/xxx.webp），但 CDN 上的 CMS 运行时 import 不到这个模块，只能按 imageUrl 的规则
// 直接拼预览 URL（见 public/admin/index.html 与 src/utils/imageUrl.ts 的同步约定）。
// =============================================================================

import { imageUrl, type ImageUrlOptions } from './imageUrl';

/** 内容根目录前缀（glob 的 key 以此开头），归一化时剥掉。 */
const CONTENT_ROOT = '/src/content/';

/**
 * 构建期扫描：key 为形如 `/src/content/series/<id>/photos/x.webp` 的项目根绝对路径，
 * value 为 Vite/Astro 处理后「可服务」的 URL 字符串（`?url` 的产物）。
 *
 * 说明：`*.webp` 已覆盖复合后缀 `.thumb.webp`（后者同样以 `.webp` 结尾），
 * 这里显式列出 `{webp,thumb.webp}` 只为让「展示版 + 缩略图」两类产物在源码里自解释。
 */
const scanned = import.meta.glob('/src/content/**/*.{webp,thumb.webp}', {
  query: '?url',
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** 剥去内容根前缀、统一正斜杠，得到便于按键拼接的归一化 key。 */
function normalizeKey(globKey: string): string {
  return globKey.startsWith(CONTENT_ROOT)
    ? globKey.slice(CONTENT_ROOT.length)
    : globKey.replace(/^\/+/, '');
}

/**
 * 全站内容图片映射表：key 为「相对 src/content 的路径」
 * （如 `series/city-lights/photos/night-01.webp`），value 为构建期可服务 URL。
 * 供页面/灯箱按需查表，也可直接用下面的辅助函数。
 */
export const contentImageMap: Record<string, string> = Object.fromEntries(
  Object.entries(scanned).map(([k, url]) => [normalizeKey(k), url]),
);

/** 拼接「资源目录 + 相对路径」为归一化 key，规整多余斜杠。 */
export function contentImageKey(entryDir: string, relPath: string): string {
  const dir = entryDir.replace(/^\/+|\/+$/g, '');
  const rel = relPath.replace(/^\/+/g, '');
  return dir ? `${dir}/${rel}` : rel;
}

/**
 * 由内容条目的 collection + id 推出「资源目录」（相对 src/content），供 contentImageUrl 使用。
 *
 * Astro 7 的 glob loader 里 entry.id 是「相对 base 且含文件名」的路径：
 *   - 系列 series：`city-lights/index.md`     → 资源目录 `series/city-lights`
 *   - 随笔 posts：`2026-09-21-morning-fog.md` → 资源目录 `posts/2026-09-21-morning-fog`
 * 规则：剥掉扩展名，若结尾是 `/index` 再去掉它（与 Astro 的 slug 口径一致）。
 *
 * 页面/灯箱只需：`contentImageUrl(entryResourceDir(e.collection, e.id), e.data.cover)`。
 */
export function entryResourceDir(collection: string, id: string): string {
  const stem = id.replace(/\.[^./]+$/, '').replace(/\/index$/, '');
  return contentImageKey(collection, stem);
}

/**
 * 查表：返回该内容图片的「构建期可服务 URL」（未加 base）。查不到返回 undefined。
 *
 * @param entryDir 资源目录，相对 src/content，如 `series/city-lights` 或 `posts/2026-09-20-first-light`
 * @param relPath  内容相对路径，如 `photos/night-01.webp`
 */
export function resolveContentImage(entryDir: string, relPath: string): string | undefined {
  return contentImageMap[contentImageKey(entryDir, relPath)];
}

/**
 * 最终出口：把内容图片解析成带 base 的可加载 URL（内部再调 imageUrl，边界③统一）。
 * 查不到构建 URL 时退回把 relPath 直接交给 imageUrl（保证「只有一个出口」且绝不抛错）。
 *
 * @param entryDir 资源目录，相对 src/content（见 resolveContentImage）
 * @param relPath  内容相对路径（frontmatter cover / sidecar file / sidecar thumb）
 * @param opts     透传给 imageUrl 的 { base }，用于切换图床
 */
export function contentImageUrl(
  entryDir: string,
  relPath: string,
  opts: ImageUrlOptions = {},
): string {
  const served = resolveContentImage(entryDir, relPath);
  return imageUrl(served ?? relPath, opts);
}

export default contentImageUrl;
