// =============================================================================
// contentImages —— 把「内容里的图片引用」解析成构建期可服务 URL，再经 imageUrl 输出
//
// 为什么要它：frontmatter 的 cover / photos[]、sidecar 的 file/thumb 存的都是**相对路径**，
// 但浏览器要拿到能加载的 URL，需要构建期把这些真实文件交给 Vite/Astro 资源管线处理。
// 用 import.meta.glob(..., { query:'?url' }) 一次性把 src/content 下所有 webp 变成
// 「路径 -> 可服务 URL」映射，本模块负责查表 + 拼接。
//
// ---- 照片池化口径（admin-v2.md A6，2026-10 拍板）----
//   ① 照片唯一位置：src/content/pool/photos/（展示版 <base>.webp 与缩略图
//      <base>.thumb.webp 同目录，靠 .thumb.webp 后缀区分）；
//   ② 唯一元数据：src/content/pool/photos.meta.json（PhotoEntry 数组，全局一份）；
//   ③ 照片 ID = 完整文件名含 .webp（night-01.webp / P1230888.webp）：
//      frontmatter 的 cover 与 photos[] 都存 ID；sidecar 的 file / thumb 存**池内相对路径**
//      `photos/xxx.webp`（真实磁盘路径 = POOL_PHOTOS_DIR/xxx.webp）。
//
// 迁移期兼容：旧几条路与新池路径同表可查 ——
//   - 系列条目相对形：`photos/night-01.webp`（entryDir = series/<id>）
//   - 随笔条目相对形：`photos/dawn-01.webp`（entryDir = posts/<日期-标题>）
//   - 后台平铺条目多一层：`<标识>/photos/dawn-01.webp`
//   - 新池形：照片 ID（`night-01.webp`）或池内相对路径（`photos/night-01.webp`）
// 查表顺序见 contentImageKeyCandidates()：条目相对精确 → 条目相对归一到 photos/ 尾段 → 池。
// **旧条目优先、池兜底**是刻意的：B 组迁移删旧文件的前后，已发布页面的 URL 不会来回抖动。
//
// 出口仍统一走 imageUrl()（边界③）：本模块只负责「相对路径 -> 构建 URL」，
// base 前缀的语义完全交给 imageUrl，迁移图床时依旧只改一处；本模块不新增第二个出口。
//
// 与后台的关系（decap-cms 任务 8）：/admin 的封面是从「条目资源」里挑已入库照片，
// 存出来的几种形本模块都认（见 resolveContentImage）。CDN 上的 CMS 运行时 import 不到
// 这个模块，只能按 imageUrl 的规则直接拼预览 URL（见 public/admin/index.html 与
// imageUrl.ts 的同步约定）。
// =============================================================================

import { imageUrl, type ImageUrlOptions } from './imageUrl';
import { normalizeIllustrationPath } from './postIllustrations';

/** 内容根目录前缀（glob 的 key 以此开头），归一化时剥掉。 */
const CONTENT_ROOT = '/src/content/';

/** 照片池目录（相对 src/content）。 */
export const POOL_DIR = 'pool';

/** 池内照片目录（相对 src/content）：展示版与缩略图同目录。 */
export const POOL_PHOTOS_DIR = `${POOL_DIR}/photos`;

/** 池内全局 sidecar（相对 src/content）：唯一元数据源。 */
export const POOL_SIDECAR_PATH = `${POOL_DIR}/photos.meta.json`;

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
 * 把调用方给的相对引用收成统一形：去空白、反斜杠转正斜杠、剥查询串/锚点、剥前导 `./` 与 `/`。
 * 只为「查表用」，不改写大小写、不推断后缀 —— 照片 ID 必须原样保留（含 .webp / .thumb.webp）。
 */
