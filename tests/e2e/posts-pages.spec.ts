import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// =============================================================================
// posts-pages §4.2 随笔页集成测（打 astro build + preview 的真实静态产物）
//
//   列表  —— /posts/ 行式目次按日期倒序；draft「雾起的那个早上」整篇不外泄。
//   详情  —— /posts/<slug>/ 可访问；标题 + 日期 + 正文齐备，正文按段落渲染。
//   管线  —— 种子正文里那句 `![说明](<资源夹>/photos/dawn-01.webp)` 在产物里必须：
//            src = /_astro/…webp（**不是** photos/ 相对路径、**不是** /data:）+
//            显式 width/height = sidecar 展示图真值 + 被包成灯箱图版。
//   契约  —— script.lightbox-frames[data-gallery="post-<slug>"] 岛：frames 数 == 正文引用的
//            插图数（同图重复引用不重复占帧）、字段齐、data-lightbox-index 连续 0..n-1。
//   无图  —— 纯文字随笔（alley-light）不产出灯箱岛，也不伪造图版。
//   draft —— /posts/2026-08-10-foggy-morning/ 返回 404（getStaticPaths 只遍历已发布 → 天然 404）。
//   移动  —— 375 详情与列表无横向溢出。
//
// 纯函数层的口径（占位属性、缺 sidecar 不伪造、去重、帧序）在
// tests/unit/post-illustrations.test.ts 里钉；本文件只打真产物。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SLUG = '2026-09-21-morning-fog';
const GALLERY = `post-${SLUG}`;

const sidecarOf = (slug: string) =>
  JSON.parse(
    readFileSync(resolve(ROOT, `src/content/posts/${slug}/photos.meta.json`), 'utf8'),
  ) as Array<{ file: string; thumb: string; width: number; height: number }>;

/** 某篇随笔正文引用的内联插图（去重后的文件名 = 应占的灯箱帧数）。 */
function bodyImageRefs(slug: string): string[] {
  const md = readFileSync(resolve(ROOT, `src/content/posts/${slug}.md`), 'utf8');
  const body = md.replace(/^---[\s\S]*?---/, '');
  const refs = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)]
    .map((m) => (m[1].split('/').pop() ?? '').trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

async function readIsland(page: import('@playwright/test').Page, gallery: string) {
  return page.$eval(`script.lightbox-frames[data-gallery="${gallery}"]`, (el) =>
    JSON.parse(el.textContent ?? '') as {
      frames: Array<{
        src: string;
        thumb: string;
        width: number;
        height: number;
        alt: string;
        title?: string;
        exif: Record<string, unknown>;
      }>;
    },
  );
}

test.describe('随笔列表 /posts/ · 时间倒序 + 排 draft', () => {
  test('行式目次按日期倒序，草稿既无路径也无题名', async ({ page }) => {
    await page.goto('/posts/');
    await expect(page.locator('ol.toc')).toHaveCount(1);

    const hrefs = await page.$$eval('ol.toc a.toc-row', (els) =>
      els.map((e) => e.getAttribute('href') ?? ''),
    );
    // 种子事实：2026-09-21 与 2026-07-02 两篇已发布 → 新的在前；草稿那篇（2026-08-10）不在列
    expect(hrefs).toEqual([`/posts/${SLUG}/`, '/posts/2026-07-02-alley-light/']);

    const first = page.locator('ol.toc a.toc-row').first();
    await expect(first.locator('.name')).toContainText('晨雾');
    await expect(first.locator('.meta')).toContainText('2026.09.21');

    const html = await page.content();
    expect(html).not.toContain('2026-08-10-foggy-morning');
    expect(html).not.toContain('雾起的那个早上');
  });

  test('书脊导航当前项落在「随笔」（与系列列表在书脊里并列）', async ({ page }) => {
    await page.goto('/posts/');
    await expect(page.locator('.spine-nav a[aria-current="page"]')).toHaveText('随笔');
    await expect(page.locator('.spine-nav a[href="/series/"]')).toHaveCount(1);
  });
});

test.describe('随笔详情 · 结构与正文', () => {
  test('标题 + 日期 + 正文齐备，Prose 口径为思源黑体 16.5 / 1.9 / 受 --measure 约束', async ({
    page,
  }) => {
    await page.goto(`/posts/${SLUG}/`);
    await expect(page.locator('h1.post-title')).toHaveText('晨雾里的第一束光');
    await expect(page.locator('.chapter-sub')).toContainText('2026.09.21');

    const body = page.locator('article.post-body');
    await expect(body).toHaveCount(1);
    const text = await body.innerText();
    expect(text).toContain('记录性质的一篇');
    expect(text).toContain('雾散之后就没东西可拍了');

    const prose = await body.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, leading: cs.lineHeight, family: cs.fontFamily, max: cs.maxWidth };
    });
    expect(prose.size).toBe('16.5px');
    expect(parseFloat(prose.leading) / parseFloat(prose.size)).toBeCloseTo(1.9, 1);
    expect(prose.family).toContain('Noto Sans SC');
    expect(prose.max).not.toBe('none');
  });

  test('图版插在正文段落之间（文字为主、插图为辅，不是另起照片流）', async ({ page }) => {
    await page.goto(`/posts/${SLUG}/`);
    const kinds = await page.$$eval('article.post-body > *', (els) =>
      els.map((e) => (e.matches('figure.plate') ? 'plate' : e.tagName.toLowerCase())),
    );
    expect(kinds.filter((k) => k === 'plate')).toHaveLength(1);
    const firstPlate = kinds.indexOf('plate');
    expect(firstPlate).toBeGreaterThan(0); // 前面有正文
    expect(kinds.length).toBeGreaterThan(firstPlate + 1); // 后面还有正文
  });
});

