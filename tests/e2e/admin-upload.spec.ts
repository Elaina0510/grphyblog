import { expect, test } from '@playwright/test';
import sharp from 'sharp';

import { installGitHubMock, seedToken, type MockHandle } from './helpers/admin-mock';

// =============================================================================
// E6 · 浏览器直传（Canvas 压 2560px WebP + 追加 sidecar + exifIncomplete 角标）
//
// 这条链路只有浏览器里才跑得到（Canvas 编码），所以单测只能覆盖「缩放计划」与
// 「sidecar 条目形状」，真正的落地必须在这里验：
//   ① 选一张 3000×2000 的图 → 产物必须是 2560×1707（长边 2560，不放大）；
//   ② 缩略图通道 800×533（从原图直接采样）；
//   ③ 三次 PUT：展示版、缩略图、sidecar —— 顺序上先图后册（构建期 R3/R4 都过得去）；
//   ④ sidecar 新条目 EXIF 全空 + exifIncomplete（前台 EXIF 卡显示「EXIF 待补」）；
//   ⑤ 池页立刻多出一张、并带「EXIF 待补」角标。
//
// 图片用 sharp 现场生成（不往仓库塞夹具图），PUT 全部被 mock 拦下，不写真实 GitHub。
// =============================================================================

let mock: MockHandle;

test.beforeEach(async ({ page }) => {
  mock = await installGitHubMock(page);
  await seedToken(page);
  await page.goto('/admin/');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
});

test.describe('E6 浏览器直传', () => {
  test('3000×2000 的图 → 2560 展示版 + 800 缩略图 + sidecar 登记（EXIF 待补）', async ({ page }) => {
    expect(mock.puts).toHaveLength(0);
    const before = await page.locator('[data-testid="pool-tile"]').count();

    const png = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 96, g: 72, b: 58 } },
    })
      .png()
      .toBuffer();

    await page.setInputFiles('[data-testid="upload-input"]', {
      name: 'big-shot.png',
      mimeType: 'image/png',
      buffer: png,
    });

    await expect(page.locator('[data-testid="upload-status"]')).toContainText('已直传 1 张', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="pool-tile"]')).toHaveCount(before + 1);

    // 三次 PUT：展示版 → 缩略图 → sidecar（先图后册）
    expect(mock.puts).toHaveLength(3);
    const [display, thumb, sidecarPut] = mock.puts;
    expect(display.path).toMatch(/^src\/content\/pool\/photos\/web-\d{8}-\d{6}-[0-9a-f]{4}\.webp$/);
    expect(thumb.path).toBe(display.path.replace(/\.webp$/, '.thumb.webp'));
    expect(sidecarPut.path).toBe('src/content/pool/photos.meta.json');
    // 展示版真的是一张 WebP（不是把原 PNG 塞进去）
    expect(display.bytes).toBeGreaterThan(1000);
    expect(display.body.branch).toBe('main');

    const sidecar = JSON.parse(sidecarPut.text) as Array<Record<string, unknown>>;
    const added = sidecar[sidecar.length - 1] as {
      file: string;
      thumb: string;
      width: number;
      height: number;
      thumbWidth: number;
      thumbHeight: number;
      exifIncomplete: boolean;
      exif: Record<string, unknown>;
    };
    expect(added.file).toBe(`photos/${display.path.split('/').pop()}`);
    expect(added.thumb).toBe(`photos/${thumb.path.split('/').pop()}`);
    // 宽高取自 Canvas 产物的真实尺寸，不是按常量推算
    expect(added.width).toBe(2560);
    expect(added.height).toBe(1707);
    expect(added.thumbWidth).toBe(800);
    expect(added.thumbHeight).toBe(533);
    // EXIF 全空 + 待补标记（含 exif 内的渲染镜像）
    expect(added.exifIncomplete).toBe(true);
    expect(added.exif.exifIncomplete).toBe(true);
    for (const key of ['camera', 'lens', 'focalLength', 'aperture', 'shutter', 'iso', 'dateTaken']) {
      expect(added.exif[key], `${key} 不该有值`).toBeNull();
    }
    // 原有 78 条一条不少（追加，不是覆盖）
    expect(sidecar).toHaveLength(before + 1);

    // 池页上这张新图带「EXIF 待补」角标（原有那条演示用标记 + 这张 = 2）
    const tile = page.locator('[data-testid="pool-tile"]').last();
    await expect(tile.locator('[data-testid="exif-pending"]')).toHaveText('EXIF 待补');
  });

  test('小图不放大：600×400 原样进池（长边已小于 2560）', async ({ page }) => {
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: { r: 30, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();

    await page.setInputFiles('[data-testid="upload-input"]', {
      name: 'small-shot.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(page.locator('[data-testid="upload-status"]')).toContainText('已直传 1 张', {
      timeout: 30_000,
    });

    const sidecarPut = mock.puts.find((row) => row.path === 'src/content/pool/photos.meta.json');
    expect(sidecarPut).toBeTruthy();
    const sidecar = JSON.parse(sidecarPut!.text) as Array<Record<string, number>>;
    const added = sidecar[sidecar.length - 1];
    expect(added.width).toBe(600);
    expect(added.height).toBe(400);
  });
});
