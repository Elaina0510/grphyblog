import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// =============================================================================
// series-pages §4.2 系列页集成测（打 astro build + preview 的真实静态产物）
//
// 覆盖任务钉的验收点：
//   列表  —— /series/ 渲染已发布系列（目次点线行）；draft daily-frames 不在列表；卡片张数==sidecar 帧数。
//   详情  —— /series/city-lights/ 存在；照片流按 sidecar 顺序；每张 <img> 显式 width+height + lazy
//            （仅首屏 LCP 封面那张允许 eager+high，与首页 §8.3 同口径）。
//   契约  —— .lightbox-frames[data-gallery="series-city-lights"] JSON 岛：frames 数==帧数、
//            含 src/thumb/width/height/exif；每张图版带 data-lightbox-gallery + 递增 data-lightbox-index。
//   手记  —— city-lights（有正文）渲染手记块；wip-empty（空正文）整块省略（§4 测试点 4 端到端）。
//   draft —— 访问 /series/daily-frames/ 返回 404（getStaticPaths 不生成 → 天然 404）。
//   移动  —— 375：详情页无横向溢出、照片流归单列。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const sidecarOf = (slug: string) =>
  JSON.parse(
    readFileSync(resolve(ROOT, `src/content/series/${slug}/photos.meta.json`), 'utf8'),
  ) as Array<{ file: string; thumb: string; width: number; height: number }>;

/** 解析详情页灯箱岛 JSON。 */
async function readIsland(page: import('@playwright/test').Page, gallery: string) {
  return page.$eval(`.lightbox-frames[data-gallery="${gallery}"]`, (el) => {
    const raw = el.textContent ?? '';
    return JSON.parse(raw) as {
      frames: Array<{
        src: string;
        thumb: string;
        width: number;
        height: number;
        alt: string;
        title?: string;
        exif: Record<string, unknown>;
      }>;
    };
  });
}

