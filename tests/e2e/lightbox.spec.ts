import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

// =============================================================================
// lightbox 模块 · 灯箱 E2E（打 astro build + astro preview 的真实静态产物）
//
// 覆盖 lightbox.md 任务 1–10 + 两条验收，且**三处入口跑同一套核心流**（任务 9）：
//   开    —— 点任意图版 → 夜底遮罩可见、帧 src/宽高/alt 都出自 frames 岛、页码片与 aria-live 同步；
//   切    —— →/← 键与左右按钮换帧、到头就停（aria-disabled，焦点不吃掉）；
//   关    —— Esc / 下滑关闭 → 遮罩消失 + **焦点回到触发它的原图版**；
//   EXIF  —— 拍摄单展开/收起，内容 = 该帧 sidecar 字段（机型/日期…）+ 帧号；换帧跟着换；
//   动效  —— View Transition 真的给「图版 ↔ 灯箱像」命名并在结束后清名；
//            不支持 VT 的浏览器走淡入降级；prefers-reduced-motion 下直开直关（instant）；
//   无障碍 —— 背景 inert（.spine / .page）、焦点圈闭在灯箱内、每个按钮都有可读标签；
//   键盘  —— 只用键盘可完成 开 → 切 → 关；
//   预加载 —— 开帧时相邻帧的展示图被提前拉起（不靠猜网络事件：直接观察 img.src 赋值）；
//   契约  —— 三页各自 frames 岛帧数 == 该组 sidecar/图版数，index 在范围内且覆盖全部帧，
//            每张图版 <img src> 与它索引到的帧 src 一致（入口 → 数据不串行）；
//   移动  —— 375 视口触摸目标 ≥ 44、左右滑切帧、下滑关闭。
//
// ⚠️ 不谎报：真机手势（原生 touch→pointer 链路、惯性、系统返回）桌面模拟覆盖不了，
// 归 performance-acceptance 模块人工验收；这里只断言我们自己的手势判定被正确接线。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const NIGHT = 'rgb(25, 24, 22)'; // var(--night) = #191816
const SHELL = '[data-lb]';
const IMAGE = '[data-lb] .lb-img';
const STAGE = '[data-lb-stage]';

interface Frame {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  title?: string;
  exif: Record<string, unknown>;
}

interface Entry {
  name: string;
  path: string;
  gallery: string;
  /** 该组「应产出的帧数」：由磁盘上的 sidecar / site.json / 正文引用独立推出来，不写魔法数 */
  expectedFrames: number;
  /** 参与灯箱的图版数 */
  expectedPlates: number;
  multi: boolean;
}

const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as T;

type Sidecar = Array<{ file: string; thumb: string; width: number; height: number }>;

/* 首页：帧 = 精选挑图按展示图去重（开场图与精选首图同图 → 共享同一帧索引） */
const site = readJson<{ featured: { photos: Array<{ file: string }> } }>('src/data/site.json');
const HOME_FRAMES = [...new Set(site.featured.photos.map((p) => p.file))].length;

/* 系列详情：帧 = sidecar 全部条目（封面 + 照片流各出现一次，不重复） */
const SERIES_SIDECAR = readJson<Sidecar>('src/content/series/city-lights/photos.meta.json');

/* 随笔详情：帧 = 正文真引用的插图（去重） */
const POST_SLUG = '2026-09-21-morning-fog';
const POST_BODY = readFileSync(resolve(ROOT, `src/content/posts/${POST_SLUG}.md`), 'utf8').replace(
  /^---[\s\S]*?---/,
  '',
);
const POST_REFS = [...new Set([...POST_BODY.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]))];

const ENTRIES: Entry[] = [
  {
    name: '首页 · 开场图 + 精选入口',
    path: '/',
    gallery: 'home',
    expectedFrames: HOME_FRAMES,
    expectedPlates: HOME_FRAMES + 1, // 开场图另占一张图版（与精选首图同索引）
    multi: HOME_FRAMES > 1,
  },
  {
    name: '系列详情 · 照片流',
    path: '/series/city-lights/',
    gallery: 'series-city-lights',
    expectedFrames: SERIES_SIDECAR.length,
    expectedPlates: SERIES_SIDECAR.length,
    multi: SERIES_SIDECAR.length > 1,
  },
  {
    name: '随笔详情 · 正文插图',
    path: `/posts/${POST_SLUG}/`,
    gallery: `post-${POST_SLUG}`,
    expectedFrames: POST_REFS.length,
    expectedPlates: POST_REFS.length,
    multi: POST_REFS.length > 1,
  },
];

