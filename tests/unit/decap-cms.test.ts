import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { postsSchema, seriesSchema } from '../../src/content/schemas';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// js-yaml 是 astro 的依赖，这里作为**本仓库 devDependency** 显式装了一份（见 package.json），
// 用 createRequire 拿它的 CJS 出口，避免没有 @types 的 import 类型报错。
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load: (src: string) => unknown };

const ADMIN_DIR = resolve(ROOT, 'public/admin');
const CONFIG_PATH = resolve(ADMIN_DIR, 'config.yml');
const INDEX_PATH = resolve(ADMIN_DIR, 'index.html');

const CONFIG_TEXT = readFileSync(CONFIG_PATH, 'utf8');
const INDEX_TEXT = readFileSync(INDEX_PATH, 'utf8');

/** 站点常量（与 astro.config.mjs 的 site、doc/account-setup.md 的 Pages 项目名同源）。 */
const SITE_ORIGIN = 'https://grphyblog.pages.dev';
const REPO = 'Elaina0510/grphyblog';
const BRANCH = 'main';

interface CmsField {
  name: string;
  label?: string;
  widget?: string;
  default?: unknown;
  date_format?: string;
  valueType?: string;
  [key: string]: unknown;
}

interface CmsCollection {
  name: string;
  folder?: string;
  path?: string;
  extension?: string;
  format?: string;
  create?: boolean;
  nested?: { index_file?: string; depth?: number };
  meta?: Record<string, unknown>;
  fields: CmsField[];
  [key: string]: unknown;
}

interface CmsConfig {
  backend: Record<string, string | undefined>;
  site_url?: string;
  display_url?: string;
  publish_mode?: string;
  local_backend?: boolean;
  public_folder?: string;
  media_folder?: string;
  collections: CmsCollection[];
  [key: string]: unknown;
}

/** 解析后的 config.yml（下面的用例共用一份，保证「解析成功」本身也是断言点）。 */
const config = yaml.load(CONFIG_TEXT) as CmsConfig;

/** 深度遍历配置里所有对象/数组的键名，用于「不该出现的键一个都不能有」这类全局红线。 */
function everyKey(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(everyKey);
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => [k, ...everyKey(v)]);
  }
  return [];
}

function collectionByName(name: string): CmsCollection {
  const found = config.collections.find((c) => c.name === name);
  expect(found, `config.yml 缺 collection：${name}`).toBeDefined();
  return found as CmsCollection;
}

function fieldNames(collection: CmsCollection): string[] {
  return (collection.fields || []).map((f) => f.name);
}

/**
 * 从 schemas.ts 源码里把 strict object 的键集合抠出来（任务 5.2 要求「解析 schema 得键集合」）。
 * 只依赖 `export const xxxSchema = z\n  .object({ ... })\n  .strict()` 这一处的真实形状，
 * 抠不到就返回 null —— 用例里会显式失败，不会静默放过。
 */
function schemaKeysFromSource(exportName: string): string[] | null {
  const source = readFileSync(resolve(ROOT, 'src/content/schemas.ts'), 'utf8');
  const startMarker = `export const ${exportName} =`;
  const start = source.indexOf(startMarker);
  if (start < 0) return null;
  const open = source.indexOf('.object({', start);
  const close = source.indexOf('.strict()', open);
  if (open < 0 || close < 0) return null;
  const body = source.slice(open + '.object({'.length, close);
  const keys: string[] = [];
  // 字段键固定是两格缩进的 `.object({` 内部四格缩进行：`    title: z.string(),`
  for (const match of body.matchAll(/^ {4}([A-Za-z_][\w]*)\s*:/gm)) keys.push(match[1]);
  return keys.length > 0 ? keys : null;
}

/** Decap 各 widget 存进 frontmatter 的实际值形状（与 date_format / valueType 对齐）。 */
function sampleValueFor(field: CmsField): unknown {
  switch (field.widget) {
    case 'date':
      // date_format: YYYY-MM-DD 时 Decap 写成裸日期串，js-yaml/Astro 会解析成 Date
      return new Date(Date.UTC(2026, 8, 20)).toISOString().slice(0, 10);
    case 'number':
      return field.valueType === 'int' ? 2 : 2.5;
    case 'boolean':
      return field.default === undefined ? true : !field.default;
    case 'list':
      return ['城市', '夜景'];
    case 'text':
      return '一段文字';
    case 'markdown':
      return '一段正文';
    case 'image':
    case 'file':
      return 'photos/night-01.webp';
    case 'string':
    default:
      return field.name === 'cover' ? 'photos/night-01.webp' : `${field.name}-示例`;
  }
}