test.describe('系列列表 /series/ · 目次点线行', () => {
  test('渲染已发布系列，draft daily-frames 不出现', async ({ page }) => {
    await page.goto('/series/');
    await expect(page.locator('ol.toc')).toHaveCount(1);

    // 已发布（city-lights）在列，链到详情
    await expect(page.locator('a.toc-row[href="/series/city-lights/"]')).toHaveCount(1);
    expect(await page.locator('.toc .name').first().innerText()).toContain('夜光');

    // 草稿：路径与题名都不该出现
    await expect(page.locator('a[href="/series/daily-frames/"]')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain('daily-frames');
    expect(html).not.toContain('日常帧');
  });

  test('卡片张数 == sidecar 帧数', async ({ page }) => {
    await page.goto('/series/');
    const expected = sidecarOf('city-lights').length; // 当前 = 2
    expect(expected).toBeGreaterThan(0);
    const meta = page
      .locator('a.toc-row[href="/series/city-lights/"] .meta')
      .first();
    await expect(meta).toContainText(`${expected} 帧`);
  });

  test('空正文已发布系列（wip-empty）仍入列，张数为 0', async ({ page }) => {
    await page.goto('/series/');
    const meta = page.locator('a.toc-row[href="/series/wip-empty/"] .meta').first();
    await expect(meta).toContainText('0 帧');
  });

  test('列表封面缩略图 URL 可加载（守住 imageUrl 误加斜杠成 /data: 的回归）', async ({ page }) => {
    await page.goto('/series/');
    const img = page.locator('a.toc-row[href="/series/city-lights/"] .toc-cover img').first();
    await expect(img).toHaveCount(1);
    const src = await img.evaluate((el) => el.getAttribute('src') ?? '');
    expect(src, '缩略图不该被 imageUrl 加成不可加载的 /data:').not.toMatch(/^\/(?:data|blob):/);
    expect(src).toMatch(/^(\/_astro|data:|blob:|https?:)/);
  });
});

test.describe('系列详情 /series/city-lights/ · 结构与图片属性', () => {
  test('章节题行竖排宋体 + 封面跨页在；手记块（有正文）渲染', async ({ page }) => {
    await page.goto('/series/city-lights/');
    await expect(page.locator('h1.chapter-title.v-writing')).toHaveCount(1);
    await expect(page.locator('.series-cover figure.plate')).toHaveCount(1);
    // 手记块：city-lights 有正文 → 出现，并含正文片段
    await expect(page.locator('section[aria-label="拍摄手记"]')).toHaveCount(1);
    expect(await page.locator('.series-note__body').innerText()).toContain('城市入夜');
  });

  test('每帧恰好一张图版：封面 + 照片流；按 sidecar 顺序、显式宽高 + lazy（LCP 例外）', async ({ page }) => {
    await page.goto('/series/city-lights/');
    const sidecar = sidecarOf('city-lights');

    // 参与灯箱的图版总数 == 帧数（封面 hero + 流，各帧一次不重复）
    const plates = page.locator('figure.plate[data-lightbox]');
    await expect(plates).toHaveCount(sidecar.length);

    // 灯箱索引集合 = 0..total-1 且唯一、递增
    const indexes = (await plates.evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute('data-lightbox-index'))),
    )).sort((a, b) => a - b);
    expect(indexes).toEqual(sidecar.map((_, i) => i));

    // 所有 <img> 显式 width+height + alt；loading：≤1 张 eager（且 high），其余 lazy
    const imgs = await page.$$eval('figure.plate img', (els) =>
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
    for (const im of imgs) {
      expect(im.w, '缺显式宽度').toBeGreaterThan(0);
      expect(im.h, '缺显式高度').toBeGreaterThan(0);
      expect(im.alt).not.toBeNull();
      if (im.loading === 'eager') {
        eager += 1;
        expect(im.priority).toBe('high');
      } else {
        expect(im.loading).toBe('lazy');
      }
    }
    expect(eager, '只允许首屏 LCP 那一张 eager').toBe(1);
  });

  test('灯箱数据契约：frames 岛数==帧数、字段齐；图版 data-lightbox-gallery 一致', async ({ page }) => {
    await page.goto('/series/city-lights/');
    const sidecar = sidecarOf('city-lights');

    // 岛存在（type=application/json）
    await expect(page.locator('script.lightbox-frames[data-gallery="series-city-lights"]')).toHaveCount(1);
    const island = await readIsland(page, 'series-city-lights');
    expect(island.frames.length).toBe(sidecar.length);

    island.frames.forEach((f, i) => {
      // src/thumb 是「已解析的可服务 URL」：/_astro/... 或 data: 内联缩略图
      expect(f.src, `帧 ${i} src 非可服务 URL`).toMatch(/^(\/|https?:|data:)/);
      expect(f.thumb, `帧 ${i} thumb 非可服务 URL`).toMatch(/^(\/|https?:|data:)/);
      expect(f.width).toBeGreaterThan(0);
      expect(f.height).toBeGreaterThan(0);
      expect(typeof f.exif).toBe('object');
      // 宽高与 sidecar 展示图真值一致
      expect(f.width).toBe(sidecar[i].width);
      expect(f.height).toBe(sidecar[i].height);
    });

    // 每张图版都在同一图库下
    const galleries = await page.$$eval('figure.plate[data-lightbox]', (els) =>
      els.map((e) => e.getAttribute('data-lightbox-gallery')),
    );
    for (const g of galleries) expect(g).toBe('series-city-lights');
  });
});

test.describe('手记为空 / draft 404', () => {
  test('wip-empty（空正文）详情：手记块整体省略、无照片流/灯箱岛', async ({ page }) => {
    await page.goto('/series/wip-empty/');
    await expect(page.locator('section[aria-label="拍摄手记"]')).toHaveCount(0);
    await expect(page.locator('.series-flow')).toHaveCount(0);
    await expect(page.locator('script.lightbox-frames')).toHaveCount(0);
    await expect(page.locator('figure.plate')).toHaveCount(0);
    // 但骨架与章题仍在（页面确实生成了）
    await expect(page.locator('h1.chapter-title')).toHaveCount(1);
  });

  test('draft 系列 daily-frames 路由不生成 → 404', async ({ page }) => {
    const resp = await page.goto('/series/daily-frames/');
    expect(resp?.status()).toBe(404);
  });
});

test.describe('移动端 375 降级', () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test('详情：无横向溢出、照片流归单列、竖排题名转横', async ({ page }) => {
    await page.goto('/series/city-lights/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const cols = await page
      .locator('.flow-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(cols, '窄屏照片流应归单列').not.toContain(' ');

    const plateW = await page
      .locator('figure.plate')
      .first()
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    expect(plateW).toBeLessThanOrEqual(375);
  });
});