/* ------------------------------- 小工具 ------------------------------- */

const basename = (url: string): string => url.split('/').pop() ?? url;

function plates(page: Page): Locator {
  return page.locator('figure[data-lightbox]');
}

async function islandFrames(page: Page, gallery: string): Promise<Frame[]> {
  const island = await page.$eval(
    `script.lightbox-frames[data-gallery="${gallery}"]`,
    (el) => JSON.parse(el.textContent ?? '{"frames":[]}') as { frames?: Frame[] },
  );
  return island.frames ?? [];
}

/** 观察「哪些 <img> 被 JS 赋过 src」：确定性证明相邻帧被提前拉起，不靠猜网络事件。 */
async function watchImageSrcAssignments(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder = window as unknown as { __imgSrcs: string[] };
    holder.__imgSrcs = [];
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!desc?.set) return;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: desc.get,
      set(value: string) {
        holder.__imgSrcs.push(String(value));
        desc.set!.call(this, value);
      },
    });
  });
}

async function assignedImageSrcs(page: Page): Promise<string[]> {
  const list = await page.evaluate(
    () => (window as unknown as { __imgSrcs?: string[] }).__imgSrcs ?? [],
  );
  return list.map(basename);
}

/** 观察首张图版 <img> 的 style 变化：断言 View Transition 命名真的发生并被清掉。 */
async function watchPlateStyle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __plateStyles: string[] };
    holder.__plateStyles = [];
    const img = document.querySelector('figure[data-lightbox] img');
    if (!img) return;
    const obs = new MutationObserver(() => {
      holder.__plateStyles.push(img.getAttribute('style') ?? '');
    });
    obs.observe(img, { attributes: true, attributeFilter: ['style'] });
  });
}

async function plateStyles(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __plateStyles?: string[] }).__plateStyles ?? [],
  );
}

async function attr(page: Page, selector: string, name: string): Promise<string> {
  const value = await page.locator(selector).first().getAttribute(name);
  return value ?? '';
}

async function openByClick(page: Page, which = 0): Promise<Locator> {
  const plate = plates(page).nth(which);
  await plate.click();
  await expect(page.locator(SHELL), '点图版后灯箱没开').toBeVisible();
  return plate;
}

async function closeByEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator(SHELL)).toBeHidden();
}

async function imageSrc(page: Page): Promise<string> {
  const src = await page.locator(IMAGE).getAttribute('src');
  return src ?? '';
}

/** 等某一帧的展示图渐进替换完成（缩略图 → 展示图）。 */
async function waitFullImage(page: Page): Promise<void> {
  await expect
    .poll(async () => attr(page, IMAGE, 'data-lb-src-state'), { timeout: 15_000 })
    .toBe('full');
}

async function focusIsPlate(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (document.activeElement as Element | null)?.matches('figure[data-lightbox]') === true,
  );
}

/* ======================= 一、三处入口共用的核心流 ======================= */

