import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// 产物断言用**独立**输出目录，而不是 dist/：Astro 构建前会清空 outDir，
// 若与 build-smoke.test.ts（产出 dist/）并发跑会互相清场，故这里走 node_modules/.tmp/
// （node_modules/ 已被 .gitignore 排除，不污染工作树）。部署契约只看结构，与目录名无关。
const OUT_REL = 'node_modules/.tmp/deploy-dist';
const OUT = resolve(ROOT, OUT_REL);

/** 产物目录里的绝对路径。 */
const dist = (...parts: string[]) => join(OUT, ...parts);

/** 读产物 HTML（顺带断言文件真的非空，免得"空壳也算存在"蒙混过关）。 */
function readPage(rel: string): string {
  const abs = dist(rel);
  expect(existsSync(abs), `构建产物缺 ${rel}`).toBe(true);
  expect(statSync(abs).size, `${rel} 是空文件`).toBeGreaterThan(200);
  const html = readFileSync(abs, 'utf8');
  expect(html.toLowerCase(), `${rel} 缺 doctype`).toContain('<!doctype html>');
  return html;
}

/** 只取 frontmatter（两个 --- 之间），避免把正文里的 `draft:` 当真。 */
function frontmatter(md: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  return m ? m[1] : '';
}

/** 草稿口径与 src/utils/collections.ts 一致：只排除 draft: true，false/缺省都发布。 */
function isDraft(md: string): boolean {
  return /^draft:\s*true\s*$/m.test(frontmatter(md));
}

/** 系列资源夹 → { id, draft }（无 index.md 的空夹跳过）。 */
function collectSeriesEntries(): { id: string; draft: boolean }[] {
  const dir = resolve(ROOT, 'src/content/series');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(dir, d.name, 'index.md')))
    .map((d) => ({ id: d.name, draft: isDraft(readFileSync(join(dir, d.name, 'index.md'), 'utf8')) }));
}

/** 随笔 Markdown → { id: slug, draft }。 */
function collectPostEntries(): { id: string; draft: boolean }[] {
  const dir = resolve(ROOT, 'src/content/posts');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ id: f.replace(/\.md$/, ''), draft: isDraft(readFileSync(join(dir, f), 'utf8')) }));
}

/** 已发布的系列 id（资源夹名）。 */
function publishedSeriesIds(): string[] {
  return collectSeriesEntries()
    .filter((e) => !e.draft)
    .map((e) => e.id);
}

/** 已发布的随笔 slug（文件名去掉 .md）。 */
function publishedPostSlugs(): string[] {
  return collectPostEntries()
    .filter((e) => !e.draft)
    .map((e) => e.id);
}

/** 待发布（草稿）的系列 id / 随笔 slug：它们不该出现在产物里。 */
const draftSeriesIds = () => collectSeriesEntries().filter((e) => e.draft).map((e) => e.id);
const draftPostSlugs = () => collectPostEntries().filter((e) => e.draft).map((e) => e.id);

