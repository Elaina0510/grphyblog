import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';

// =============================================================================
// e2e 共用的「照片池」读取器（admin-v2.md D 组）
//
// 池化后照片元数据只有一份全局 sidecar（src/content/pool/photos.meta.json），
// 条目侧只存照片 ID 列表（frontmatter photos[]）。e2e 要独立推出「该页应出现几帧、
// 每帧的真宽高是多少」，就按同一条链路读：frontmatter photos[] → 池 sidecar 查表。
// 这样断言不依赖页面实现，也不写魔法数。
// =============================================================================

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface PoolPhoto {
  file: string;
  thumb: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  exif: Record<string, unknown>;
}

/** 池内照片 ID（= file 末段，含 .webp）。 */
export const idOf = (file: string): string => file.split('/').filter(Boolean).pop() ?? '';

/** 全局照片池（真实 JSON，不 mock）。 */
export const POOL: PoolPhoto[] = JSON.parse(
  readFileSync(resolve(ROOT, 'src/content/pool/photos.meta.json'), 'utf8'),
) as PoolPhoto[];

const byId = new Map(POOL.map((entry) => [idOf(entry.file), entry]));

/** 读一份 .md 的 frontmatter（只取 YAML 头，正文不解析）。 */
export function frontmatterOf(mdRelPath: string): Record<string, unknown> {
  const md = readFileSync(resolve(ROOT, mdRelPath), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  return (load(m[1]) ?? {}) as Record<string, unknown>;
}

/**
 * 一个条目（其 .md 路径）的照片列表：按 frontmatter photos[] 顺序，逐张取池 sidecar 条目。
 * 池里查不到的 ID 直接跳过（页面对这种 ID 同样是告警 + 跳过，不伪造尺寸）。
 */
export function photosOfEntry(mdRelPath: string): PoolPhoto[] {
  const data = frontmatterOf(mdRelPath);
  const ids = Array.isArray(data.photos) ? (data.photos as string[]) : [];
  return ids
    .map((id) => byId.get(idOf(id)))
    .filter((entry): entry is PoolPhoto => Boolean(entry));
}

/** 系列条目的照片列表（`<slug>/index.md`）。 */
export const seriesPhotos = (slug: string): PoolPhoto[] =>
  photosOfEntry(`src/content/series/${slug}/index.md`);

/** 随笔条目的照片列表（`<slug>.md`）。 */
export const postPhotos = (slug: string): PoolPhoto[] =>
  photosOfEntry(`src/content/posts/${slug}.md`);

export { ROOT };