for (const entry of ENTRIES) {
  test.describe(`灯箱核心流 · ${entry.name}`, () => {
    let frames: Frame[] = [];

    test.beforeEach(async ({ page }) => {
      await page.goto(entry.path);
      frames = await islandFrames(page, entry.gallery);
    });

    test('① 点图版开灯箱：夜底遮罩可见 + 帧数据全部出自 frames 岛（缩略图先行、展示图渐进替换）', async ({
      page,
    }) => {
      // 再导航一次：init script 要在那之前装好，用来观察「谁先被赋 src」
      await watchImageSrcAssignments(page);
      await page.goto(entry.path);
      await openByClick(page);

      await expect(page.locator('[data-lb-scrim]')).toBeVisible();
      expect(
        await page.locator('[data-lb-scrim]').evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe(NIGHT);
      await expect(page.locator(SHELL)).toHaveAttribute('role', 'dialog');
      await expect(page.locator(SHELL)).toHaveAttribute('aria-modal', 'true');
      await expect(page.locator(SHELL)).toHaveAttribute('aria-label', /灯箱/);

      const first = frames[0];
      const img = page.locator(IMAGE);
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute('width', String(first.width));
      await expect(img).toHaveAttribute('height', String(first.height));
      await expect(img).toHaveAttribute('alt', first.alt);

      // 秒开 + 渐进替换：缩略图先被赋值，展示图在后（顺序确定，不靠抢拍瞬间）
      const srcs = await assignedImageSrcs(page);
      const thumbPos = srcs.lastIndexOf(basename(first.thumb));
      const fullPos = srcs.lastIndexOf(basename(first.src));
      expect(thumbPos, '缩略图没有被先摆上').toBeGreaterThanOrEqual(0);
      expect(fullPos, '展示图没有换上来').toBeGreaterThan(thumbPos);
      await waitFullImage(page);
      expect(basename(await imageSrc(page))).toBe(basename(first.src));

      await expect(page.locator('[data-lb-chip]')).toHaveText(
        `01 / ${String(frames.length).padStart(2, '0')}`,
      );
      await expect(page.locator('[data-lb-live]')).toHaveText(
        first.title
          ? `第 1 帧，共 ${frames.length} 帧 · ${first.title}`
          : `第 1 帧，共 ${frames.length} 帧`,
      );
    });

    test('①b 点照片只开灯箱，不劫持导航', async ({ page }) => {
      const before = page.url();
      await openByClick(page);
      expect(page.url()).toBe(before);
      await closeByEscape(page);
      expect(page.url()).toBe(before);
    });

    test('② 切帧：→ / ← 与按钮都换帧，页码片与 aria-live 同步，到头就停', async ({ page }) => {
      await openByClick(page);
      const img = page.locator(IMAGE);
      await expect(img).toHaveAttribute('data-lb-frame', '0');

      if (!entry.multi) {
        // 单帧图库（这篇随笔只引用了一张插图）：两向都到头，按键不换帧
        await expect(page.locator('[data-lb-next]')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('[data-lb-prev]')).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await expect(img).toHaveAttribute('data-lb-frame', '0');
        return;
      }

      await page.keyboard.press('ArrowRight');
      await expect(img).toHaveAttribute('data-lb-frame', '1');
      await waitFullImage(page);
      expect(basename(await imageSrc(page))).toBe(basename(frames[1].src));
      await expect(page.locator('[data-lb-chip]')).toHaveText(
        `02 / ${String(frames.length).padStart(2, '0')}`,
      );
      await expect(page.locator('[data-lb-live]')).toContainText(`第 2 帧，共 ${frames.length} 帧`);
      // 换帧后 alt 跟着换（读屏拿到的是当前帧）
      await expect(img).toHaveAttribute('alt', frames[1].alt);

      // 按钮路径：回到第 1 帧
      await page.locator('[data-lb-prev]').click();
      await expect(img).toHaveAttribute('data-lb-frame', '0');
      await expect(page.locator('[data-lb-prev]')).toHaveAttribute('aria-disabled', 'true');

      // 走到最后一帧：到头就停，按钮只是弱化、不吃焦点
      await page.keyboard.press('End');
      await expect(img).toHaveAttribute('data-lb-frame', String(frames.length - 1));
      await expect(page.locator('[data-lb-next]')).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('ArrowRight');
      await expect(img).toHaveAttribute('data-lb-frame', String(frames.length - 1));
      expect(await attr(page, '[data-lb-next]', 'tabindex')).not.toBe('-1');
    });

    test('③ Esc 关闭：遮罩消失 + 焦点回到触发它的原图版', async ({ page }) => {
      const plate = await openByClick(page, entry.multi ? 1 : 0);
      const index = await plate.getAttribute('data-lightbox-index');
      expect(await imgFrame(page)).toBe(index);

      await closeByEscape(page);

      expect(await plate.evaluate((el) => document.activeElement === el)).toBe(true);
      await expect(page.locator('header.spine')).not.toHaveAttribute('inert', '');
      await expect(page.locator('div.page')).not.toHaveAttribute('inert', '');
      expect(
        await page.evaluate(() => document.documentElement.classList.contains('lb-lock')),
      ).toBe(false);
    });

    test('④ 拍摄单：展开后含该帧 sidecar 字段 + 帧号，换帧同步，再按收起', async ({ page }) => {
      await openByClick(page);
      const sheet = page.locator('[data-lb-sheet]');
      const toggle = page.locator('[data-lb-exif]');

      // 收起态：inert（对 Tab 与读屏都不存在），不是「看得见摸不到」
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(await sheet.evaluate((el) => el.hasAttribute('inert'))).toBe(true);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(SHELL)).toHaveClass(/lb--sheet-open/);
      expect(await sheet.evaluate((el) => el.hasAttribute('inert'))).toBe(false);
      await expect(sheet).toBeVisible();
      await expect(page.locator('[data-lb-sheet-frame]')).toHaveText(`第 1 帧 · 共 ${frames.length} 帧`);

      const exif = frames[0].exif;
      const field = (key: string) => sheet.locator(`[data-field="${key}"]`);
      if (typeof exif.camera === 'string' && exif.camera) {
        await expect(field('camera')).toHaveText(exif.camera);
        await expect(sheet.locator('dt').first()).toHaveText('机型');
      } else {
        await expect(field('camera')).toHaveCount(0);
      }
      if (typeof exif.dateTaken === 'string' && exif.dateTaken) {
        await expect(field('dateTaken')).toHaveText(/^\d{4}\.\d{2}\.\d{2}$/);
        expect(await field('dateTaken').textContent()).not.toBe(exif.dateTaken); // 印刷口径，不是原样 ISO
      }
      if (typeof exif.aperture === 'number') {
        await expect(field('aperture')).toHaveText(
          `f/${String(exif.aperture).replace(/\.0$/, '')}`,
        );
      }

      if (entry.multi) {
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-lb-sheet-frame]')).toHaveText(
          `第 2 帧 · 共 ${frames.length} 帧`,
        );
        const second = frames[1].exif;
        if (typeof second.dateTaken === 'string' && second.dateTaken) {
          await expect(field('dateTaken')).toHaveText(/^\d{4}\.\d{2}\.\d{2}$/);
        }
        if (typeof second.camera !== 'string' || !second.camera) {
          await expect(field('camera')).toHaveCount(0); // 缺字段整项不输出，不造假
        }
      }

      // 抽屉里的「收起」只收抽屉：灯箱还在，焦点交还给拍摄单按钮（不落回 body）
      await page.locator('[data-lb-sheet-close]').click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator(SHELL)).toBeVisible();
      expect(await toggle.evaluate((el) => document.activeElement === el)).toBe(true);
      expect(await sheet.evaluate((el) => el.hasAttribute('inert'))).toBe(true);

      // 再展开 → 用顶部按钮收起（同一个开关双向）
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(await sheet.evaluate((el) => el.hasAttribute('inert'))).toBe(true);
    });

    test('⑤ 关闭按钮与点夜底空白都能退出，且焦点回到图版', async ({ page }) => {
      const plateA = await openByClick(page);
      await page.locator('[data-lb-close]').click();
      await expect(page.locator(SHELL)).toBeHidden();
      expect(await plateA.evaluate((el) => document.activeElement === el)).toBe(true);

      const plateB = await openByClick(page, entry.multi ? 1 : 0);
      // 点夜底空白处（左上角落在灯箱内衬里，确实是遮罩本体）
      await page.locator('[data-lb-scrim]').click({ position: { x: 4, y: 4 } });
      await expect(page.locator(SHELL)).toBeHidden();
      expect(await plateB.evaluate((el) => document.activeElement === el)).toBe(true);
    });

    test('⑥ 无障碍：背景 inert + 焦点圈闭在灯箱内 + 按钮都有可读标签', async ({ page }) => {
      await openByClick(page);

      await expect(page.locator('header.spine')).toHaveAttribute('inert', '');
      await expect(page.locator('div.page')).toHaveAttribute('inert', '');
      expect(await page.locator(SHELL).evaluate((el) => (el as HTMLElement).inert)).toBe(false);

      expect(
        await page.evaluate(() => document.querySelector('[data-lb]')?.contains(document.activeElement) ?? false),
        '开启后焦点没进灯箱'
      ).toBe(true);

      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        expect(
          await page.evaluate(
            () => document.querySelector('[data-lb]')?.contains(document.activeElement) ?? false,
          ),
          `第 ${i + 1} 次 Tab 焦点跑出了灯箱`,
        ).toBe(true);
      }

      const missing = await page
        .locator(`${SHELL} button`)
        .evaluateAll((els) =>
          els
            .filter((el) => !(el.getAttribute('aria-label') ?? '').trim())
            .map((el) => (el.textContent ?? '').trim()),
        );
      expect(missing, '这些灯箱按钮没有 aria-label').toEqual([]);
      expect(await page.locator(`${SHELL} button`).count()).toBeGreaterThanOrEqual(5);

      await expect(page.locator('[data-lb-live]')).toHaveAttribute('aria-live', 'polite');
      await expect(page.locator('[data-lb-live]')).toHaveAttribute('role', 'status');
    });

    test('⑦ 键盘-only：Tab 到图版 → Enter 开 → 方向键切 → Esc 关', async ({ page }) => {
      let reached = false;
      for (let i = 0; i < 40 && !reached; i += 1) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() =>
          (document.activeElement as Element | null)?.matches('figure[data-lightbox]') === true,
        );
      }
      expect(reached, 'Tab 走不到任何可灯箱图版').toBe(true);

      await page.keyboard.press('Enter');
      await expect(page.locator(SHELL)).toBeVisible();
      const img = page.locator(IMAGE);
      const start = Number(await attr(page, IMAGE, 'data-lb-frame'));
      expect(Number.isNaN(start)).toBe(false);

      if (entry.multi) {
        await page.keyboard.press('ArrowRight');
        await expect(img).toHaveAttribute('data-lb-frame', String(start + 1));
        await page.keyboard.press('ArrowLeft');
        await expect(img).toHaveAttribute('data-lb-frame', String(start));
      }

      await closeByEscape(page);
      expect(await focusIsPlate(page), '关闭后焦点没回到图版').toBe(true);
    });

    test('⑧ 契约一致性：帧数 == 该组图版/sidecar、index 覆盖全部帧、图版 src 与索引到的帧一致', async ({
      page,
    }) => {
      expect(frames.length).toBe(entry.expectedFrames);
      await expect(plates(page)).toHaveCount(entry.expectedPlates);

      const info = await plates(page).evaluateAll((els) =>
        els.map((el) => {
          const figure = el as HTMLElement;
          return {
            gallery: figure.getAttribute('data-lightbox-gallery'),
            index: Number(figure.getAttribute('data-lightbox-index')),
            lightbox: figure.getAttribute('data-lightbox'),
            src: figure.querySelector('img')?.getAttribute('src') ?? '',
          };
        }),
      );

      const indexes: number[] = [];
      for (const item of info) {
        expect(item.lightbox).toBe('true');
        expect(item.gallery, '图版的图库 id 与岛不一致').toBe(entry.gallery);
        expect(Number.isInteger(item.index), `index 不是整数：${item.index}`).toBe(true);
        expect(item.index, `index 越界：${item.index}`).toBeGreaterThanOrEqual(0);
        expect(item.index).toBeLessThan(frames.length);
        expect(basename(item.src)).toBe(basename(frames[item.index].src));
        indexes.push(item.index);
      }
      // 每帧都有图版可对上（首页开场图与精选首图共享索引，允许重复）
      expect([...new Set(indexes)].sort((a, b) => a - b)).toEqual(frames.map((_, i) => i));
      if (entry.expectedPlates === entry.expectedFrames) {
        expect([...indexes].sort((a, b) => a - b)).toEqual(frames.map((_, i) => i)); // 连续 0..n-1
      }

      for (const frame of frames) {
        expect(frame.src).toMatch(/^(\/|https?:|data:)/);
        expect(frame.thumb).toMatch(/^(\/|https?:|data:)/);
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
        expect(typeof frame.exif).toBe('object');
      }
    });
  });
}

