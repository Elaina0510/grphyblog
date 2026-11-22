import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
await page.goto('http://localhost:4399/series/street-notes/');
await page.waitForTimeout(1200);

for (const [i, name] of [[1, 'm-p2'], [2, 'm-p3']]) {
  await page.locator('[data-album-next]').click();
  await page.waitForTimeout(1100);
  const info = await page.evaluate(() => {
    const fig = document.querySelector('[data-page="plate"][data-state="active"]') ||
      document.querySelector('[data-album-spread][data-state="active"] .album-plate');
    const img = fig ? fig.querySelector('img') : null;
    const r = img ? img.getBoundingClientRect() : null;
    const cur = document.querySelector('[data-album]');
    return {
      index: cur?.getAttribute('data-index'),
      img: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `D:/hermeswork/shots/${name}.png` });
}
await browser.close();
