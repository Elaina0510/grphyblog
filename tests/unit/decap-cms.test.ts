import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { postsSchema, seriesSchema } from '../../src/content/schemas';

// /admin 后台契约测试。引擎：Sveltia CMS（@sveltia/cms）——历史上是 Decap，见 index.html 注释。
// 本文件钉住四条红线：
//   1) config.yml 只允许 Sveltia schema 认得的键（Sveltia 处处 additionalProperties:false）；
//   2) CMS 写出的 frontmatter 键集合 == src/content/schemas.ts 的 strict schema（不多不少）；
//      正文是唯一的例外：它**必须**声明成名为 body 的 markdown 字段（Sveltia 不声明 body
//      就整块不渲染正文编辑器，实测 0.221.0），但 `body_field.inline` 默认 false →
//      它被写到 frontmatter 之后的正文区，不进 frontmatter（下面有专门用例钉住）。
//   3) 封面只能指向已入库照片：cover 用 image widget + 集合级 media_folder/public_folder 空串
//      （= 从「本条目目录」的已有文件里挑）+ choose_url:false（不许外链）；
//   4) 照片不许从后台进来：那个对话框仍带上传按钮，兜底是构建期守卫 R1/R3/R5
//      （scripts/check-image-sources.mjs）——上传件没有 photos.meta.json 登记，构建即红。
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
  value_type?: string;
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
 * 会真的落进 frontmatter 的字段名。
 * 名为 body 的正文字段除外：Sveltia 的 body_field 默认 `{key: 'body', inline: false}`，
 * 序列化时它的值从数据里摘出来写到 '---' 之后（实测存盘文件即是如此）。
 */