// =============================================================================
// deployment §4.2「可本地验证项」：把"云端能不能跑"变成"本地断言能不能过"。
//   ① 6 类页面产物齐备 + dist/404.html 存在（Pages 原生识别，无需 _redirects）；
//   ② 产物全站根相对路径 —— 换成任意域名（*.pages.dev / 日后的自定义域）都不用重构建；
//   ③ Node 版本对齐机制：.nvmrc 与 package.json engines.node 同值，且 .nvmrc 不被 gitignore 吞掉；
//   ④ push 前工作树复核：raw/ thumbs/ dist/ 一律不出现在 git status 里（原图永不入库）。
// 外部动作（push、Pages 连接、线上验证）不在此处，见 doc/account-setup.md。
// =============================================================================
describe('部署产物结构（deployment 任务 2/3/7 的本地断言）', () => {
  let buildOut = '';

  beforeAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    buildOut = execSync(`npx astro build --outDir ${OUT_REL}`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
  });

  it('astro build 正常收尾（产物目录可用）', () => {
    expect(buildOut).toContain('Complete!');
    expect(existsSync(OUT)).toBe(true);
  });

  // design §5 的 6 类页面：首页 / 系列列表 / 系列详情 / 随笔列表 / 随笔详情 / 关于页
  it('① 首页 + ② 系列列表 + ④ 随笔列表 + ⑥ 关于页 产物齐备', () => {
    readPage('index.html');
    readPage('series/index.html');
    readPage('posts/index.html');
    readPage('about/index.html');
  });

  it('③ 系列详情：每个已发布系列都有 <id>/index.html（至少一个）', () => {
    const ids = publishedSeriesIds();
    expect(ids.length, '至少要有一个已发布系列可验证').toBeGreaterThan(0);
    for (const id of ids) readPage(join('series', id, 'index.html'));
  });

  it('⑤ 随笔详情：每个已发布 slug 都有 <slug>/index.html（至少一个）', () => {
    const slugs = publishedPostSlugs();
    expect(slugs.length, '至少要有一篇已发布随笔可验证').toBeGreaterThan(0);
    for (const slug of slugs) readPage(join('posts', slug, 'index.html'));
  });

  it('草稿内容不进产物（draft: true 的条目一个都不上线）', () => {
    const drafts = draftSeriesIds().map((id) => join('series', id, 'index.html'));
    const draftPosts = draftPostSlugs().map((slug) => join('posts', slug, 'index.html'));
    const all = [...drafts, ...draftPosts];
    // 没有草稿时不空转报错，但也不假装通过：显式说明前提
    if (all.length === 0) {
      expect(publishedSeriesIds().length, '当前无草稿可验证，且一个条目都没有？').toBeGreaterThan(0);
      return;
    }
    for (const rel of all) {
      expect(existsSync(dist(rel)), `草稿条目被发布了：${rel}`).toBe(false);
    }
  });

  // Cloudflare Pages 约定：站点根目录有 404.html 即接管所有未命中路径（deployment 任务 7）
  it('dist/404.html 存在且带"回首页"出路（Pages 识别用，无需 _redirects）', () => {
    const html = readPage('404.html');
    expect(html).toContain('回首页');
    expect(html).toMatch(/href="\/"/);
  });

  it('public/ 里没有 _redirects 之类的平台专属文件（404 走 Pages 原生约定）', () => {
    expect(existsSync(resolve(ROOT, 'public/_redirects'))).toBe(false);
    expect(existsSync(dist('_redirects'))).toBe(false);
  });

  it('产物内链接与资源全为根相对路径，且无本地 dev 地址泄漏', () => {
    for (const page of ['index.html', 'series/index.html', 'posts/index.html', 'about/index.html', '404.html']) {
      const html = readPage(page);
      expect(html, `${page} 泄漏了本地开发地址`).not.toMatch(/localhost:4321|127\.0\.0\.1/);
      // 站内链接：href="/..." 或 href="/xxx/"，不得出现带协议的站内绝对地址
      expect(html, `${page} 有非根相对的站内链接`).not.toMatch(/href="https?:\/\//);
    }
  });

  // Pages 构建容器是 Linux：路径大小写写错在 Windows 上看不出来，上线才 404。
  // 这条断言拿产物里真实存在的文件名做**精确**比对，把这类问题提前到本地。
  it('页面引用的每个 /_astro/ 资源在产物里真实存在且大小写一致', () => {
    const assetsDir = join(OUT, '_astro');
    expect(existsSync(assetsDir), '产物缺 _astro/ 资源目录').toBe(true);
    // JS 字符串比对天然区分大小写：磁盘真实名与引用名对不上就是没命中
    const realNames = new Set(readdirSync(assetsDir));
    let checked = 0;

    const pages = readdirSync(OUT, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.html'));
    for (const rel of pages) {
      const html = readFileSync(join(OUT, rel), 'utf8');
      for (const m of html.matchAll(/(?:src|href)="(\/_astro\/[^"?#]+)(?:[^"]*)"/g)) {
        const name = decodeURIComponent(m[1].slice('/_astro/'.length));
        expect(realNames.has(name), `${rel} 引用的资源在产物里不存在或大小写不符：/_astro/${name}`).toBe(true);
        checked += 1;
      }
    }
    // 兜底：一个都没扫到说明断言空转了
    expect(checked, '未扫到任何 _astro 资源引用，断言空转').toBeGreaterThan(10);
  });
});

// Cloudflare Pages 按 .nvmrc（或项目环境变量 NODE_VERSION）决定云端 Node 版本；
// 与 engines.node 失配是首次构建最常见的失败原因，故在此钉成断言。
describe('Node 版本对齐（.nvmrc ↔ engines.node）', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

  it('.nvmrc 存在且只有一个主版本号 24（Pages 构建容器读取）', () => {
    const abs = resolve(ROOT, '.nvmrc');
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, 'utf8').trim()).toBe('24');
  });

  it('.nvmrc 与 package.json 的 engines.node 同值（本机与云端同一口径）', () => {
    expect(readFileSync(resolve(ROOT, '.nvmrc'), 'utf8').trim()).toBe(String(pkg.engines.node));
  });

  it('.nvmrc 不被 .gitignore 排除（要能随 push 到达云端）', () => {
    // 退出码口径：0 = 被忽略，1 = 未被忽略，128 = 命令本身出错（此时不能当"未被忽略"放过）。
    const r = spawnSync('git check-ignore .nvmrc', {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
    });
    expect([0, 1], `git check-ignore 执行异常：${r.stderr?.trim()}`).toContain(r.status);
    expect(r.status, '.nvmrc 被 .gitignore 吃掉了，云端拿不到它').toBe(1);
  });
});

// deployment 任务 2 的本地部分：push 之前复核"该进的都进、不该进的一件都没有"。
// 忽略规则本身（raw/ thumbs/ node_modules/ dist/ .astro/ 逐条 check-ignore、
// 以及"Git 未跟踪 raw/ thumbs/"）已由 gitignore.test.ts 覆盖，此处不重复，
// 只补一条部署语境才有的断言：真去 push 的那一刻，工作树里不会冒出任何素材或产物。
describe('push 前工作树复核（原图与产物不会跟着上路）', () => {
  const NEVER_PUSH = ['raw/', 'thumbs/', 'dist/', 'node_modules/', '.astro/', 'coverage/'];

  it('git status 里没有任何素材/产物条目（含未跟踪）', () => {
    const out = execSync('git status --porcelain --untracked-files=normal', {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const paths = out
      .split('\n')
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    for (const p of paths) {
      for (const bad of NEVER_PUSH) {
        expect(p.startsWith(bad), `git status 出现了不该推送的 ${p}`).toBe(false);
      }
    }
  });
});
