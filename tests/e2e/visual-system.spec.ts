import { expect, test } from '@playwright/test';

// =============================================================================
// visual-system §4.2 测试点 4（第二半）：演示页在真实浏览器里的渲染断言
//
// 打的是 `astro build` + `astro preview` 的静态产物（见 playwright.config.ts 的 webServer），
// 所以这里验的是「上线同源」的事实：
//   - 版式骨架：书脊 76px / 容器 1280 / 三声部字号与行高（token 真的接到了元素上）
//   - 图版：显式宽高 = sidecar 真值，且渲染盒子比例与之一致（§6 防布局抖动）
//   - 页码片与拍摄单：Courier Prime 真的加载了；EXIF 缺字段容错；※示例 是朱砂色
//   - 动效：rise 一次编排真的会揭开；prefers-reduced-motion 下全部直出
//   - 两档视口（桌面 1280 / 手机 375）书脊与三件套不错位、不横向溢出
// 视觉稿的「并排眼看」仍待人工核验（内嵌浏览器面板限制），本文件只断言可机检的事实。
// =============================================================================

const ROUTE = '/visual-demo/';
const CINNABAR = 'rgb(160, 59, 40)'; // #A03B28
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 780 };

async function computed(page: import('@playwright/test').Page, selector: string, prop: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el, property) => getComputedStyle(el as Element).getPropertyValue(property), prop);
}

