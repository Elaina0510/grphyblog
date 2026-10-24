import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { postsSchema, seriesSchema } from '../../src/content/schemas';

// =============================================================================
// /admin 后台的「退役契约」测试（admin-v2.md F 组）
//
// 历史：本文件原先是「public/admin/config.yml ↔ src/content/schemas.ts 逐字对齐」的往返测试
// （引擎 Sveltia CMS，更早是 Decap）。v0.1.1 起后台改为 public/admin/ 下的自建单页
// （原生 JS + Vditor），配置文件这一层整个消失，往返对齐已无对象可对齐，故整体改口径为
// 「退役契约」——钉住退役之后**仍然成立**的红线：
//
//   1) 退役是彻底的：config.yml 不得回来；public/admin/ 里也不许再接回任何第三方 CMS 的
//      运行时脚本或配置入口（否则「谁在读配置」又变成黑盒）；
//   2) 密钥红线：后台目录随站点公开，令牌只活在浏览器 localStorage，不许出现在任何文件里；
//   3) 照片通道：public/ 下不许有图片 / 上传目录（照片只有一个来源——全局照片池）；
//   4) photos.meta.json 与 pool/photos/ 永远不是「可编辑条目」：collection glob 只吃 .md；
//   5) strict schema 的红线没变：frontmatter 多一个未声明的键，下一次 npm run build 就崩
//      —— 只是现在拼 frontmatter 的是自建后台，不再是 CMS 的字段表单。
//
// 两处刻意放宽（避免给后续小组埋雷）：
//   · index.html 的断言是「**若存在**，必须是自建页而不是第三方 CMS 外壳」，不是「必须不存在」：
//     F 组只负责拆，入口页由 E 组创建；此刻 /admin 暂时 404 是可接受的中间态。
//   · 残留引用只钉**引擎接线**（运行时脚本、config.yml 入口、CMS 包依赖），不钉裸词
//     「Sveltia / Decap」：讲「为什么换掉它」的注释里出现引擎名是合法且有价值的。
//
// 唯一例外的裸词检查落在 src/utils/imageUrl.ts：它是图片 URL 的唯一出口，注释不该再描述
// 任何外部引擎的拼串规则。（src/utils/contentImages.ts 不在本文件的断言范围。）
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ADMIN_DIR = resolve(ROOT, 'public/admin');
const CONFIG_PATH = resolve(ADMIN_DIR, 'config.yml');
const INDEX_PATH = resolve(ADMIN_DIR, 'index.html');
const IMAGE_URL_UTIL = resolve(ROOT, 'src/utils/imageUrl.ts');

/** 站点常量（与 astro.config.mjs 的 site、doc/account-setup.md 的 Pages 项目名同源）。 */
const REPO = 'Elaina0510/grphyblog';
const BRANCH = 'main';

/** 第三方 CMS 的「接线」特征串：命中即说明后台又被接回了某个通用 CMS 引擎。 */
const CMS_WIRING = [
  '@sveltia/cms',
  'sveltia-cms.js',
  'netlify-cms',
  'decap-cms',
  // 通用 CMS 的配置入口文件名：自建后台没有这一层，出现即代表配置黑盒回来了
  'config.yml',
];

/** 图片扩展名（与 scripts/check-image-sources.mjs 同口径，不含 .json）。 */
const IMAGE_EXTENSIONS = [
  '.webp',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.avif',
  '.heic',
  '.tif',
  '.tiff',
];

/** 递归收集目录下的文件（相对 root 的 POSIX 路径）；目录不存在时返回空数组。 */
function listFiles(root: string, rel = ''): string[] {
  const abs = rel ? join(root, rel) : root;
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, childRel));
    else out.push(childRel);
  }
  return out;
}

/** 读文本文件；不存在返回 null（不抛，方便写「若存在则…」的断言）。 */
function readTextIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

// =============================================================================
// 1) 退役的完成度：两个 Sveltia 入口文件
// =============================================================================
describe('Sveltia 已退役（F1）：两个入口文件不在了，后台目录还在', () => {
  it('public/admin/config.yml 已删除（自建后台没有配置文件这一层）', () => {
    expect(
      existsSync(CONFIG_PATH),
      'public/admin/config.yml 还在：第三方 CMS 的配置入口没有被拆掉（F1 未完成）',
    ).toBe(false);
  });

  it('public/admin/index.html 若存在，只能是自建页，不能是第三方 CMS 的外壳', () => {
    const html = readTextIfExists(INDEX_PATH);
    if (html === null) return; // F 组的中间态：入口页由 E 组创建
    // 第三方 CMS 外壳页的两个标志：外链运行时脚本 + 从本目录读 config.yml。
    expect(html, 'index.html 仍引用某个 CMS 运行时脚本').not.toMatch(
      /<script[^>]+src="[^"]*(@sveltia\/cms|sveltia-cms\.js|netlify-cms|decap-cms)/i,
    );
    expect(html, 'index.html 仍从本目录读 config.yml').not.toMatch(/config\.yml/);
  });

  it('public/admin 目录与 .gitkeep 都还在（E 组在这里建自建后台）', () => {
    expect(
      existsSync(ADMIN_DIR),
      'public/admin 目录被删了：tests/unit/directory-tree.test.ts 会红',
    ).toBe(true);
    // 目录里此刻可能只有 .gitkeep（中间态），但它必须留下来兜住 git 对空目录的跟踪
    expect(existsSync(resolve(ADMIN_DIR, '.gitkeep')), 'public/admin/.gitkeep 被顺手删掉了').toBe(
      true,
    );
  });

  it('public/ 下不存在第二份后台配置（config.yml / config.yaml 都不许有）', () => {
    const strays = listFiles(resolve(ROOT, 'public')).filter((rel) =>
      /(^|\/)config\.ya?ml$/i.test(rel),
    );
    expect(strays, `public/ 下出现了后台配置文件：${strays.join(', ')}`).toEqual([]);
  });
});