/** 当前可见帧索引（字符串，便于与图版的 data-lightbox-index 直接比）。 */
async function imgFrame(page: Page): Promise<string> {
  return attr(page, IMAGE, 'data-lb-frame');
}

/* ============================ 二、动效与降级 ============================ */

test.describe('动效 · View Transition / 淡入降级 / reduced-motion', () => {
  test('支持 VT：图版被命名 plate、结束后清名，开与关都到终态', async ({ page }) => {
    await page.goto('/series/city-lights/');
    await watchPlateStyle(page);

    await openByClick(page);
    expect(await attr(page, SHELL, 'data-lb-motion')).toBe('view-transition');
    expect(
      (await plateStyles(page)).some((s) => s.includes('view-transition-name')),
      '图版从未被命名（形变入场没接上）',
    ).toBe(true);

    await closeByEscape(page);

    await expect
      .poll(
        async () => {
          const styles = await plateStyles(page);
          const last = styles[styles.length - 1];
          return last !== undefined && !last.includes('view-transition-name');
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    expect(await attr(page, SHELL, 'data-lb-morph')).toBe('');
    expect(
      await page.evaluate(
        () =>
          (document.querySelector('[data-lb] .lb-img') as HTMLImageElement | null)?.style.getPropertyValue(
            'view-transition-name',
          ) ?? '',
      ),
    ).toBe('');
  });

  test('不支持 VT：淡入 + 缩放降级，仍能完整开 → 切 → 关', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'startViewTransition', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });
    await page.goto('/series/city-lights/');
    await openByClick(page);

    expect(await attr(page, SHELL, 'data-lb-motion')).toBe('fade');
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '0');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '1');

    await closeByEscape(page);
    expect(await attr(page, SHELL, 'data-lb-motion')).toBe('fade');
    const opener = await openByClick(page, 1);
    await closeByEscape(page);
    expect(await opener.evaluate((el) => document.activeElement === el)).toBe(true);
  });

});