test.describe('正文内联插图管线（任务 4 端到端）', () => {
  test('插图 src = /_astro/…webp（非 photos/ 相对路径、非 /data:）+ sidecar 真宽高', async ({
    page,
  }) => {
    await page.goto(`/posts/${SLUG}/`);
    expect(bodyImageRefs(SLUG).length, '种子正文里应至少有一张内联插图').toBeGreaterThanOrEqual(1);

    const img = page.locator('article.post-body figure.plate img').first();
    await expect(img).toHaveCount(1);
    const attrs = await img.evaluate((el) => ({
      src: el.getAttribute('src') ?? '',
      width: el.getAttribute('width') ?? '',
      height: el.getAttribute('height') ?? '',
      alt: el.getAttribute('alt') ?? '',
      loading: el.getAttribute('loading') ?? '',
    }));

    expect(attrs.src, '插图 src 未走构建期解析').toMatch(/^\/_astro\/.+\.webp$/);
    expect(attrs.src).not.toContain('photos/');
    expect(attrs.src, 'imageUrl 误加斜杠成 /data: 的回归').not.toMatch(/^\/(?:data|blob):/);
    expect(attrs.alt.length, '缺 alt').toBeGreaterThan(0);
    expect(attrs.loading, '§6 正文插图全懒加载').toBe('lazy');

    // 显式宽高 = sidecar 展示图真值（不估算、不写死、不为 0）
    const sidecar = sidecarOf(SLUG);
    const sc = sidecar.find((e) => attrs.src.includes(e.file.split('/').pop()!.replace('.webp', '')));
    expect(sc, '产物里的插图对不上 sidecar').toBeTruthy();
    expect(Number(attrs.width)).toBe(sc!.width);
    expect(Number(attrs.height)).toBe(sc!.height);

    // 浏览器真把它加载出来了：渲染比例 == 声明比例（显式宽高防抖的实测口径）
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const ratio = await img.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 ? box.width / box.height : 0;
    });
    expect(ratio).toBeCloseTo(sc!.width / sc!.height, 1);

    // 产物里不得残留构建期占位属性 / 未解析相对路径 / 切分留下的空段落
    const html = await page.content();
    expect(html).not.toContain('__ASTRO_IMAGE_');
    expect(html).not.toMatch(/<p[^>]*>\s*<\/p>/);
    const bodySrcs = await page.$$eval('article.post-body img', (els) =>
      els.map((e) => e.getAttribute('src') ?? ''),
    );
    for (const s of bodySrcs) expect(s, '正文里还有未解析的图片路径').toMatch(/^\/_astro\/.+\.webp$/);
  });

  test('灯箱契约：图版 data-* 接线 + frames 岛数==正文引用插图数 + 索引连续', async ({ page }) => {
    await page.goto(`/posts/${SLUG}/`);
    const refs = bodyImageRefs(SLUG);
    const sidecar = sidecarOf(SLUG);

    const plates = page.locator('figure.plate[data-lightbox]');
    await expect(plates).toHaveCount(refs.length);

    const wired = await plates.evaluateAll((els) =>
      els.map((e) => ({
        lightbox: e.getAttribute('data-lightbox'),
        gallery: e.getAttribute('data-lightbox-gallery'),
        index: Number(e.getAttribute('data-lightbox-index')),
        frame: e.getAttribute('data-frame'),
      })),
    );
    for (const w of wired) {
      expect(w.lightbox).toBe('true');
      expect(w.gallery).toBe(GALLERY);
      expect(w.frame).toBe(String(w.index));
    }
    expect(
      wired
        .map((w) => w.index)
        .sort((a, b) => a - b),
      'data-lightbox-index 必须连续 0..n-1',
    ).toEqual(refs.map((_, i) => i));

    await expect(page.locator(`script.lightbox-frames[data-gallery="${GALLERY}"]`)).toHaveCount(1);
    const island = await readIsland(page, GALLERY);
    expect(island.frames.length, 'frames 数与正文引用插图数不一致').toBe(refs.length);
    island.frames.forEach((f, i) => {
      expect(f.src, `帧 ${i} src 未解析`).toMatch(/^\/_astro\/.+\.webp$/);
      expect(f.thumb, `帧 ${i} thumb 未解析`).toMatch(/^(\/_astro\/.+\.webp|https?:)/);
      expect(f.thumb).not.toMatch(/^\/(?:data|blob):/);
      expect(f.alt.length, `帧 ${i} 缺 alt`).toBeGreaterThan(0);
      expect(typeof f.exif, `帧 ${i} 缺 exif`).toBe('object');
      expect(f.title, `帧 ${i} 缺 title`).toBeTruthy();
      const sc = sidecar.find((e) => f.src.includes(e.file.split('/').pop()!.replace('.webp', '')));
      expect(sc, `帧 ${i} 对不上 sidecar`).toBeTruthy();
      expect(f.width).toBe(sc!.width);
      expect(f.height).toBe(sc!.height);
    });

    // 岛里的帧与页面上的图版一一对应（同一批 URL：不重复、不遗漏）
    const plateSrcs = (
      await page.$$eval('figure.plate[data-lightbox] img', (els) =>
        els.map((e) => e.getAttribute('src') ?? ''),
      )
    ).sort();
    expect(plateSrcs).toEqual(island.frames.map((f) => f.src).sort());
  });

  test('拍摄单随插图图版出现：字段出自 sidecar，真数据不挂 ※示例', async ({ page }) => {
    await page.goto(`/posts/${SLUG}/`);
    const card = page.locator('figure.plate figcaption.shotcard').first();
    await expect(card).toHaveCount(1);
    const text = await card.innerText();
    expect(text).toContain('Sony A7 IV');
    expect(text).toContain('f/1.8');
    expect(text).toContain('2026.09.21');
    expect(text).not.toContain('※');
  });
});

