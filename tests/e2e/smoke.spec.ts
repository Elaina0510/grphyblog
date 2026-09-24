import { expect, test } from '@playwright/test';

// 最小 E2E 冒烟：对 `astro preview` 跑起来的真实静态产物发 HTTP 请求。
// 只用 request fixture（不需浏览器内核），保证网络受限的环境也能验证"构建产物可访问"；
// 需要真浏览器的灯箱/切图交互用例由 lightbox 模块补（见 package.json 的 test:e2e:install）。
test('首页返回 200 且渲染真实首页（非骨架占位）', async ({ request }) => {
  const res = await request.get('/');
  expect(res.ok()).toBeTruthy();
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html.toLowerCase()).toContain('<!doctype html>');
  expect(html).not.toContain('骨架占位首页');
  expect(html).toContain('<title>柚 · Justyou</title>');
  // 首页真实结构：精选 / 最新系列区在场
  expect(html).toContain('最新系列');
});

test('未定义路由返回 404（静态站未开 SSR）', async ({ request }) => {
  const res = await request.get('/this-route-does-not-exist-yet/');
  expect(res.status()).toBe(404);
});

// 真浏览器链路冒烟：Chromium 已由 `npm run test:e2e:install` 下载就绪。
// 这里只验「真实首页能被浏览器加载并渲染出结构」，细粒度断言见 home-page.spec.ts。
test('Chromium 可加载并渲染真实首页（开场书名 + 首屏图版）', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('柚 · Justyou');
  await expect(page.locator('h1')).toContainText('柚');
  await expect(page.locator('section[aria-label="开卷"] figure.plate img')).toHaveCount(1);
});