test.describe('动效 · prefers-reduced-motion（直开直关，三处入口一致）', () => {
  test.use({ reducedMotion: 'reduce' });

  test('不叫 View Transition、不给图版命名、拍摄单无位移', async ({ page }) => {
    await page.goto('/series/city-lights/');
    await watchPlateStyle(page);

    await openByClick(page);
    expect(await attr(page, SHELL, 'data-lb-motion')).toBe('instant');
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '0');

    // 布局用的 transform（按钮垂直居中）不许被顺手清掉
    const nav = await page.locator('[data-lb-next]').boundingBox();
    const stage = await page.locator(STAGE).boundingBox();
    expect(nav).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(
      Math.abs(nav!.y + nav!.height / 2 - (stage!.y + stage!.height / 2)),
      '切帧按钮没在图区垂直居中（居中用的 transform 被 reduced-motion 规则误清了）',
    ).toBeLessThan(12);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '1');
    expect(await attr(page, SHELL, 'data-lb-motion')).toBe('instant');
    await closeByEscape(page);
    expect(await attr(page, SHELL, 'data-lb-motion')).toBe('instant');

    expect(
      (await plateStyles(page)).some((s) => s.includes('view-transition-name')),
      'reduced-motion 下不该给图版命名',
    ).toBe(false);
    // 动效确实被压成瞬变（global.css 的 reduce 总开关落到灯箱自己身上）
    const sheetMs = await page
      .locator('[data-lb-sheet]')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration) * 1000);
    expect(sheetMs, '拍摄单的滑入在 reduced-motion 下仍有可感知时长').toBeLessThan(1);
    expect(await page.locator(SHELL).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  for (const entry of ENTRIES) {
    test(`${entry.name}：instant 直开到终态并直关`, async ({ page }) => {
      await page.goto(entry.path);
      await openByClick(page);
      expect(await attr(page, SHELL, 'data-lb-motion')).toBe('instant');
      await expect(page.locator(IMAGE)).toHaveCount(1);
      await closeByEscape(page);
      expect(await focusIsPlate(page)).toBe(true);
    });
  }
});