test.describe('视觉系统 · 桌面 1280', () => {
  test.use({ viewport: DESKTOP });

  test('书脊与骨架：76px 书脊 + 竖排四项导航 + 1280 容器 + 正文 16.5/1.9', async ({ page }) => {
    await page.goto(ROUTE);

    await expect(page.locator('header.spine')).toBeVisible();
    expect(await computed(page, 'header.spine', 'width')).toBe('76px');
    expect(await computed(page, '.page', 'margin-left')).toBe('76px');
    expect(await computed(page, '.wrap', 'max-width')).toBe('1280px');

    // 书脊导航四项，且是竖排（writing-mode 生效）
    const nav = page.locator('nav.spine-nav a');
    await expect(nav).toHaveCount(4);
    await expect(nav.first()).toHaveText('开卷');
    expect(await computed(page, 'nav.spine-nav a', 'writing-mode')).toBe('vertical-rl');
    expect(await computed(page, 'nav.spine-nav a', 'font-family')).toContain('Noto Serif SC');

    // 排版默认值真的落到 body 上
    expect(await computed(page, 'body', 'font-size')).toBe('16.5px');
    const lineHeight = await computed(page, 'body', 'line-height');
    expect(Number.parseFloat(lineHeight)).toBeCloseTo(16.5 * 1.9, 1);
    expect(await computed(page, 'body', 'background-color')).toBe('rgb(242, 241, 236)');
    expect(await computed(page, 'body', 'color')).toBe('rgb(38, 36, 31)');

    // 唯一缓动曲线与章间留白都来自 :root token
    const rootVars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        ease: s.getPropertyValue('--ease').replace(/\s+/g, ''),
        gapPage: s.getPropertyValue('--gap-page').replace(/\s+/g, ''),
        measure: s.getPropertyValue('--measure'),
      };
    });
    expect(rootVars.ease).toBe('cubic-bezier(.16,1,.3,1)'); // §10 原样（Chromium 会去掉前导零）
    expect(rootVars.gapPage).toContain('clamp(');
    expect(rootVars.measure.trim()).toBe('66ch');

    // 开场跨页 1/3 文字 · 2/3 图版
    const cols = await computed(page, '.spread', 'grid-template-columns');
    const [left, right] = cols.split(' ').map((v) => Number.parseFloat(v));
    expect(right / left).toBeGreaterThan(1.6);
    expect(right / left).toBeLessThan(2.6);
  });

  test('图版：显式宽高＝sidecar 真值 + 全懒加载（首屏例外）+ 渲染比例不抖动', async ({ page }) => {
    await page.goto(ROUTE);

    const plates = page.locator('figure.plate img');
    const count = await plates.count();
    expect(count).toBeGreaterThanOrEqual(6);

    let lazy = 0;
    for (let i = 0; i < count; i += 1) {
      const img = plates.nth(i);
      const attrs = await img.evaluate((el) => ({
        w: el.getAttribute('width'),
        h: el.getAttribute('height'),
        loading: el.getAttribute('loading'),
        alt: el.getAttribute('alt'),
        src: el.currentSrc || el.getAttribute('src'),
      }));
      expect(attrs.w, '缺显式宽度').toBeTruthy();
      expect(attrs.h, '缺显式高度').toBeTruthy();
      expect(Number(attrs.w)).toBeGreaterThan(0);
      expect(Number(attrs.h)).toBeGreaterThan(0);
      expect(attrs.alt, '缺 alt').not.toBeNull();
      expect((attrs.src ?? '').length).toBeGreaterThan(0);
      if (attrs.loading === 'lazy') lazy += 1;
      else expect(attrs.loading).toBe('eager'); // 只允许首屏那张

      // 声明的宽高比 == 实际盒子比例 → 没有布局抖动
      const cover = await img.evaluate((el) => !!el.closest('.plate--cover'));
      const box = await img.boundingBox();
      expect(box).not.toBeNull();
      const { width, height } = box as { width: number; height: number };
      const rendered = width / height;
      if (cover) {
        expect(Math.abs(rendered - 4 / 3)).toBeLessThan(0.03);
      } else {
        const declared = Number(attrs.w) / Number(attrs.h);
        expect(Math.abs(rendered - declared) / declared).toBeLessThan(0.06);
      }
    }
    expect(lazy).toBeGreaterThanOrEqual(count - 1);
  });

  test('页码片：帧号文案 + Courier Prime 真字族 + 夜底遮罩', async ({ page }) => {
    await page.goto(ROUTE);

    const chip = page.locator('.frame-chip').first();
    await expect(chip).toHaveText(/01 \/ 01/);
    expect(await computed(page, '.frame-chip', 'font-family')).toContain('Courier Prime');
    expect(await computed(page, '.frame-chip', 'font-size')).toBe('11px');
    expect(await computed(page, '.frame-chip', 'background-color')).toBe('rgba(25, 24, 22, 0.84)');
    expect(await computed(page, '.frame-chip', 'color')).toBe('rgb(242, 241, 236)');

    // 字体文件真的下来了（自建 latin 子集，不靠第三方 CDN）
    const courierLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('11px "Courier Prime"');
    });
    expect(courierLoaded).toBe(true);
  });

  test('拍摄单：真值不标注 / 占位值带 ※ / 缺字段整项不出现 / 全空不留纸片', async ({ page }) => {
    await page.goto(ROUTE);

    const cards = page.locator('figcaption.shotcard');
    expect(await cards.count()).toBeGreaterThanOrEqual(3);

    // 第一张：sidecar 真值 → 七个字段里出现了几项，且不带 data-demo
    const first = cards.first();
    await expect(first.locator('.t')).toHaveText('逢简 · 伞与幡');
    const realFields = await first.locator('.m [data-field]').count();
    expect(realFields).toBeGreaterThanOrEqual(5);
    await expect(first.locator('.m')).not.toHaveAttribute('data-demo', 'true');

    // 带 ※示例 的那张：等宽参数行里的标注是朱砂色
    const demo = page.locator('figcaption.shotcard .demo').first();
    await expect(demo).toBeVisible();
    expect(await demo.evaluate((el) => getComputedStyle(el).color)).toBe(CINNABAR);

    // 只给机型：参数行只剩一项
    const cameraOnly = page.locator('figcaption.shotcard', { hasText: '只有机型' });
    await expect(cameraOnly.locator('.m [data-field]')).toHaveCount(1);
    await expect(cameraOnly.locator('.m [data-field]')).toHaveText(/GX85/);

    // 快门/ISO 为占位的那张：恰好两项带 ※
    const partial = page.locator('figcaption.shotcard', { hasText: '布幡街' });
    await expect(partial.locator('.demo')).toHaveCount(2);

    // exif 全空 → 不渲染拍摄单（第三张缩略图里没有 figcaption）
    const emptyHost = page.locator('figure.plate', { has: page.locator('img[alt="窗内糖葫芦缩略图"]') });
    await expect(emptyHost.locator('figcaption.shotcard')).toHaveCount(0);
  });

  test('闲章与方印：朱砂描边圆印在图版右上，方印在书脊末端', async ({ page }) => {
    await page.goto(ROUTE);
    const stamp = page.locator('.stamp').first();
    await expect(stamp).toBeVisible();
    expect(await stamp.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(CINNABAR);
    expect(await stamp.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe('0px');

    const seal = page.locator('header.spine .seal');
    await expect(seal).toHaveText('柚');
    expect(await seal.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(CINNABAR);
  });

  test('动效：rise 会揭开；减弱动效下全部直出', async ({ page, browser }) => {
    await page.goto(ROUTE);

    const last = page.locator('.rise').last();
    await expect
      .poll(() => last.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
      .toBe('0'); // 视口外的章还压着

    await last.scrollIntoViewIfNeeded();
    await expect
      .poll(() => last.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
      .toBe('1'); // 进视口才揭开，且整页只编排一次

    /* 另开一个「从一开始就减弱动效」的会话：真实用户是这种情况，
       在已加载页面上切媒体会读到上一段动画的进行中值，那不是直出口径。 */
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: DESKTOP });
    const calm = await ctx.newPage();
    await calm.goto(ROUTE);
    const allStraight = await calm.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>('.rise')];
      return {
        count: nodes.length,
        straight: nodes.every((el) => {
          const s = getComputedStyle(el);
          return (
            s.opacity === '1' &&
            (s.transform === 'none' || s.transform === '') &&
            (s.clipPath === 'none' || s.clipPath === '')
          );
        }),
        running: document.getAnimations().length,
      };
    });
    expect(allStraight.count).toBeGreaterThan(10);
    expect(allStraight.straight).toBe(true);
    expect(allStraight.running).toBe(0);
    await ctx.close();
  });
});

