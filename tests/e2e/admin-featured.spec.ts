import { expect, test } from '@playwright/test';

import { installGitHubMock, seedToken } from './helpers/admin-mock';

// =============================================================================
// /admin 首页精选帧板块（第四板块）：挑帧 / 编辑标题说明 / 保真写回 site.json
//
// 全程走 mock 的 Contents API（含真 site.json），不打真实 GitHub。
// 重点钉住两件事：
//   ① 保存只改 featured.photos —— 导航 / 版权页 / $comments 等站点事实不被冲掉；
//   ② 每条严格 {photo,title,alt} 三键，与 tests/unit/site-data.test.ts 同口径。
// =============================================================================

async function gotoFeatured(page: import('@playwright/test').Page) {
  await page.goto('/admin/');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
  await page.click('[data-testid="nav-featured"]');
  await expect(page.locator('[data-testid="featured-list"]')).toBeVisible();
}

test.describe('/admin 精选帧', () => {
  test('进入板块：读到 site.json 的精选帧，逐条可编辑', async ({ page }) => {
    await installGitHubMock(page);
    await seedToken(page);
    await gotoFeatured(page);

    const items = page.locator('[data-testid="featured-item"]');
    expect(await items.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="featured-title"]').first()).not.toHaveValue('');
    await expect(page.locator('[data-testid="featured-alt"]').first()).not.toHaveValue('');
    // 照片池网格可展开挑帧
    await page.click('[data-testid="featured-picker-toggle"]');
    await expect(page.locator('[data-testid="featured-pick-tile"]').first()).toBeVisible();
  });

  test('挑一帧 → 改标题说明 → 保存：PUT 到 site.json 且只改 featured.photos', async ({ page }) => {
    const mock = await installGitHubMock(page);
    await seedToken(page);
    await gotoFeatured(page);

    // 已有帧的标题改掉
    const firstTitle = page.locator('[data-testid="featured-title"]').first();
    await firstTitle.fill('新标题');

    // 从池里挑一张还没被选的图
    await page.click('[data-testid="featured-picker-toggle"]');
    const allTiles = page.locator('[data-testid="featured-pick-tile"]');
    const pickedIds = await page.locator('[data-testid="featured-item"] .mono').allTextContents();
    let pickId = '';
    const count = await allTiles.count();
    for (let i = 0; i < count; i += 1) {
      const id = (await allTiles.nth(i).getAttribute('data-photo-id')) ?? '';
      if (!pickedIds.some((p) => p.includes(id))) {
        pickId = id;
        await allTiles.nth(i).click();
        break;
      }
    }
    expect(pickId, '池里应有一张未被选中的图').not.toBe('');

    // 给新帧填标题和说明（新帧默认用文件名兜底，本就非空；这里显式改一遍）
    const titles = page.locator('[data-testid="featured-title"]');
    const alts = page.locator('[data-testid="featured-alt"]');
    await titles.last().fill('挑帧标题');
    await alts.last().fill('挑帧说明');

    await page.click('[data-testid="featured-save"]');
    await expect(page.locator('[data-testid="featured-status"]')).toContainText('已保存');

    // 找到写 site.json 的那次 PUT
    const sitePut = mock.puts.find((p) => p.path === 'src/data/site.json');
    expect(sitePut, '应有一次 PUT 到 site.json').toBeDefined();
    const written = JSON.parse(sitePut!.text);
    expect(Array.isArray(written.featured.photos)).toBe(true);
    expect(written.featured.photos.some((f: { photo: string }) => f.photo === pickId)).toBe(true);
    for (const frame of written.featured.photos) {
      expect(Object.keys(frame).sort()).toEqual(['alt', 'photo', 'title']);
    }
    // 站点事实保真：导航四项、版权页、$comments 还在
    expect(written.nav).toHaveLength(4);
    expect(written.colophon.length).toBeGreaterThanOrEqual(4);
    expect(written.$comments).toBeDefined();
    expect(written.$comments.featured).toBeDefined();
  });

  test('校验：清空标题后保存被挡下，不发写请求', async ({ page }) => {
    const mock = await installGitHubMock(page);
    await seedToken(page);
    await gotoFeatured(page);

    await page.locator('[data-testid="featured-title"]').first().fill('');
    mock.reset();
    await page.click('[data-testid="featured-save"]');
    await expect(page.locator('[data-testid="featured-status"]')).toContainText('缺标题');
    expect(mock.puts).toHaveLength(0);
  });
});
