// =============================================================================
// site.js —— 站点数据 site.json 的 featured（首页精选帧）读写（纯函数）
//
// 为什么单独一个模块：
//   · 首页精选帧是后台第四类可编辑内容，存在 src/data/site.json 的 featured.photos 里，
//     不是条目 frontmatter，也不是照片池 sidecar。
//   · site.json 还有导航 / 版权页 / $comments 等站点级事实——后台只动 featured.photos，
//     其余字段必须原样保真，所以这里做「解析 → 只替换一个键 → 序列化」，不重建整个文件。
//
// 形状契约（tests/unit/site-data.test.ts 钉死）：featured.photos 的每一项恰好是
//   { photo, title, alt } 三个非空字符串，photo = 池内完整文件名（含 .webp）。
//   所以 normalizeFeaturedPhoto 只产出这三个键，不许多也不许少。
//
// 单测：tests/unit/admin-featured.test.ts
// =============================================================================

import { photoIdOf } from './photos.js';

/**
 * 解析 site.json 文本。坏 JSON / 顶层不是对象 / 缺 featured.photos 数组都抛错。
 * @param {string} text
 */
export function parseSiteData(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch (error) {
    throw new Error(`site.json 不是合法 JSON：${error instanceof Error ? error.message : error}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('site.json 顶层必须是对象');
  }
  if (!data.featured || typeof data.featured !== 'object' || !Array.isArray(data.featured.photos)) {
    throw new Error('site.json 缺 featured.photos 数组');
  }
  return data;
}

/** 读 featured.photos（归一化成三键对象的副本）。 */
export function featuredOf(siteData) {
  const list = siteData?.featured?.photos;
  return (Array.isArray(list) ? list : []).map((item) => normalizeFeaturedPhoto(item));
}

/** 归一一条精选帧：只产出 photo/title/alt 三键。 */
export function normalizeFeaturedPhoto(raw) {
  return {
    photo: photoIdOf(raw?.photo),
    title: String(raw?.title ?? '').trim(),
    alt: String(raw?.alt ?? '').trim(),
  };
}

/** 归一整个列表。 */
export function normalizeFeatured(list) {
  return (Array.isArray(list) ? list : []).map((item) => normalizeFeaturedPhoto(item));
}

/** 只替换 featured.photos，其余字段（含 $comments）原样保留。 */
export function setFeatured(siteData, photos) {
  const base = siteData && typeof siteData === 'object' ? siteData : {};
  const featured = base.featured && typeof base.featured === 'object' ? base.featured : {};
  return { ...base, featured: { ...featured, photos } };
}

/** 序列化：2 空格缩进 + 结尾换行，与仓库现有 site.json 同形（diff 才干净）。 */
export function siteDataText(siteData) {
  return `${JSON.stringify(siteData, null, 2)}\n`;
}

/**
 * 移动一帧（越界夹紧；from === to 返回副本）。
 * 与 photos.js 的 movePhoto 同语义，只是元素是精选帧对象而非 ID 字符串。
 */
export function moveFeatured(list, from, to) {
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

/** 校验精选帧列表，返回中文错误清单（空数组 = 通过）。 */
export function validateFeatured(photos, poolIds) {
  const errors = [];
  const list = Array.isArray(photos) ? photos : [];
  const known = new Set(Array.isArray(poolIds) ? poolIds : []);
  const seen = new Set();
  list.forEach((item, i) => {
    const label = `第 ${i + 1} 帧`;
    const photo = String(item?.photo ?? '').trim();
    if (!photo) errors.push(`${label} 没选照片`);
    else if (!known.has(photo)) errors.push(`${label} 照片不在池中：${photo}`);
    if (photo && seen.has(photo)) errors.push(`${label} 照片重复：${photo}`);
    if (photo) seen.add(photo);
    if (!String(item?.title ?? '').trim()) errors.push(`${label} 缺标题`);
    if (!String(item?.alt ?? '').trim()) errors.push(`${label} 缺说明文字（alt）`);
  });
  return errors;
}

export default {
  parseSiteData,
  featuredOf,
  normalizeFeaturedPhoto,
  normalizeFeatured,
  setFeatured,
  siteDataText,
  moveFeatured,
  validateFeatured,
};