test.describe('纯文字随笔与 draft 404', () => {
  test('无插图的随笔：正文照常出，但不产灯箱岛也不伪造图版', async ({ page }) => {
    await page.goto('/posts/2026-07-02-alley-light/');
    await expect(page.locator('h1.post-title')).toHaveText('巷子里的光比街上早');
    await expect(page.locator('figure.plate')).toHaveCount(0);
    await expect(page.locator('script.lightbox-frames')).toHaveCount(0);
    expect(await page.locator('article.post-body').innerText()).toContain('巷子窄');
  });

  test('draft 随笔 2026-08-10-foggy-morning 路由不生成 → 404', async ({ page }) => {
    const resp = await page.goto('/posts/2026-08-10-foggy-morning/');
    expect(resp?.status()).toBe(404);
  });
});

test.describe('移动端 375 可读（长文 + 插图）', () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test('详情：无横向溢出、正文与图版同列、图版不撑破视口', async ({ page }) => {
    await page.goto(`/posts/${SLUG}/`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const cols = await page
      .locator('.essay')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(cols, '窄屏随笔栏应归单列').not.toContain(' ');

    const plate = page.locator('figure.plate').first();
    const box = await plate.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, mb: getComputedStyle(el as HTMLElement).marginBottom };
    });
    expect(box.w).toBeLessThanOrEqual(375);
    expect(parseFloat(box.mb), '图文间距须有 token 节奏留白').toBeGreaterThan(0);
  });

  test('列表：无横向溢出，目次行仍可读', async ({ page }) => {
    await page.goto('/posts/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('ol.toc a.toc-row').first().locator('.name')).toHaveCount(1);
  });
});