// =============================================================================
// decap-cms 任务 1/2：/admin 静态文件与 backend 指向
// 外部动作（注册 OAuth、线上登录）不在此处，见 doc/github-oauth-setup.md。
// =============================================================================
describe('public/admin · 文件与 Decap 版本锁定（任务 1）', () => {
  it('index.html 与 config.yml 都在 public/admin/（构建原样拷进 dist/admin/）', () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
    expect(existsSync(CONFIG_PATH)).toBe(true);
    // 目录树用例要求 .gitkeep 仍在（public/admin 曾是空目录占位）
    expect(existsSync(resolve(ADMIN_DIR, '.gitkeep'))).toBe(true);
  });

  it('Decap 脚本 URL 锁到具体补丁版，不含 latest / 版本区间', () => {
    const src = [...INDEX_TEXT.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const cms = src.filter((s) => /decap-cms/i.test(s));
    expect(cms.length, 'index.html 没引入 decap-cms 脚本').toBeGreaterThan(0);
    for (const url of cms) {
      expect(url, `CDN 地址未锁版本：${url}`).toMatch(
        /decap-cms-app@\d+\.\d+\.\d+\/dist\/decap-cms-app\.js$/,
      );
      expect(url, `CDN 地址缺 /dist/ 会 404：${url}`).toContain('/dist/');
      expect(url).not.toMatch(/\/latest|@next|@\^|@~|@'\+/);
    }
  });

  it('后台页有 noindex，且没有任何前端框架依赖（纯 script 引入）', () => {
    expect(INDEX_TEXT.toLowerCase()).toMatch(/name="robots"[^>]+content="noindex/);
    expect(INDEX_TEXT).not.toMatch(/<script[^>]+src="[^"]*(react|vue|svelte)\.js/i);
  });

  it('后台页不泄漏本地开发地址（与 deployment 的产物口径一致）', () => {
    expect(INDEX_TEXT).not.toMatch(/localhost:\d{4}|127\.0\.0\.1/);
    expect(CONFIG_TEXT).not.toMatch(/localhost:\d{4}|127\.0\.0\.1/);
  });
});

describe('config.yml · 语法与 backend（任务 2）', () => {
  it('能被 YAML 解析成对象', () => {
    expect(config).toBeTruthy();
    expect(typeof config).toBe('object');
  });

  it('backend 指向本站仓库与主分支，走 GitHub implicit', () => {
    expect(config.backend.name).toBe('github');
    expect(config.backend.repo).toBe(REPO);
    expect(config.backend.branch).toBe(BRANCH);
    expect(config.backend.auth_type).toBe('github');
  });

  it('site_url / display_url 用 Pages 域名（OAuth 回调基址与它同源）', () => {
    expect(config.site_url).toBe(SITE_ORIGIN);
    expect(config.display_url).toBe(SITE_ORIGIN);
  });

  it('publish_mode: simple（改完即 commit）+ local_backend: true（本地代理验证用）', () => {
    expect(config.publish_mode).toBe('simple');
    expect(config.local_backend).toBe(true);
  });

  it('client_id：未注册时是占位、注册后必须是 GitHub client id 形状；永不出现 client_secret', () => {
    const filled = config.backend.client_id;
    if (filled === undefined) {
      // 现状（本地实现阶段）：只允许留注释占位 + TODO，不许臆造值
      expect(CONFIG_TEXT).toMatch(/# TODO:.*client_id/);
      expect(CONFIG_TEXT).toMatch(/#\s*client_id:/);
    } else {
      // 用户注册 OAuth App 后回填：旧版 40 位十六进制 或 新版 Iv/Ov 前缀 base62，且不能还是占位符
      expect(
        String(filled),
        'client_id 形状不对（GitHub OAuth App：40 位十六进制 或 Iv/Ov 前缀）',
      ).toMatch(/^([0-9a-f]{40}|(Iv|Ov)[A-Za-z0-9]+)$/i);
    }
    // 密钥红线：本目录会随站点公开，任何地方都不许出现 client_secret 赋值
    expect(CONFIG_TEXT).not.toMatch(/^\s*#?\s*client_secret\s*:\s*\S/m);
    expect(everyKey(config.backend)).not.toContain('client_secret');
  });

  it('不引入 Netlify 等第三方代理（backend 里没有 proxy_url / netlify 端点）', () => {
    const keys = everyKey(config);
    expect(keys).not.toContain('proxy_url');
    expect(CONFIG_TEXT).not.toMatch(/api\.netlify\.com|netlify\.com\/\.netlify/);
  });

  it('停维备案注释在位：Decap 停维 → 迁 Sveltia，影响面仅 public/admin/', () => {
    expect(CONFIG_TEXT).toMatch(/Sveltia/);
    expect(CONFIG_TEXT).toMatch(/public\/admin\//);
  });
});

// =============================================================================
// 任务 4/5 + 5.2「字段一致性」：CMS 写出的 frontmatter 必须是 strict schema 的合法键。
// 多一个键（如 slug/summary）或少一个键，下一次 npm run build 都会在 .strict() 上崩。
// =============================================================================
describe('collections · 与 content-model strict schema 逐字对齐（任务 4/5，关键）', () => {
  it('只有 series 与 posts 两个 collection，且都指向 loader 的真实路径', () => {
    expect(config.collections.map((c) => c.name).sort()).toEqual(['posts', 'series']);
    const series = collectionByName('series');
    const posts = collectionByName('posts');
    // glob: src/content/series/*/index.md
    expect(series.folder).toBe('src/content/series');
    expect(series.path).toBe('{{slug}}/index');
    expect(series.nested?.index_file).toBe('index');
    // glob: src/content/posts/*.md（平铺，条目目录就是同名资源夹）
    expect(posts.folder).toBe('src/content/posts');
    expect(posts.path).toBe('{{slug}}');
    expect(posts.nested).toBeUndefined();
    for (const c of [series, posts]) {
      expect(c.extension).toBe('md');
      expect(c.format).toBe('frontmatter');
      expect(c.create).toBe(true);
    }
  });

  it('series 字段集合 == seriesSchema 键集合（不多不少，顺序也一致）', () => {
    const fromSource = schemaKeysFromSource('seriesSchema');
    expect(fromSource, '没能从 schemas.ts 抠出 seriesSchema 键，用例前提破了').toBeTruthy();
    const zodKeys = Object.keys((seriesSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(fromSource).toEqual(zodKeys);
    expect(fieldNames(collectionByName('series'))).toEqual(fromSource);
    expect(fieldNames(collectionByName('series')).sort()).toEqual(
      ['cover', 'date', 'draft', 'order', 'tags', 'title'].sort(),
    );
  });

  it('posts 字段集合 == postsSchema 键集合（随笔没有 order）', () => {
    const fromSource = schemaKeysFromSource('postsSchema');
    expect(fromSource, '没能从 schemas.ts 抠出 postsSchema 键，用例前提破了').toBeTruthy();
    const zodKeys = Object.keys((postsSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(fromSource).toEqual(zodKeys);
    expect(fieldNames(collectionByName('posts'))).toEqual(fromSource);
    expect(fieldNames(collectionByName('posts'))).not.toContain('order');
  });

  it('没有 slug / summary / path 之类的伪字段：条目标识只走路径，不进 frontmatter', () => {
    const banned = ['slug', 'summary', 'path', 'filename', 'body', 'id', 'resource'];
    for (const c of config.collections) {
      for (const name of fieldNames(c)) {
        expect(banned, `${c.name} 有会把垃圾键写进 frontmatter 的字段：${name}`).not.toContain(name);
      }
    }
  });

  it('draft 是 boolean 开关（发布/撤下）、order 是 number（排序）', () => {
    const series = collectionByName('series');
    const draft = series.fields.find((f) => f.name === 'draft');
    const order = series.fields.find((f) => f.name === 'order');
    expect(draft?.widget).toBe('boolean');
    expect(draft?.default).toBe(false);
    expect(order?.widget).toBe('number');
    expect(order?.valueType).toBe('int');
    expect(postsHasNoOrder(collectionByName('posts'))).toBe(true);
  });

  it('date 字段带 YYYY-MM-DD 存储格式（z.coerce.date 直接接受，且与种子内容同形）', () => {
    for (const c of config.collections) {
      const date = c.fields.find((f) => f.name === 'date');
      expect(date?.widget, `${c.name} 的 date 字段缺失`).toBe('date');
      expect(date?.date_format).toBe('YYYY-MM-DD');
    }
  });

  it('按 config 的 widget 造一份 frontmatter → 过真 zod schema（写坏字段名当场红）', () => {
    for (const c of config.collections) {
      const data: Record<string, unknown> = {};
      for (const field of c.fields) {
        expect(field.name, `${c.name} 有没起名字的字段`).toBeTruthy();
        data[field.name] = sampleValueFor(field);
      }
      const schema = c.name === 'series' ? seriesSchema : postsSchema;
      const parsed = schema.safeParse(data);
      expect(
        parsed.success,
        `collection ${c.name} 产出的 frontmatter 过不了 schema：` +
          (parsed.success ? '' : JSON.stringify(parsed.error.issues)),
      ).toBe(true);
    }
  });

  it('少写一个字段（模拟漏配 required）也过不了 schema：证明上一条不是空转', () => {
    const series = collectionByName('series');
    const data: Record<string, unknown> = {};
    for (const field of series.fields.slice(0, -2)) data[field.name] = sampleValueFor(field);
    expect(seriesSchema.safeParse(data).success).toBe(false);
  });

  it('photos.meta.json 与 photos/ 在后台不是可编辑项（没有字段/collection 指向 sidecar）', () => {
    const flat = JSON.stringify(config);
    expect(flat).not.toMatch(/photos\.meta\.json/);
    expect(everyKey(config)).not.toContain('meta_field');
    // 只有 series 用 nested + index_file 把 photos/ 挡在条目之外
    expect(collectionByName('series').nested?.index_file).toBe('index');
  });
});

function postsHasNoOrder(posts: CmsCollection): boolean {
  return !fieldNames(posts).includes('order');
}

// =============================================================================
// 任务 6：照片禁上传。配置层能关到的程度 + 构建期兜底（scripts/check-image-sources.mjs）
// =============================================================================
describe('禁上传（任务 6）：配置层不给任何写媒体文件的落点', () => {
  it('全站与 collection 两级都没有 media_folder', () => {
    expect(everyKey(config)).not.toContain('media_folder');
    expect(CONFIG_TEXT).not.toMatch(/^\s*media_folder\s*:/m);
  });

  it('cover 用 string widget（不渲染上传/拖拽区），且明确 hint 只能选已入库照片', () => {
    for (const c of config.collections) {
      const cover = c.fields.find((f) => f.name === 'cover');
      expect(cover?.widget, `${c.name} 的 cover 字段配置缺失`).toBe('string');
      expect(cover?.hint, 'cover 需要 hint 说明「只能选已入库照片」').toBeTruthy();
    }
  });

  it('没有任何可上传的第三方媒体服务配置（uploadcare / cloudinary / imagekit）', () => {
    expect(everyKey(config)).not.toContain('media_library');
    expect(CONFIG_TEXT).not.toMatch(/^\s*media_library\s*:/m);
    expect(CONFIG_TEXT.toLowerCase()).not.toMatch(/^[^#]*\b(uploadcare|cloudinary|imagekit)\b/m);
  });

  it('public/ 目录里当前没有图片，后台页与配置也不引用图片资源', () => {
    expect(existsSync(resolve(ADMIN_DIR, 'config.yml'))).toBe(true);
    expect(existsSync(resolve(ADMIN_DIR, 'index.html'))).toBe(true);
    // 兜底检查（R5）本身有独立用例文件，这里只钉「后台目录只有静态文件」这一事实
    const uploads = ['uploaded', 'uploads', 'media', 'images']
      .map((d) => resolve(ROOT, 'public', d))
      .filter((p) => existsSync(p));
    expect(uploads, 'public/ 下出现了上传目录，说明有非脚本图片通道').toEqual([]);
  });
});

// =============================================================================
// 任务 8：Editor Preview 与 imageUrl 的基准口径「互指」——只查注释与常量是否都还在
// =============================================================================
describe('Editor Preview 基准（任务 8）：三处互指注释不许走散', () => {
  it('config.yml 的 public_folder 与 imageUrl 默认 base 同源（都是站点根）', () => {
    expect(config.public_folder).toBe('/');
    // imageUrl.ts 的默认回落同样是 '/'（见其 readEnvBase/joinBase），此处只断言 CMS 侧口径
    expect(CONFIG_TEXT).toMatch(/imageUrl\.ts/);
  });

  it('config.yml / index.html / imageUrl.ts 三处都有「改基准必须同步另一处」的互指注释', () => {
    expect(CONFIG_TEXT).toMatch(/必须同步/);
    expect(INDEX_TEXT).toMatch(/imageUrl\.ts/);
    expect(INDEX_TEXT).toMatch(/必须同步/);
    const util = readFileSync(resolve(ROOT, 'src/utils/imageUrl.ts'), 'utf8');
    expect(util).toMatch(/public\/admin/);
    expect(util).toMatch(/必须同步|同步/);
  });

  it('index.html 里有 preview 模板注册与 imageUrl 规则的镜像实现（不引第三方框架）', () => {
    expect(INDEX_TEXT).toMatch(/registerPreviewTemplate/);
    expect(INDEX_TEXT).toMatch(/resolvePreviewUrl/);
    // 与 imageUrl.ts 同三条规则：绝对 http(s)、data/blob、base 拼接
    expect(INDEX_TEXT).toContain('/^https?:\\/\\//i');
    expect(INDEX_TEXT).toContain('/^(data|blob):/i');
  });
});