// =============================================================================
// 2) 残留引用：后台目录与图片 URL 出口都不许指向通用 CMS
// =============================================================================
describe('残留引用（F2/F3）：不再接回任何第三方 CMS 引擎', () => {
  it('public/admin 下的文件不引用 CMS 运行时脚本、也不引用 config.yml 入口', () => {
    const hits: string[] = [];
    for (const rel of listFiles(ADMIN_DIR)) {
      const text = readFileSync(join(ADMIN_DIR, rel), 'utf8');
      for (const needle of CMS_WIRING) {
        if (text.includes(needle)) hits.push(`public/admin/${rel} → ${needle}`);
      }
    }
    expect(hits, `后台目录里还有 CMS 接线残留：\n${hits.join('\n')}`).toEqual([]);
  });

  it('src/utils/imageUrl.ts 不再提 Sveltia / Decap / config.yml / public_folder', () => {
    const util = readFileSync(IMAGE_URL_UTIL, 'utf8');
    for (const word of ['Sveltia', 'sveltia', 'Decap', 'decap', 'config.yml', 'public_folder']) {
      expect(util, `imageUrl.ts 仍在描述已退役的 CMS 口径：${word}`).not.toContain(word);
    }
    // 正向断言：注释必须指认「后台预览与该文件同规则」这条新口径（防止有人把整段删干净）
    expect(util, 'imageUrl.ts 缺「后台预览与这里同规则」的同步说明').toMatch(/public\/admin/);
    expect(util, 'imageUrl.ts 缺「改基准必须同步」的提醒').toMatch(/必须同步/);
  });

  it('没有 CMS 包被装进依赖（Sveltia 时代走 CDN，退役后也不许回退成依赖）', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    const cms = names.filter((n) => /sveltia|decap|netlify-cms/i.test(n));
    expect(cms, `依赖里出现了 CMS 包：${cms.join(', ')}`).toEqual([]);
  });
});