/* ============================ 三、预加载 ============================ */

test.describe('预加载相邻帧（验收：切帧不明显白屏）', () => {
  test('开在第 1 帧时，第 2 帧的展示图已被提前拉起', async ({ page }) => {
    await watchImageSrcAssignments(page);
    await page.goto('/series/city-lights/');
    const frames = await islandFrames(page, 'series-city-lights');
    expect(frames.length).toBeGreaterThan(1);

    await openByClick(page);

    expect(await assignedImageSrcs(page)).toContain(basename(frames[1].src));
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-preload', '1');
  });

  test('切到末帧后前一帧在预加载名单里，且展示图渐进替换完成', async ({ page }) => {
    await page.goto('/series/city-lights/');
    await openByClick(page);
    await page.keyboard.press('End');
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '1');
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-preload', '0');
    await waitFullImage(page);
  });
});

/* ============================ 四、移动端与手势 ============================ */

test.describe('移动端 375 · 触摸目标与手势（桌面模拟）', () => {
  test.use({ viewport: { width: 375, height: 780 }, hasTouch: true });

  test('控制按钮触摸目标 ≥ 44，灯箱不超出视口', async ({ page }) => {
    await page.goto('/series/city-lights/');
    await plates(page).first().tap();
    await expect(page.locator(SHELL)).toBeVisible();

    const box = await page.locator(SHELL).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375);

    for (const selector of ['[data-lb-prev]', '[data-lb-next]', '[data-lb-close]', '[data-lb-exif]']) {
      const target = await page.locator(selector).boundingBox();
      expect(target, `${selector} 没有盒子`).not.toBeNull();
      expect(target!.width, `${selector} 宽不足 44`).toBeGreaterThanOrEqual(44);
      expect(target!.height, `${selector} 高不足 44`).toBeGreaterThanOrEqual(44);
    }
  });

  test('左右滑切帧 + 下滑关闭（触摸型指针事件）', async ({ page }) => {
    await page.goto('/series/city-lights/');
    await plates(page).first().tap();
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '0');

    const swipe = (dx: number, dy: number) =>
      page.evaluate(([x, y]) => {
        const stage = document.querySelector('[data-lb-stage]');
        if (!stage) return false;
        const mk = (type: string, cx: number, cy: number) =>
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: 'touch',
            clientX: cx,
            clientY: cy,
          });
        stage.dispatchEvent(mk('pointerdown', 200, 300));
        stage.dispatchEvent(mk('pointerup', 200 + x, 300 + y));
        return true;
      }, [dx, dy]);

    expect(await swipe(-180, 4)).toBe(true);
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '1');
    expect(await swipe(180, 4)).toBe(true);
    await expect(page.locator(IMAGE)).toHaveAttribute('data-lb-frame', '0');

    expect(await swipe(4, 260)).toBe(true);
    await expect(page.locator(SHELL)).toBeHidden();
    expect(await focusIsPlate(page), '手势关闭后焦点没回到图版').toBe(true);
  });
});

