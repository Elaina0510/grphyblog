// =============================================================================
// markdown.js —— 内容条目的「frontmatter + 正文」拼装与拆解（纯函数）
//
// 后台要做的只有一件事：把表单 → 一份能过 Astro zod 的 .md，以及反过来把已有 .md
// 读回表单。字段口径完全对齐 src/content/schemas.ts：
//   series: title / date / cover / photos / tags / order / draft
//   posts : title / date / cover / photos / tags / draft
//   · cover 是照片 ID，空串合法（前台走 A5 三级回退）
//   · photos 是照片 ID 列表，顺序 = 前台照片流顺序（后台的拖拽顺序直接落成这个数组）
//   · 未知键会被 zod 的 .strict() 拦下，所以这里**只写白名单字段**，读的时候把未知键报给上层
//
// 行尾：仓库现有 md 是 CRLF，编辑时按原文行尾写回（不改无关字节，git diff 才干净）；
// 新建条目用 LF。正文首尾空白会被统一裁剪，末尾保留恰好一个换行。
//
// 单测：tests/unit/admin-markdown.test.ts
// =============================================================================

import { parseFrontmatter, serializeFrontmatter, normalizeDateInput } from './yaml.js';
import { SLUG_PATTERN } from './config.js';

/** 系列 frontmatter 的键序（与仓库现有 index.md 的书写顺序一致）。 */
export const SERIES_KEYS = Object.freeze([
  'title',
  'date',
  'cover',
  'tags',
  'order',
  'draft',
  'photos',
]);

/** 随笔 frontmatter 的键序。 */
export const POSTS_KEYS = Object.freeze(['title', 'date', 'cover', 'tags', 'draft', 'photos']);

/** collection → 键序。 */
export function keysOf(collection) {
  return collection === 'series' ? SERIES_KEYS : POSTS_KEYS;
}

/** 集合名归一：只有 series / posts 两个（别的一律按 posts 处理会写错 schema，故直接抛错）。 */
export function assertCollection(collection) {
  if (collection !== 'series' && collection !== 'posts') {
    throw new TypeError(`未知 collection：${collection}（只支持 series / posts）`);
  }
  return collection;
}

/** 文本里的行尾风格（只要出现过 CRLF 就按 CRLF 写回）。 */
export function detectEol(text) {
  return /\r\n/.test(String(text ?? '')) ? '\r\n' : '\n';
}

/**
 * 把表单字段归一成 schema 认可的类型（不做「猜」：日期不合规就留空交给校验层报错）。
 *
 * @param {Record<string, unknown>} raw 表单原始值（字符串为主）
 * @param {'series'|'posts'} collection
 */
export function normalizeFields(raw, collection) {
  assertCollection(collection);
  const source = raw ?? {};
  const tags = Array.isArray(source.tags) ? source.tags : String(source.tags ?? '').split(/[,，]/);
  const photos = Array.isArray(source.photos) ? source.photos : [];
  const order = Number(source.order ?? 0);

  const fields = {
    title: String(source.title ?? '').trim(),
    date: normalizeDateInput(source.date),
    cover: String(source.cover ?? '').trim(),
    tags: tags.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0),
    draft: source.draft === true || source.draft === 'true',
    photos: photos.map((id) => String(id).trim()).filter((id) => id.length > 0),
  };
  if (collection === 'series') fields.order = Number.isFinite(order) ? order : 0;
  return fields;
}

/**
 * 校验字段是否可保存。返回中文错误清单（空数组 = 通过）。
 *
 * @param {object} fields normalizeFields 的产物
 * @param {{collection: 'series'|'posts', poolIds?: string[]}} options
 *        poolIds 给了就顺带校验「照片 ID 必须在池里」（对应构建期 R6，后台先挡一道）
 */