// =============================================================================
// 3) 密钥红线（旧文件同名用例的延续）：后台目录随站点公开
// =============================================================================
describe('密钥红线：令牌只进浏览器 localStorage，不进仓库', () => {
  it('public/admin 下任何文件都不含 GitHub 令牌字面量', () => {
    const hits: string[] = [];
    for (const rel of listFiles(ADMIN_DIR)) {
      const text = readFileSync(join(ADMIN_DIR, rel), 'utf8');
      if (/\bgh[pousr]_[A-Za-z0-9]{20,}/.test(text) || /github_pat_[A-Za-z0-9_]{20,}/.test(text)) {
        hits.push(`public/admin/${rel}`);
      }
    }
    expect(hits, `后台目录里写死了访问令牌：${hits.join(', ')}`).toEqual([]);
  });

  it('public/admin 下没有 client_secret 之类的 OAuth 凭据赋值（后台已无 OAuth 流程）', () => {
    const hits: string[] = [];
    for (const rel of listFiles(ADMIN_DIR)) {
      const text = readFileSync(join(ADMIN_DIR, rel), 'utf8');
      if (/client_secret\s*[:=]\s*['"]?\S/i.test(text)) hits.push(`public/admin/${rel}`);
    }
    expect(hits, `后台目录里出现了 OAuth 凭据：${hits.join(', ')}`).toEqual([]);
  });

  it('后端指向与登录方式写在文档里：交代 localStorage、GitHub contents API、仓库与分支', () => {
    const text = readTextIfExists(resolve(ROOT, 'doc/admin-login-setup.md'));
    expect(text, 'doc/admin-login-setup.md 不见了（F4 要把它改成自建后台登录说明）').toBeTruthy();
    // 配置文件没了，这些事实只能由文档承担，缺一项就等于「后台怎么连仓库」无从查证
    expect(text as string, '登录说明必须交代令牌只存 localStorage').toMatch(/localStorage/);
    expect(text as string, '登录说明必须交代走 GitHub contents API').toMatch(/contents/i);
    expect(text as string).toContain(REPO);
    expect(text as string).toMatch(new RegExp(`\\b${BRANCH}\\b`));
  });
});

// =============================================================================
// 4) 照片通道（旧文件「任务 6」的重写口径）
//    Sveltia 时代靠三层配置防线；现在只剩「唯一通道 + 构建期守卫」，
//    所以这里钉的是与引擎无关的那条事实：public/ 里不许有图片。
// =============================================================================
describe('照片通道：图片只能出自照片池，public/ 里不许有图片', () => {
  it('public/ 下没有任何图片文件（图片唯一位置是 src/content/pool/photos/）', () => {
    const images = listFiles(resolve(ROOT, 'public')).filter((rel) => isImageFile(rel));
    expect(images, `public/ 下出现了图片：${images.join(', ')}`).toEqual([]);
  });

  it('public/ 下没有 uploads / media / images 之类的上传目录', () => {
    const uploads = ['uploaded', 'uploads', 'media', 'images']
      .map((d) => `public/${d}`)
      .filter((rel) => existsSync(resolve(ROOT, rel)));
    expect(uploads, 'public/ 下出现了上传目录，说明有非脚本图片通道').toEqual([]);
  });

  it('全局 sidecar 存在时必须是 JSON 数组（池化后只有一份，不按条目分散）', () => {
    const sidecar = readTextIfExists(resolve(ROOT, 'src/content/pool/photos.meta.json'));
    if (sidecar === null) return; // 迁移中可能尚未生成
    expect(
      Array.isArray(JSON.parse(sidecar) as unknown),
      'src/content/pool/photos.meta.json 不是 PhotoEntry 数组',
    ).toBe(true);
  });
});

// =============================================================================
// 5) sidecar 与照片池永远不是「可编辑条目」（旧文件同名契约，去掉 CMS 词汇）
// =============================================================================
describe('photos.meta.json 与 pool/photos/ 不是内容条目', () => {
  it('collection 的 glob 只吃 .md：sidecar 与照片永远成不了条目', () => {
    const config = readFileSync(resolve(ROOT, 'src/content.config.ts'), 'utf8');
    const patterns = [...config.matchAll(/pattern:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(
      patterns.length,
      '没能从 src/content.config.ts 抠出 loader pattern，用例前提破了',
    ).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern, `collection glob 会吃到非 markdown 文件：${pattern}`).toMatch(/\.md$/);
      expect(pattern).not.toMatch(/json|photos/);
    }
  });

  it('schema 里没有任何描述 sidecar 形状的键（cover 是 ID 串、photos 是 ID 数组）', () => {
    const sidecarKeys = ['file', 'thumb', 'width', 'height', 'exif', 'meta'];
    for (const [name, schema] of [
      ['series', seriesSchema],
      ['posts', postsSchema],
    ] as const) {
      const shape = (
        schema as unknown as {
          shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
        }
      ).shape;
      const keys = Object.keys(shape);
      for (const banned of sidecarKeys) {
        expect(keys, `${name}Schema 把 sidecar 的形状写进了内容模型：${banned}`).not.toContain(banned);
      }
      // cover = 照片 ID（池内完整文件名，含扩展名）
      expect(shape.cover.safeParse('night-01.webp').success, `${name}.cover 应是裸 ID 串`).toBe(true);
      // photos = ID 数组；单串不合法（防止退回「一个相对路径字段」的老写法）
      expect(shape.photos.safeParse(['night-01.webp']).success, `${name}.photos 应是 ID 数组`).toBe(
        true,
      );
      expect(
        shape.photos.safeParse('night-01.webp').success,
        `${name}.photos 退回了单串写法`,
      ).toBe(false);
    }
  });

  it('strict 红线没变：frontmatter 多一个未声明的键，构建就崩（写 frontmatter 的换成自建后台）', () => {
    const base = {
      title: '示例',
      date: '2026-09-20',
      cover: 'night-01.webp',
      photos: ['night-01.webp'],
      tags: ['城市'],
      draft: false,
    };
    expect(seriesSchema.safeParse({ ...base, order: 1 }).success, '合法 frontmatter 应当通过').toBe(
      true,
    );
    expect(postsSchema.safeParse(base).success, '合法 frontmatter 应当通过').toBe(true);
    // 少一个必填键（tags）同样不合法：证明上一条不是空转
    expect(seriesSchema.safeParse({ ...base, order: 1, tags: undefined }).success).toBe(false);
    // 多一个未声明的键（slug / body / summary）必须被 .strict() 拦下
    for (const extra of ['slug', 'body', 'summary']) {
      expect(
        seriesSchema.safeParse({ ...base, order: 1, [extra]: 'x' }).success,
        `${extra} 混进 frontmatter 却没被 .strict() 拦下`,
      ).toBe(false);
      expect(
        postsSchema.safeParse({ ...base, [extra]: 'x' }).success,
        `${extra} 混进 frontmatter 却没被 .strict() 拦下`,
      ).toBe(false);
    }
  });
});