function normalizeRelPath(relPath: string): string {
  return String(relPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('?')[0]
    .split('#')[0]
    .replace(/^(?:\.?\/)+/, '');
}

/**
 * 照片 ID：完整文件名含 `.webp`（如 `night-01.webp` / `P1230888.webp`）。
 *
 * 入参可宽：ID 本身、池内相对路径 `photos/x.webp`、旧条目路径
 * `series/<id>/photos/x.webp`、带查询串的 URL 尾段 —— 一律取末段文件名。
 * frontmatter 的 cover / photos[] 存的就是这个形，页面拿它直接查池。
 */
export function photoIdOf(idOrPath: string): string {
  const clean = String(idOrPath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('?')[0]
    .split('#')[0];
  return clean.split('/').filter(Boolean).pop() ?? '';
}

/**
 * 照片 ID / 任意形路径 -> **池内相对路径**（= sidecar file/thumb 的口径）：`photos/<id>`。
 * 空入参返回空串（不做兜底拼接，免得产出一个指向目录的假路径）。
 */
export function poolPhotoRelPath(idOrPath: string): string {
  const id = photoIdOf(idOrPath);
  return id ? `photos/${id}` : '';
}

/**
 * 照片 ID / 任意形路径 -> **相对 src/content 的查表 key**：`pool/photos/<id>`，
 * 与 contentImageMap 的 key 同口径。拼错与缺图都从这里暴露，不必去猜 glob 前缀。
 */
export function poolPhotoKey(idOrPath: string): string {
  const id = photoIdOf(idOrPath);
  return id ? `${POOL_PHOTOS_DIR}/${id}` : '';
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
 * 一次「图片引用」要依次尝试的查表 key（顺序即优先级，已规整斜杠并去重）。
 *
 * 抽成纯函数是为了：查表逻辑不依赖 glob 产物即可单测（Vitest 下 import.meta.glob 不生效），
 * 迁移期的多形兼容也只集中在这一处，可读、可断言。
 *
 * @param entryDir 资源目录，相对 src/content（如 `series/city-lights`）
 * @param relPath  图片引用：照片 ID / `photos/x.webp` / 旧的 `<标识>/photos/x.webp`
 */
export function contentImageKeyCandidates(entryDir: string, relPath: string): string[] {
  const keys: string[] = [];
  const push = (key: string) => {
    const clean = key.replace(/^\/+|\/+$/g, '');
    if (clean && !keys.includes(clean)) keys.push(clean);
  };

  const rel = normalizeRelPath(relPath);
  if (!rel) return keys;

  // ① 条目内精确路径：旧条目 `photos/x.webp`，或 entryDir 本身就是池目录时的 `photos/x.webp`
  push(contentImageKey(entryDir, rel));
  // ② 后台平铺条目存出的是 `<标识>/photos/x.webp`（多一层）：归一到 photos/ 尾段再查条目内
  push(contentImageKey(entryDir, normalizeIllustrationPath(rel)));
  // ③ 池兜底：按照片 ID（末段文件名）查 pool/photos/<id>
  push(poolPhotoKey(rel));

  return keys;
}

/**
 * 查表：返回该内容图片的「构建期可服务 URL」（未加 base）。查不到返回 undefined。
 *
 * @param entryDir 资源目录，相对 src/content，如 `series/city-lights` 或 `posts/2026-09-20-first-light`
 * @param relPath  图片引用（照片 ID / 旧条目相对路径 / 池内相对路径），见 contentImageKeyCandidates
 */
export function resolveContentImage(entryDir: string, relPath: string): string | undefined {
  for (const key of contentImageKeyCandidates(entryDir, relPath)) {
    const hit = contentImageMap[key];
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 最终出口：把内容图片解析成带 base 的可加载 URL（内部再调 imageUrl，边界③统一）。
 *
 * 查不到构建 URL 时绝不抛错，按形退化一次：
 *   - 照片 ID（不含目录，如 `night-01.webp`）→ 退成池内相对路径 `photos/night-01.webp`，
 *     与旧 sidecar 口径一致，不至于退化成一个站点根下的裸文件名；
 *   - 其余（已是路径）→ 原样把相对路径交给 imageUrl。
 * 两条都仍只经过 imageUrl 这一个出口。
 *
 * @param entryDir 资源目录，相对 src/content（见 resolveContentImage）
 * @param relPath  图片引用（frontmatter cover / photos[] 的照片 ID 或 sidecar file / thumb）
 * @param opts     透传给 imageUrl 的 { base }，用于切换图床
 */
export function contentImageUrl(
  entryDir: string,
  relPath: string,
  opts: ImageUrlOptions = {},
): string {
  const served = resolveContentImage(entryDir, relPath);
  if (served) return imageUrl(served, opts);

  const rel = normalizeRelPath(relPath);
  const fallback = rel && !rel.includes('/') ? poolPhotoRelPath(rel) : relPath;
  return imageUrl(fallback, opts);
}

/**
 * 照片池的便捷出口：照片 ID（或任意形路径）-> 带 base 的可加载 URL。
 *
 * 等价于 `contentImageUrl(POOL_DIR, 'photos/<id>')`，只是把「池在哪」收进本模块：
 * 页面渲染 frontmatter 的 cover / photos[] 时不必自己拼目录。内部同样落到 imageUrl
 * （单出口），池里缺这张图时退化为 `photos/<id>`（不抛错）。
 */
export function poolPhotoUrl(idOrPath: string, opts: ImageUrlOptions = {}): string {
  const rel = poolPhotoRelPath(idOrPath);
  if (!rel) return '';
  return contentImageUrl(POOL_DIR, rel, opts);
}

export default contentImageUrl;