test.describe('视觉系统 · 手机 375', () => {
  test.use({ viewport: MOBILE });

  test('书脊转吸顶横条、导航转横排、多栏归一、不横向溢出', async ({ page }) => {
    await page.goto(ROUTE);

    expect(await computed(page, 'header.spine', 'position')).toBe('sticky');
    expect(await computed(page, 'header.spine', 'height')).toBe('56px');
    expect(await computed(page, '.page', 'margin-left')).toBe('0px');
    expect(await computed(page, 'nav.spine-nav a', 'writing-mode')).toBe('horizontal-tb');
    expect(await computed(page, '.t-display', 'writing-mode')).toBe('horizontal-tb');
    expect(await computed(page, '.spread', 'grid-template-columns')).not.toMatch(/\s/); // 单栏

    // 图版与三件套都在视口内，不撑破横向
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const plate = page.locator('figure.plate').first();
    const box = await plate.boundingBox();
    expect(box).not.toBeNull();
    expect((box as { width: number }).width).toBeLessThanOrEqual(MOBILE.width);
    await expect(page.locator('.frame-chip').first()).toBeVisible();
    await expect(page.locator('figcaption.shotcard').first()).toBeVisible();
  });

  test('正文与微标签在小屏仍可读（字号阶梯没塌）', async ({ page }) => {
    await page.goto(ROUTE);
    expect(await computed(page, 'body', 'font-size')).toBe('16.5px');
    expect(await computed(page, '.mono', 'font-size')).toBe('11.5px');
    expect(await computed(page, 'nav.spine-nav a', 'font-size')).toBe('13.5px');
    expect(await computed(page, '.chapter-no', 'font-family')).toContain('Courier Prime');
    expect(await computed(page, '.chapter-no', 'color')).toBe(CINNABAR);
  });
});
