import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// =============================================================================
// about-404 §4.2 测试点 1 + 2：关于页 / 404 的产物级与真 HTTP 集成测
//
// 前置：playwright.config 的 webServer 先 `npm run build` 再 `astro preview`，
// 所以本文件跑的时候 dist/ 必然是当前源码 + 当前 site.json 的最新构建产物。
//
//   产物  —— dist/404.html 必须落在 dist 根（Astro 对 src/pages/404.astro 的特殊约定，
//            不是 /404/index.html）；dist/about/index.html 存在（directory 格式 → /about/）。
//   数据源 —— 关于页的 intro / colophon / social / 书名全部对得上 site.json 的当前值：
//            断言拿的是「运行时读到的 JSON」而不是抄写串 —— 改 site.json 文案 → 重建，
//            本测跟着 JSON 走（任务 5「改文案即生效」的产物面证明）。
//   诚实  —— placeholder 的社交项 href 必须是 "#" 且同一链接内带 ※示例；
//            contact.email 为空 → 渲染 ※待补 且页内不得出现 mailto:。
//   导航  —— 书脊四项（首页/系列/随笔/关于的 label+href）都在 /about/ 页里，
//            且只有关于项 aria-current="page"；404 页无人点亮。
//   404   —— 不存在路由在 astro preview 下返回 404 状态 + 渲染 404 页 +
//            含 href="/" 的回首页链接，点击真的回到 /。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const site = JSON.parse(readFileSync(resolve(ROOT, 'src/data/site.json'), 'utf8')) as {
  name: { cjk: string; latin: string; display: string };
  bookName: { cjk: string; latin: string };
  nav: Array<{ key: string; href: string; label: string }>;
  colophon: Array<{ term: string; value: string }>;
  social: Array<{ key: string; label: string; href: string; placeholder?: boolean }>;
  contact: { email: string; placeholder?: boolean };
  intro: { sample?: boolean; text: string };
};

const DIST_404 = resolve(ROOT, 'dist/404.html');
const DIST_ABOUT = resolve(ROOT, 'dist/about/index.html');

const aboutHtml = () => readFileSync(DIST_ABOUT, 'utf8');

test.describe('构建产物（fs 直查 dist/）', () => {
  test('dist/404.html 存在且在 dist 根，含缺失页标记与指向 / 的回首页链接', () => {
    expect(existsSync(DIST_404), 'Astro 应在 dist 根产出 404.html').toBe(true);
    expect(existsSync(resolve(ROOT, 'dist/404/index.html')), '404 不应产成 /404/index.html').toBe(false);

    const html = readFileSync(DIST_404, 'utf8');
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('此页缺失');
    expect(html).toContain('aria-label="回首页"');
    expect(html).toMatch(/<a\b[^>]*href="\/"[^>]*>/);
    // 404 非四页之一：书脊不该点亮任何导航项
    expect(html).not.toContain('aria-current="page"');
  });

  test('dist/about/index.html 存在，intro / colophon / social / 书名逐一对得上 site.json', () => {
    expect(existsSync(DIST_ABOUT), '关于页应产出 dist/about/index.html → /about/').toBe(true);
    const html = aboutHtml();

    // 简介（含 sample 标记时必带 ※示例 —— 任务 5「文案取自 site.json」的直证）
    expect(html).toContain(site.intro.text);
    if (site.intro.sample) expect(html).toContain('※示例');

    // 制作信息表：每个 term ↔ value 都出现在页里
    for (const row of site.colophon) {
      expect(html, `版权页缺制作信息「${row.term}」`).toContain(row.term);
      expect(html, `版权页缺制作信息值「${row.value}」`).toContain(row.value);
    }

    // 社交 label + 书名/品牌（品牌串经 title/SiteMark 从 JSON 渲染）
    for (const item of site.social) expect(html).toContain(item.label);
    expect(html).toContain(site.bookName.cjk);
    expect(html).toContain(site.bookName.latin);
  });
});

test.describe('关于页 /about/（真 HTTP + 浏览器）', () => {
  test('GET /about/ 返回 200，与导航 href 口径一致', async ({ request }) => {
    const aboutNav = site.nav.find((n) => n.key === 'about');
    expect(aboutNav?.href, 'site.json 导航里应声明 about 路由').toBe('/about/');
    const res = await request.get('/about/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(site.intro.text);
    expect(html).toContain(site.colophon[0].value);
  });

  test('书脊导航四项齐备，且只有「关于」是当前页', async ({ page }) => {
    await page.goto('/about/');
    const nav = page.locator('nav[aria-label="站内导航"] a');
    await expect(nav).toHaveCount(site.nav.length);
    for (const item of site.nav) {
      const link = page.locator(`nav a[href="${item.href}"]`);
      await expect(link, `书脊缺导航项「${item.label}」`).toHaveCount(1);
      await expect(link).toHaveText(item.label);
      if (item.key === 'about') {
        await expect(link).toHaveAttribute('aria-current', 'page');
      } else {
        await expect(link).not.toHaveAttribute('aria-current');
      }
    }
  });

  test('placeholder 社交链接：href 降级为 # 且带 ※示例；contact 空邮箱显示 ※待补', async ({
    page,
  }) => {
    await page.goto('/about/');
    const linkRow = page.locator('.colophon-links');
    await expect(linkRow).toContainText('※待补'); // contact.email 为空（site.json 事实）

    for (const item of site.social) {
      const link = linkRow.locator('a', { hasText: item.label });
      await expect(link, `社交项「${item.label}」缺失`).toHaveCount(1);
      if (item.placeholder) {
        await expect(link).toHaveAttribute('href', '#');
        await expect(link).toContainText('※示例');
      } else {
        await expect(link).toHaveAttribute('href', item.href);
      }
    }
    // 空邮箱不得漏出 mailto:（site.json contact.email === '' 时）
    if (!site.contact.email) {
      expect(await page.content()).not.toContain('mailto:');
    }
  });
});

test.describe('404 命中与回首页（astro preview 真实 HTTP）', () => {
  test('GET 不存在路由 → 状态 404 且响应体就是 404 引导页', async ({ request }) => {
    const res = await request.get('/nope-xyz/');
    expect(res.status()).toBe(404);
    const html = await res.text();
    expect(html).toContain('此页缺失');
    expect(html).toMatch(/<a\b[^>]*href="\/"[^>]*>/);
  });

  test('浏览器打开不存在路由：渲染 404 页，点「回首页」真的回到 /', async ({ page }) => {
    const resp = await page.goto('/nope-xyz/');
    expect(resp?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText('此页缺失');

    const homeLink = page.locator('a[href="/"]', { hasText: '回到' });
    await expect(homeLink.first()).toBeVisible();
    await expect(homeLink.first()).toHaveAttribute('aria-label', '回首页');

    await homeLink.first().click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page).toHaveTitle(site.name.display);
  });
});
