import { expect, test } from '@playwright/test';

import { installGitHubMock, realSidecar, seedToken, sidecarWithPending } from './helpers/admin-mock';

// =============================================================================
// E3 · 照片池页（admin-v2.md「池页：缩略图网格（800px thumb）+ 上传入口」）
//
// 断言点：
//   ① 网格条数 = 全局 sidecar 条数（78），不是「目录里有多少文件」；
//   ② 每张缩略图都指向池内 `*.thumb.webp` 的原始地址（后台预览口径）；
//   ③ 浏览器直传产物（EXIF 全空）在池里显示「EXIF 待补」角标，其余照片没有；
//   ④ 双上传通道的提示在场：直传 input + 本地 `npm run import -- --pool`。
// =============================================================================

const POOL = realSidecar();

test.beforeEach(async ({ page }) => {
  await installGitHubMock(page);
  await seedToken(page);
  await page.goto('/admin/');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
});

test.describe('E3 照片池', () => {
  test('缩略图网格按 sidecar 渲染，张数口径正确', async ({ page }) => {
    await expect(page.locator('[data-testid="pool-tile"]')).toHaveCount(POOL.length);
    await expect(page.locator('[data-testid="pool-count"]')).toContainText(`${POOL.length} 张`);
    await expect(page.locator('[data-testid="pool-count"]')).toContainText('src/content/pool/photos/');
    // 每张 tile 都带照片 ID（= 池内完整文件名含 .webp）
    const ids = await page
      .locator('[data-testid="pool-tile"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-photo-id') ?? ''));
    expect(ids[0]).toMatch(/\.webp$/);
    expect(new Set(ids).size).toBe(POOL.length);
  });

  test('缩略图走 800px 缩略图（*.thumb.webp）的仓库原始地址', async ({ page }) => {
    const srcs = await page
      .locator('[data-testid="pool-tile"] img')
      .evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.getAttribute('src') ?? ''));
    expect(srcs).toHaveLength(5);
    for (const src of srcs) {
      expect(src).toContain('https://raw.githubusercontent.com/Elaina0510/grphyblog/main/src/content/pool/photos/');
      expect(src).toMatch(/\.thumb\.webp$/);
    }
    // 缩略图是懒加载的（156 个文件一起请求会把后台拖死）
    const loading = await page.locator('[data-testid="pool-tile"] img').first().getAttribute('loading');
    expect(loading).toBe('lazy');
  });

  test('「EXIF 待补」角标只出现在浏览器直传产物上', async ({ page }) => {
    await expect(page.locator('[data-testid="exif-pending"]')).toHaveCount(1);
    const pending = sidecarWithPending();
    const target = pending[pending.length - 1].file as string;
    const id = target.split('/').pop();
    const tile = page.locator(`[data-testid="pool-tile"][data-photo-id="${id}"]`);
    await expect(tile.locator('[data-testid="exif-pending"]')).toHaveText('EXIF 待补');
    // 其余照片没有这个角标
    await expect(page.locator('[data-testid="pool-tile"]').first().locator('[data-testid="exif-pending"]')).toHaveCount(0);
  });

  test('上传入口：浏览器直传 + 本地 import 命令提示（双通道）', async ({ page }) => {
    await expect(page.locator('[data-testid="upload-input"]')).toHaveCount(1);
    const accept = await page.locator('[data-testid="upload-input"]').getAttribute('accept');
    expect(accept).toBe('image/*');
    await expect(page.locator('[data-testid="upload-hint"]')).toContainText('2560px WebP');
    await expect(page.locator('[data-testid="upload-hint"]')).toContainText('EXIF');
    // 本地通道的命令必须写得能直接复制执行
    await expect(page.locator('code', { hasText: 'npm run import -- --pool' })).toBeVisible();
  });

  test('预览取不到时退成占位块（不留破图标）', async ({ page }) => {
    await page.unroute('https://raw.githubusercontent.com/**');
    await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, body: 'nope' }));
    await page.reload();
    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="thumb-broken"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="thumb-broken"]').first()).toContainText('预览不可用');
  });
});
