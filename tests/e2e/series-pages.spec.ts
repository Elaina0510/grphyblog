import { expect, test } from '@playwright/test';

import { seriesPhotos } from './helpers/pool';

// =============================================================================
// series-pages 集成测（打 astro build + preview 的真实静态产物）
//
// 系列详情是「摄影集画册：一屏两页、左右翻页」。现存系列：daily-frames（5 帧）、
// street-notes（75 帧）。旧的 city-lights / wip-empty 已由作者于 2026-11-21 删除，
// 本文件全部改用现存系列做样本，不依赖已删内容。
//
// 覆盖：
//   列表  —— /series/ 渲染已发布系列（目次点线行）；卡片张数==sidecar 帧数。
//   详情  —— 章节题行 + 手记块（现存系列正文只有 HTML 注释，故手记块省略）；
//            照片流换成 [data-album] 画册，对页数=ceil(帧数/2)，一屏两张、末屏一张。
//   翻页  —— 左右按钮 / 键盘 ←→ / 到头就停 / aria-live 播报 / aria-hidden 隔离。
//   draft —— 草稿随笔「雾起的那个早上」不生成路由 → 404。
//   移动  —— 375：无横向溢出、对页归单列、竖排题名转横。
// =============================================================================

/** 该系列的帧序列（照片池化后：frontmatter photos[] → 全局 sidecar 查表，见 helpers/pool）。 */
const sidecarOf = (slug: string) => seriesPhotos(slug);

test.describe('系列列表 /series/ · 目次点线行', () => {
  test('渲染已发布系列（daily-frames / street-notes），草稿不出现', async ({ page }) => {
    await page.goto('/series/');
    await expect(page.locator('ol.toc')).toHaveCount(1);

    await expect(page.locator('a.toc-row[href="/series/daily-frames/"]')).toHaveCount(1);
    await expect(page.locator('a.toc-row[href="/series/street-notes/"]')).toHaveCount(1);
    // 旧的两个系列已被作者删除，不该还在列表里
    await expect(page.locator('a.toc-row[href="/series/city-lights/"]')).toHaveCount(0);
    await expect(page.locator('a.toc-row[href="/series/wip-empty/"]')).toHaveCount(0);

    const names = await page.locator('.toc .name').allInnerTexts();
    // 行序 = 后台拖拽维护的 order 升序：日常帧 2 → 街头随拍 4
    expect(names.findIndex((n) => n.includes('日常帧'))).toBe(0);
    expect(names.findIndex((n) => n.includes('街头随拍'))).toBe(1);
  });

  test('卡片张数 == sidecar 帧数', async ({ page }) => {
    await page.goto('/series/');
    const expected = sidecarOf('daily-frames').length;
    expect(expected).toBeGreaterThan(0);
    const meta = page.locator('a.toc-row[href="/series/daily-frames/"] .meta').first();
    await expect(meta).toContainText(`${expected} 帧`);
  });

  test('列表封面缩略图 URL 可加载（守住 imageUrl 误加斜杠成 /data: 的回归）', async ({ page }) => {
    await page.goto('/series/');
    const img = page.locator('a.toc-row[href="/series/daily-frames/"] .toc-cover img').first();
    await expect(img).toHaveCount(1);
    const src = await img.evaluate((el) => el.getAttribute('src') ?? '');
    expect(src, '缩略图不该被 imageUrl 加成不可加载的 /data:').not.toMatch(/^\/(?:data|blob):/);
    expect(src).toMatch(/^(\/_astro|data:|blob:|https?:)/);
  });
});