/* ============================ 五、负向与边界 ============================ */

test.describe('不挂灯箱的页面 / 无 JS 降级', () => {
  test('空册系列与纯文字随笔：既无图版、无岛、也无外壳', async ({ page }) => {
    for (const path of ['/series/wip-empty/', '/posts/2026-07-02-alley-light/']) {
      await page.goto(path);
      await expect(page.locator('figure[data-lightbox]')).toHaveCount(0);
      await expect(page.locator(SHELL)).toHaveCount(0);
      await expect(page.locator('script.lightbox-frames')).toHaveCount(0);
    }
  });

  test('列表页 / 关于页不挂外壳', async ({ page }) => {
    for (const path of ['/series/', '/posts/', '/about/']) {
      await page.goto(path);
      await expect(page.locator(SHELL)).toHaveCount(0);
    }
  });

  test('禁用 JS：外壳保持隐藏，图版与 frames 岛仍在（内容不缺失）', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: BASE_URL });
    const page = await context.newPage();
    await page.goto('/series/city-lights/');
    await expect(page.locator('figure[data-lightbox]')).toHaveCount(SERIES_SIDECAR.length);
    await expect(page.locator('script.lightbox-frames')).toHaveCount(1);
    await expect(page.locator(SHELL)).toHaveCount(1);
    await expect(page.locator(SHELL)).toBeHidden();
    await context.close();
  });

  test('关闭后背景干净：无残留 inert / 锁标记 / 游离 <img>，且控制台全程无告警', async ({ page }) => {
    const noise: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') noise.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));

    await page.goto('/series/city-lights/');
    const plateCount = await plates(page).count();
    expect(
      await page.evaluate(() => document.querySelector('[data-lb]')?.parentElement === document.body),
      '外壳没被搬到 body 末尾（背景就无法 inert）',
    ).toBe(true);

    await openByClick(page);
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-lb-exif]').click();
    await closeByEscape(page);

    expect(
      await page.evaluate(
        () => document.querySelectorAll('.page [inert], .page [data-lb-bg], header.spine [inert]').length,
      ),
    ).toBe(0);
    expect(await page.evaluate(() => document.querySelectorAll('[data-lb-bg]').length)).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('lb-lock')),
    ).toBe(false);
    // 灯箱的帧图只活在灯箱里：关掉后页面 <img> 数量回到图版本身（§6 扫描不被污染）
    expect(await page.locator('img').count()).toBe(plateCount);
    expect(await page.locator('.lb-img').count()).toBe(0);
    expect(noise, `灯箱全程吐了告警/错误：${noise.join(' | ')}`).toEqual([]);

    await expect
      .poll(
        async () =>
          await page.evaluate(
            () => document.querySelector('figure[data-lightbox] img')?.getAttribute('style') ?? '',
          ),
        { timeout: 5_000 },
      )
      .not.toContain('view-transition-name');
  });
});