function frontmatterFieldNames(collection: CmsCollection): string[] {
  return fieldNames(collection).filter((name) => name !== 'body');
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

/** 各 widget 存进 frontmatter 的实际值形状（与 type/format、value_type 口径对齐）。 */
function sampleValueFor(field: CmsField): unknown {
  switch (field.widget) {
    case 'datetime':
      // Sveltia widget 名为 datetime；type: date + format: YYYY-MM-DD → 落盘成裸日期串
      return new Date(Date.UTC(2026, 8, 20)).toISOString().slice(0, 10);
    case 'number':
      return field.value_type === 'int' ? 2 : 2.5;
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
// 外部动作（生成访问令牌、线上登录验收）不在此处，见 doc/admin-login-setup.md。
// =============================================================================
describe('public/admin · 文件与 Sveltia 版本锁定（任务 1）', () => {
  it('index.html 与 config.yml 都在 public/admin/（构建原样拷进 dist/admin/）', () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
    expect(existsSync(CONFIG_PATH)).toBe(true);
    // 目录树用例要求 .gitkeep 仍在（public/admin 曾是空目录占位）
    expect(existsSync(resolve(ADMIN_DIR, '.gitkeep'))).toBe(true);
  });

  it('Sveltia 脚本 URL 锁到具体版本，不含 latest / 版本区间', () => {
    const src = [...INDEX_TEXT.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const cms = src.filter((s) => /@sveltia\/cms/i.test(s));
    expect(cms.length, 'index.html 没引入 @sveltia/cms 脚本').toBeGreaterThan(0);
    for (const url of cms) {
      expect(url, `CDN 地址未锁版本：${url}`).toMatch(
        /@sveltia\/cms@\d+\.\d+\.\d+\/dist\/sveltia-cms\.js$/,
      );
      expect(url, `CDN 地址缺 /dist/：${url}`).toContain('/dist/');
      expect(url).not.toMatch(/\/latest|@next|@\^|@~|@'\+/);
    }
    // Sveltia 官方 Start Guide 的两条硬约定：不是 ES module、样式全打进 JS（无独立 CSS）。
    expect(INDEX_TEXT).not.toMatch(/<script[^>]+type="module"/i);
    expect(INDEX_TEXT).not.toMatch(/<link[^>]+stylesheet[^>]+sveltia/i);
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

  it('backend 指向本站仓库与主分支', () => {
    expect(config.backend.name).toBe('github');
    expect(config.backend.repo).toBe(REPO);
    expect(config.backend.branch).toBe(BRANCH);
  });

  it('登录口径 = 只允许粘贴 GitHub Access Token（auth_methods: [token]）', () => {
    expect(config.backend.auth_methods).toEqual(['token']);
  });

  it('不配 OAuth/代理：backend 里没有 auth_type / client_id / proxy_url / site_id', () => {
    const keys = everyKey(config.backend);
    // Sveltia schema 里 auth_type 只允许空串（授权码流），client_id/proxy_url 根本不是它的键；
    // 而 Decap 3.x 的 GitHub 后端会无视这些键、强行走 Netlify 代理 → 本站（Cloudflare）404。
    for (const banned of ['auth_type', 'client_id', 'proxy_url', 'site_id', 'app_id']) {
      expect(keys, `backend 不该出现键 ${banned}`).not.toContain(banned);
    }
  });

  it('密钥红线：任何地方都不出现 client_secret 赋值（本目录随站点公开）', () => {
    expect(CONFIG_TEXT).not.toMatch(/^\s*#?\s*client_secret\s*:\s*\S/m);
    expect(everyKey(config.backend)).not.toContain('client_secret');
  });

  it('site_url / display_url 用 Pages 域名（「在站点中打开」链接与它同源）', () => {
    expect(config.site_url).toBe(SITE_ORIGIN);
    expect(config.display_url).toBe(SITE_ORIGIN);
  });

  it('publish_mode: simple（改完即 commit）；不用 local_backend（Sveltia 无此键）', () => {
    expect(config.publish_mode).toBe('simple');
    expect(everyKey(config)).not.toContain('local_backend');
  });

  it('不引用 Netlify 代理端点（api.netlify.com 只可能出现在解释性注释里）', () => {
    const nonComment = CONFIG_TEXT
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(nonComment).not.toMatch(/api\.netlify\.com|\.netlify\/|\bnetlify\b/i);
  });

  it('头部注释记录了「为什么换 Sveltia」（Decap 只走 Netlify 代理 → 本站 404）', () => {
    expect(CONFIG_TEXT).toMatch(/Sveltia/);
    expect(CONFIG_TEXT).toMatch(/Decap/);
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
    // Sveltia：index 文件名主干写在 meta.path.index_file（nested 里只有 depth/subfolders/summary）
    expect((series.meta as { path?: { index_file?: string } })?.path?.index_file).toBe('index');
    expect(series.nested?.depth).toBeDefined();
    // glob: src/content/posts/*.md（平铺，条目目录就是同名资源夹）
    expect(posts.folder).toBe('src/content/posts');
    expect(posts.path).toBe('{{slug}}');
    expect(posts.nested).toBeUndefined();
    for (const c of [series, posts]) {
      expect(c.extension).toBe('md');
      expect(c.format).toBe('yaml-frontmatter');
      expect(c.create).toBe(true);
    }
  });

  it('series 字段集合 == seriesSchema 键集合（不多不少，顺序也一致）', () => {
    const fromSource = schemaKeysFromSource('seriesSchema');
    expect(fromSource, '没能从 schemas.ts 抠出 seriesSchema 键，用例前提破了').toBeTruthy();
    const zodKeys = Object.keys((seriesSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(fromSource).toEqual(zodKeys);
    const series = collectionByName('series');
    expect(frontmatterFieldNames(series)).toEqual(fromSource);
    expect(frontmatterFieldNames(series).sort()).toEqual(
      ['cover', 'date', 'draft', 'order', 'tags', 'title'].sort(),
    );
    // 正文只多一个 body，且排在表单最后（表单顺序 = 用户看到的顺序）。
    expect(fieldNames(series)).toEqual([...fromSource, 'body']);
  });

  it('posts 字段集合 == postsSchema 键集合（随笔没有 order）', () => {
    const fromSource = schemaKeysFromSource('postsSchema');
    expect(fromSource, '没能从 schemas.ts 抠出 postsSchema 键，用例前提破了').toBeTruthy();
    const zodKeys = Object.keys((postsSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(fromSource).toEqual(zodKeys);
    const posts = collectionByName('posts');
    expect(frontmatterFieldNames(posts)).toEqual(fromSource);
    expect(frontmatterFieldNames(posts)).not.toContain('order');
    expect(fieldNames(posts)).toEqual([...fromSource, 'body']);
  });

  it('没有 slug / summary / path 之类的伪字段：条目标识只走路径，不进 frontmatter', () => {
    const banned = ['slug', 'summary', 'path', 'filename', 'id', 'resource'];
    for (const c of config.collections) {
      for (const name of fieldNames(c)) {
        expect(banned, `${c.name} 有会把垃圾键写进 frontmatter 的字段：${name}`).not.toContain(name);
      }
    }
  });

  // 正文：Sveltia 只在 fields 里出现 name: body 时才渲染正文编辑器（实测：不声明 = 表单里整块没有，
  // 用户就只能改 frontmatter）。它落盘时走 body_field（默认 key 'body' / inline false）→ 文件正文区。
  it('两个集合都有且只有一个 name 为 body 的 markdown 正文字段（可留空、带 hint）', () => {
    for (const c of config.collections) {
      const bodies = (c.fields || []).filter((f) => f.name === 'body');
      expect(bodies, `${c.name} 缺 body 正文字段：后台就没有正文编辑器`).toHaveLength(1);
      expect(bodies[0].widget, `${c.name} 的 body 应是 markdown widget`).toBe('markdown');
      expect(bodies[0].required, `${c.name} 的 body 应允许留空`).toBe(false);
      expect(bodies[0].hint, `${c.name} 的 body 需要 hint 说明插图怎么写`).toBeTruthy();
      expect(fieldNames(c).at(-1), `${c.name} 的正文应排在表单最后（与用户阅读顺序一致）`).toBe('body');
    }
  });

  it('正文不许被塞进 frontmatter：没有任何集合设 body_field.inline = true', () => {
    for (const c of config.collections) {
      const bodyField = c.body_field as { inline?: boolean } | undefined;
      expect(bodyField?.inline, `${c.name} 设了 body_field.inline → 正文会变成 frontmatter 键`).not.toBe(
        true,
      );
    }
  });

  it('draft 是 boolean 开关（发布/撤下）、order 是 number（排序）', () => {
    const series = collectionByName('series');
    const draft = series.fields.find((f) => f.name === 'draft');
    const order = series.fields.find((f) => f.name === 'order');
    expect(draft?.widget).toBe('boolean');
    expect(draft?.default).toBe(false);
    expect(order?.widget).toBe('number');
    expect(order?.value_type).toBe('int');
    expect(postsHasNoOrder(collectionByName('posts'))).toBe(true);
  });

  it('date 字段：datetime widget + type:date + format:YYYY-MM-DD（z.coerce.date 直接接受）', () => {
    for (const c of config.collections) {
      const date = c.fields.find((f) => f.name === 'date');
      expect(date?.widget, `${c.name} 的 date 字段缺失`).toBe('datetime');
      expect(date?.type, `${c.name} 的 date 应只选日期`).toBe('date');
      expect(date?.format, `${c.name} 的 date 存储格式应为 YYYY-MM-DD`).toBe('YYYY-MM-DD');
    }
  });

  it('按 config 的 widget 造一份 frontmatter → 过真 zod schema（写坏字段名当场红）', () => {
    for (const c of config.collections) {
      const data: Record<string, unknown> = {};
      for (const field of c.fields) {
        expect(field.name, `${c.name} 有没起名字的字段`).toBeTruthy();
        // 正文字段不进 frontmatter，样本里不算它。
        if (field.name === 'body') continue;
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
    // 先滤掉正文（它不进 frontmatter），再截掉末尾两个真字段（order / draft）→ 必填缺失。
    for (const field of series.fields.filter((f) => f.name !== 'body').slice(0, -2)) {
      data[field.name] = sampleValueFor(field);
    }
    expect(seriesSchema.safeParse(data).success).toBe(false);
  });

  it('photos.meta.json 与 photos/ 在后台不是可编辑项（没有字段/collection 指向 sidecar）', () => {
    const flat = JSON.stringify(config);
    expect(flat).not.toMatch(/photos\.meta\.json/);
    expect(everyKey(config)).not.toContain('meta_field');
    // 只有 series 用 nested + meta.path.index_file 把 photos/ 挡在条目之外
    expect((collectionByName('series').meta as { path?: { index_file?: string } })?.path?.index_file).toBe(
      'index',
    );
  });
});

function postsHasNoOrder(posts: CmsCollection): boolean {
  return !fieldNames(posts).includes('order');
}

// =============================================================================
// 任务 6：照片不能从后台进来。配置层能关到的程度 + 构建期兜底（scripts/check-image-sources.mjs）
// =============================================================================
describe('禁上传（任务 6）：配置层只让挑已入库的图，上传口由构建期守卫兜底', () => {
  it('全局 media_folder 指向受 R5 守卫的 public/uploads（非内容 photos 目录）', () => {
    expect(config.media_folder, 'Sveltia 要求 media_folder 才能管理媒体').toBe('public/uploads');
    expect(config.media_folder).not.toMatch(/photos/);
  });

  it('两个集合都把媒体目录覆写成「相对本条目」（封面只能从本条目的照片里挑）', () => {
    for (const c of config.collections) {
      expect(c.media_folder, `${c.name} 该用条目相对媒体目录`).toBe('');
      expect(c.public_folder, `${c.name} 该用条目相对前缀，存出 photos/x.webp 这类路径`).toBe('');
    }
  });

  it('cover 用 image widget（从条目资源列表里点选）+ 关掉「输入 URL」+ 有 hint', () => {
    for (const c of config.collections) {
      const cover = c.fields.find((f) => f.name === 'cover');
      expect(cover?.widget, `${c.name} 的 cover 字段配置缺失`).toBe('image');
      expect(cover?.choose_url, `${c.name} 的 cover 不许外链`).toBe(false);
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
    // 兜底检查（R1/R3/R5）本身有独立用例文件，这里只钉「后台目录只有静态文件」这一事实
    const uploads = ['uploaded', 'uploads', 'media', 'images']
      .map((d) => resolve(ROOT, 'public', d))
      .filter((p) => existsSync(p));
    expect(uploads, 'public/ 下出现了上传目录，说明有非脚本图片通道').toEqual([]);
  });
});

// =============================================================================
// 任务 8：Editor Preview 与 imageUrl 的基准口径「互指」——只查注释与常量是否都还在
// =============================================================================
describe('Editor Preview 基准（任务 8）：imageUrl 与 public_folder 的互指口径不许走散', () => {
  it('public_folder 是纯 URL 前缀（/uploads）；内容图 URL 仍由 imageUrl 走同源根', () => {
    expect(config.public_folder).toBe('/uploads');
    // 上传媒体前缀与「内容封面 URL」是两回事，后者由 imageUrl.ts 负责
    expect(CONFIG_TEXT).toMatch(/imageUrl\.ts/);
  });

  it('config.yml / index.html / imageUrl.ts 三处都有「改基准必须同步另一处」的互指注释', () => {
    expect(CONFIG_TEXT).toMatch(/必须同步/);
    expect(INDEX_TEXT).toMatch(/imageUrl\.ts/);
    expect(INDEX_TEXT).toMatch(/同步/);
    const util = readFileSync(resolve(ROOT, 'src/utils/imageUrl.ts'), 'utf8');
    expect(util).toMatch(/public\/admin/);
    expect(util).toMatch(/必须同步|同步/);
  });

  it('index.html 只有一个外链 script、没有任何内联脚本（不手动 init、不留 Decap 镜像）', () => {
    // Sveltia 加载即自动初始化；内联脚本一律是历史遗留（Decap 的 registerPreview/resolvePreview）。
    const inline = INDEX_TEXT.replace(/<!--[\s\S]*?-->/g, '').match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
    expect(inline, 'index.html 不该再有内联脚本').toBeNull();
    const srcs = [...INDEX_TEXT.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toHaveLength(1);
  });
});