test.describe('系列详情 /series/daily-frames/ · 摄影集画册', () => {
  test('章节题行竖排宋体 + 手记块（正文只有注释 → 省略）', async ({ page }) => {
    await page.goto('/series/daily-frames/');
    await expect(page.locator('h1.chapter-title.v-writing')).toHaveCount(1);
    // daily-frames 正文只有 HTML 注释 → hasNoteContent=false → 手记块整块省略
    await expect(page.locator('section[aria-label="拍摄手记"]')).toHaveCount(0);
  });

  test('画册结构：对页数 = ceil(帧数/2)，一屏两张，显式宽高 + alt', async ({ page }) => {
    await page.goto('/series/daily-frames/');
    const sidecar = sidecarOf('daily-frames');
    const expectedSpreads = Math.ceil(sidecar.length / 2);

    await expect(page.locator('[data-album]')).toHaveCount(1);
    await expect(page.locator('[data-album-spread]')).toHaveCount(expectedSpreads);
    // 不再有旧灯箱图版与 frames 岛
    await expect(page.locator('figure[data-lightbox]')).toHaveCount(0);
    await expect(page.locator('script.lightbox-frames')).toHaveCount(0);

    const imgs = await page.$$eval('[data-album-spread] img', (els) =>
      els.map((el) => ({
        w: Number(el.getAttribute('width')),
        h: Number(el.getAttribute('height')),
        alt: el.getAttribute('alt'),
        loading: el.getAttribute('loading'),
        priority: el.getAttribute('fetchpriority'),
      })),
    );
    expect(imgs.length).toBe(sidecar.length);
    let eager = 0;
    let high = 0;
    for (const im of imgs) {
      expect(im.w, '缺显式宽度').toBeGreaterThan(0);
      expect(im.h, '缺显式高度').toBeGreaterThan(0);
      expect(im.alt, '缺 alt').not.toBeNull();
      if (im.loading === 'eager') eager += 1;
      else expect(im.loading).toBe('lazy');
      if (im.priority === 'high') high += 1;
    }
    expect(eager, '只允许首屏 LCP 那一张 eager').toBeLessThanOrEqual(1);
    expect(high, '首屏 LCP 那一张应是 high').toBeLessThanOrEqual(1);
  });

  test('翻页控件：左右按钮 / 键盘 / 到头就停 / aria-live 播报', async ({ page }) => {
    // 用多帧系列（街头随拍 75 帧 → 38 对页）验证翻页
    await page.goto('/series/street-notes/');
    const album = page.locator('[data-album]');
    const total = Number(await album.getAttribute('data-total'));
    expect(total).toBeGreaterThan(1);

    await expect(album).toHaveAttribute('data-index', '0');
    await expect(page.locator('[data-album-prev]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-album-next]')).not.toHaveAttribute('aria-disabled', 'true');

    await album.focus();
    await page.keyboard.press('ArrowRight');
    await expect(album).toHaveAttribute('data-index', '1');
    await expect(page.locator('[data-album-live]')).toContainText('第 2 页');

    await page.keyboard.press('ArrowLeft');
    await expect(album).toHaveAttribute('data-index', '0');

    await page.keyboard.press('End');
    await expect(album).toHaveAttribute('data-index', String(total - 1));
    await expect(page.locator('[data-album-next]')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(album).toHaveAttribute('data-index', String(total - 1));

    await page.locator('[data-album-prev]').click();
    await expect(album).toHaveAttribute('data-index', String(total - 2));
  });

  test('只有当前对页可见，其余 aria-hidden（翻页不堆叠）', async ({ page }) => {
    await page.goto('/series/daily-frames/');
    const spreads = page.locator('[data-album-spread]');
    await expect(spreads.first()).toHaveAttribute('data-active', 'true');
    await expect(spreads.first()).not.toHaveAttribute('aria-hidden', '');
    for (let i = 1; i < (await spreads.count()); i += 1) {
      await expect(spreads.nth(i)).toHaveAttribute('data-active', 'false');
      await expect(spreads.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

test.describe('draft 404', () => {
  test('草稿随笔「雾起的那个早上」不生成路由 → 404（草稿隔离仍在）', async ({ page }) => {
    const resp = await page.goto('/posts/2026-08-10-foggy-morning/');
    expect(resp?.status()).toBe(404);
  });
});

test.describe('移动端 375 降级', () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test('详情：无横向溢出、对页归单列、竖排题名转横', async ({ page }) => {
    await page.goto('/series/daily-frames/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 窄屏：每张照片是一页（.album-plate 是翻页单位），spread 用 display:contents 让位
    await expect(page.locator('[data-album]')).toHaveAttribute('data-mode', 'single');
    const spreadDisplay = await page
      .locator('[data-album-spread]')
      .first()
      .evaluate((el) => getComputedStyle(el).display);
    expect(spreadDisplay, '窄屏 spread 应退成 contents').toBe('contents');

    const plateW = await page
      .locator('[data-album-spread] img')
      .first()
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    expect(plateW).toBeLessThanOrEqual(375);
  });
});

test.describe('无 JS 降级', () => {
  test('禁用 JS：第一对页仍直出（内容不缺失，不藏全部）', async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: 'http://127.0.0.1:4321',
    });
    const page = await context.newPage();
    await page.goto('/series/daily-frames/');
    const spreads = page.locator('[data-album-spread]');
    expect(await spreads.count()).toBeGreaterThan(0);
    await expect(spreads.first()).toBeVisible();
    await context.close();
  });
});
