// =============================================================================
// collections —— 公开查询的「草稿过滤」统一入口（design §3 边界：draft 不外泄）
//
// 公开页面一律用 getPublishedSeries()/getPublishedPosts()，不散写 getCollection，
// 更不各自 filter，避免漏网。纯函数 filterDrafts 单独导出以便无运行时依赖地单测。
// =============================================================================

import type { CollectionEntry } from 'astro:content';

/** 只要 data.draft 可选布尔即可参与过滤（series / posts 及未来 collection 通用）。 */
interface DraftAware {
  data: { draft?: boolean };
}

/**
 * 纯函数：剔除 draft === true 的条目；draft 为 false 或缺省（undefined）一律保留。
 * 不修改入参，返回新数组。
 */
export function filterDrafts<T extends DraftAware>(entries: T[]): T[] {
  return entries.filter((entry) => entry.data?.draft !== true);
}

/** 公开系列：getCollection('series') 结果过滤掉草稿。 */
export async function getPublishedSeries(): Promise<CollectionEntry<'series'>[]> {
  // 动态 import：让本模块在无 Astro 运行时的单测里也能被 import（filterDrafts 可测）。
  const { getCollection } = await import('astro:content');
  const entries = await getCollection('series');
  return filterDrafts(entries);
}

/** 公开随笔：getCollection('posts') 结果过滤掉草稿。 */
export async function getPublishedPosts(): Promise<CollectionEntry<'posts'>[]> {
  const { getCollection } = await import('astro:content');
  const entries = await getCollection('posts');
  return filterDrafts(entries);
}
