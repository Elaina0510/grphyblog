import { expect, test } from '@playwright/test';

// 最小 E2E 冒烟：对 `astro preview` 跑起来的真实静态产物发 HTTP 请求。
// 只用 request fixture（不需浏览器内核），保证网络受限的环境也能验证"构建产物可访问"；
// 需要真浏览器的灯箱/切图交互用例由 lightbox 模块补（见 package.json 的 test:e2e:install）。
test('首页返回 200 且是骨架页', async ({ request }) => {
  const res = await request.get('/');
  expect(res.ok()).toBeTruthy();
  expect(res.status()).toBe(200);

  const html = await res.text();
  expect(html.toLowerCase()).toContain('<!doctype html>');
  expect(html).toContain('骨架占位首页');
  expect(html).toContain('<title>柚 · Justyou</title>');
});

test('未定义路由返回 404（静态站未开 SSR）', async ({ request }) => {
  const res = await request.get('/this-route-does-not-exist-yet/');
  expect(res.status()).toBe(404);
});

// 真浏览器链路冒烟：Chromium 已由 `npm run test:e2e:install` 下载就绪。
// 后续 lightbox 模块的交互用例（开灯箱 / ←→ 切帧 / Esc / EXIF 拍摄单）挂在这条链路下扩展。
test('Chromium 可加载并渲染骨架首页', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('柚 · Justyou');
  await expect(page.locator('h1')).toHaveText('骨架占位首页');
});
