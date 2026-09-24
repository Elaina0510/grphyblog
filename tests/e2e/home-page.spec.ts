import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// =============================================================================
// home-page §4.2 测试点 2（选 A：Playwright e2e，沿用现有 build+preview webServer）
//
// 打 `astro build` + `astro preview` 的静态产物，断言真首页：
//   - 四区结构齐备（开卷 / 精选 / 最新系列 / 最新随笔）
//   - 所有 <img> 显式 width+height（sidecar 真值）且 loading=lazy；唯一首屏 LCP 图 eager+fetchpriority=high
//   - draft 条目（daily-frames 系列 / 「雾起的那个早上」随笔）不外泄；非草稿（city-lights）在场
//   - 系列卡片张数 == sidecar 实际帧数；精选页码片帧号；入口链到 /series/<id>/
//   - 无 /visual-demo 之外的意外链接
//   - 移动端 375：跨页与卡片归一单列、图版不撑破横向
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test.describe('首页 · 结构与图片属性（桌面 1280）', () => {
  test('四个区都在，且 draft 条目不出现在公开列表', async ({ page }) => {
    await page.goto('/');

    for (const region of ['开卷', '精选', '最新系列', '最新随笔']) {
      await expect(page.locator(`section[aria-label="${region}"]`)).toHaveCount(1);
    }

    const html = await page.content();
    // 草稿：daily-frames 系列 + 「雾起的那个早上」随笔，任何形式都不该出现
    expect(html).not.toContain('daily-frames');
    expect(html).not.toContain('日常帧');
    expect(html).not.toContain('雾起的那个早上');
    // 非草稿：city-lights 系列与晨雾随笔应出现
    expect(html).toContain('city-lights');
    expect(html).toContain('夜光');
    expect(html).toContain('晨雾里的第一束光');
  });

  test('所有 <img> 显式 width+height + 懒加载；唯一首屏图 eager 且 fetchpriority=high', async ({ page }) => {
    await page.goto('/');

    const imgs = await page.$$eval('img', (els) =>
      els.map((el) => ({
        w: el.getAttribute('width'),
        h: el.getAttribute('height'),
        loading: el.getAttribute('loading'),
        priority: el.getAttribute('fetchpriority'),
        alt: el.getAttribute('alt'),
      })),
    );

    expect(imgs.length).toBeGreaterThanOrEqual(4);
    let eager = 0;
    for (const im of imgs) {
      expect(Number(im.w), '缺显式宽度').toBeGreaterThan(0);
      expect(Number(im.h), '缺显式高度').toBeGreaterThan(0);
      expect(im.alt, '缺 alt').not.toBeNull();
      if (im.loading === 'eager') {
        eager += 1;
        expect(im.priority, '首屏图须带 fetchpriority=high').toBe('high');
      } else {
        expect(im.loading, '非首屏图必须 lazy').toBe('lazy');
      }
    }
    expect(eager, '只允许首屏 LCP 那一张 eager').toBe(1);
  });

  test('系列卡片张数 == sidecar 实际帧数', async ({ page }) => {
    await page.goto('/');
    const sidecar = JSON.parse(
      readFileSync(resolve(ROOT, 'src/content/series/city-lights/photos.meta.json'), 'utf8'),
    ) as unknown[];
    const expected = sidecar.length; // 当前 = 2
    expect(expected).toBeGreaterThan(0);

    const cityCard = page
      .locator('section[aria-label="最新系列"] .home-entry')
      .filter({ hasText: '夜光' })
      .first();
    await expect(cityCard).toContainText(`${expected} 帧`);
  });

  test('精选入口：页码片帧号 + 链到对应系列详情', async ({ page }) => {
    await page.goto('/');
    const featured = page.locator('section[aria-label="精选"]');
    await expect(featured.locator('.frame-chip').first()).toHaveText(/01 \/ 02/);
    const href = await featured.locator('a.home-entry').first().getAttribute('href');
    expect(href).toBe('/series/city-lights/');
  });

  test('除导航/内容链接外无意外链接（尤其不链向 /visual-demo）', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page.$$eval('a[href]', (els) =>
      els.map((e) => e.getAttribute('href') ?? ''),
    );
    const distinct = [...new Set(hrefs)].filter((h) => h && !h.startsWith('#'));
    for (const h of distinct) {
      expect(h, `首页不该链向 ${h}`).not.toContain('visual-demo');
    }
    const allowed = new Set([
      '/',
      '/series/',
      '/posts/',
      '/about/',
      '/series/city-lights/',
      '/posts/2026-09-21-morning-fog/',
    ]);
    for (const h of distinct) {
      const ok = allowed.has(h) || h.startsWith('/series/') || h.startsWith('/posts/');
      expect(ok, `越界链接：${h}`).toBe(true);
    }
  });
});

test.describe('首页 · 移动端 375 降级', () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test('跨页与卡片归一单列、图版不撑破横向', async ({ page }) => {
    await page.goto('/');

    // 开场跨页在窄屏退化单列
    const spreadCols = await page
      .locator('section[aria-label="开卷"]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(spreadCols).not.toContain(' '); // 单栏

    // 卡片网格归一
    const gridCols = await page
      .locator('.home-grid')
      .first()
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(gridCols).not.toContain(' ');

    // 无横向溢出
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 图版宽度不超视口
    const plateW = await page
      .locator('section[aria-label="开卷"] figure.plate')
      .first()
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    expect(plateW).toBeLessThanOrEqual(375);
  });
});