export function validateFields(fields, options) {
  const { collection, poolIds } = options ?? {};
  assertCollection(collection);
  const errors = [];
  const data = fields ?? {};

  if (!String(data.title ?? '').trim()) errors.push('标题不能为空');
  if (!normalizeDateInput(data.date)) errors.push('日期需为 YYYY-MM-DD（且是真实存在的日期）');

  const photos = Array.isArray(data.photos) ? data.photos : [];
  if (Array.isArray(poolIds)) {
    const known = new Set(poolIds);
    for (const id of photos) {
      if (!known.has(id)) errors.push(`照片不在池中：${id}（构建期 R6 会拦下它）`);
    }
  }
  if (data.cover && !photos.includes(data.cover)) {
    errors.push('封面必须是已勾选照片里的一张（不想指定就留空，前台会退回第一张）');
  }
  if (collection === 'series') {
    const order = Number(data.order);
    if (!Number.isFinite(order)) errors.push('排序权重需为数字');
  }
  return errors;
}

/** 照片 ID → 正文插图引用（D2a 已定语法：`![说明](photo:照片ID)`）。 */
export function illustrationSnippet(id, alt = '') {
  const photoId = String(id ?? '').trim();
  if (!photoId) return '';
  return `![${String(alt ?? '').trim()}](${photoId.startsWith('photo:') ? photoId : `photo:${photoId}`})`;
}

/**
 * 拼一份完整 .md。
 *
 * @param {{collection:'series'|'posts', fields:object, body?:string, eol?:string}} input
 */
export function buildEntryMarkdown(input) {
  const { collection, fields, body = '', eol } = input ?? {};
  assertCollection(collection);
  const lineEnding = eol === '\r\n' ? '\r\n' : '\n';
  const normalized = normalizeFields(fields, collection);
  const block = serializeFrontmatter(normalized, keysOf(collection));
  const bodyText = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  const head = `---\n${block}\n---\n`;
  const tail = bodyText ? `\n${bodyText}\n` : '';
  return `${head}${tail}`.replace(/\n/g, lineEnding);
}

/**
 * 拆一份 .md：frontmatter → 字段，剩余 → 正文。
 *
 * @returns {{fields: object, body: string, eol: string, unknownKeys: string[], hasFrontmatter: boolean}}
 */
export function parseEntryMarkdown(text, collection) {
  assertCollection(collection);
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) {
    return {
      fields: normalizeFields({}, collection),
      body: source,
      eol: detectEol(source),
      unknownKeys: [],
      hasFrontmatter: false,
    };
  }
  const { data, unknownKeys } = parseFrontmatter(match[1]);
  const allowed = keysOf(collection);
  const extraKeys = Object.keys(data).filter((key) => !allowed.includes(key));
  const body = source
    .slice(match[0].length)
    .replace(/^\r?\n/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '');
  return {
    fields: normalizeFields(data, collection),
    body,
    eol: detectEol(source),
    unknownKeys: [...unknownKeys, ...extraKeys.map((key) => `${key}:（schema 里没有这个键）`)],
    hasFrontmatter: true,
  };
}

/** 系列条目路径：`src/content/series/<slug>/index.md`。 */
export function seriesEntryPath(slug) {
  return `src/content/series/${slug}/index.md`;
}

/** 随笔条目路径：`src/content/posts/<日期-标识>.md`。 */
export function postEntryPath(fileName) {
  return `src/content/posts/${fileName}`;
}

/** 随笔文件名（不含目录）：`YYYY-MM-DD-<slug>.md`。 */
export function postFileName(date, slug) {
  const iso = normalizeDateInput(date);
  const tail = String(slug ?? '').trim();
  return `${iso || '1970-01-01'}-${tail}.md`;
}

/** 从随笔文件名里剥出 `<slug>`（去掉日期前缀与扩展名）。 */
export function postSlugOf(fileName) {
  const stem = String(fileName ?? '').replace(/\.md$/i, '');
  return stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

/** 系列标识是否合法（目录名，只用小写字母数字与连字符）。 */
export function isValidSlug(slug) {
  return SLUG_PATTERN.test(String(slug ?? '').trim());
}

/** 提交信息（每条 PUT 就是一条 commit，写清楚改了什么）。 */
export function commitMessage(collection, fields, { created = false, deleted = false } = {}) {
  const kind = collection === 'series' ? '系列' : '随笔';
  const title = String(fields?.title ?? '').trim() || '（无题）';
  const verb = deleted ? '删除' : created ? '新建' : '更新';
  return `content(${collection}): ${verb}${kind}「${title}」`;
}
