import { expect, test, type Page } from '@playwright/test';

import { installGitHubMock, seedToken, SERIES_MD, type MockHandle } from './helpers/admin-mock';

// =============================================================================
// 2026-10-24 用户用过后台之后提的四条改进（都是「用过才发现」的 UI 问题）：
//   ① 系列只能新建，删不掉  → 顶栏「删除」+ 内联二次确认，只删 .md 不删照片；
//   ② 选封面没有缩略图      → 缩略图按钮条，替代只有文字的下拉；
//   ③ 「系列标识」那一行没用 → 已存在条目不渲染该行，新建时才显示；
//   ④ 照片池默认全展开      → 默认收起，「＋ 选择照片」才展开。
//
// 每条都按「用户会怎么误用」来测：③④ 是「不该出现在那里」，①② 是「必须真的做完」。
// =============================================================================

let mock: MockHandle;

test.beforeEach(async ({ page }) => {
  mock = await installGitHubMock(page);
  await seedToken(page);
  await page.goto('/admin/');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
});

async function openSeriesEditor(page: Page): Promise<void> {
  await page.click('[data-testid="nav-series"]');
  await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
  await page.click('[data-testid="entry-edit"]');
  await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();
}

test.describe('① 删除条目', () => {
  test('两步确认：第一次点只警告不删，第二次才真删', async ({ page }) => {
    await openSeriesEditor(page);
    const del = page.locator('[data-testid="delete"]');
    const status = page.locator('[data-testid="status"]');

    await del.click();
    // 第一次：按钮变「确认删除」，顶栏给出说明，且**没有发 DELETE**
    await expect(del).toHaveText('确认删除');
    await expect(del).toHaveClass(/armed/);
    await expect(status).toContainText('再点一次');
    await expect(status).toBeInViewport();
    expect(mock.deletes.length).toBe(0);

    await del.click();
    await expect(status).toContainText('已删除');
    expect(mock.deletes.length).toBe(1);
    // 删的是这一篇，且带 sha（GitHub DELETE 必须带，否则 422）
    expect(mock.deletes[0].path).toBe(SERIES_MD);
    expect(mock.deletes[0].body.sha).toBeTruthy();
    expect(String(mock.deletes[0].body.message)).toContain('删除系列');
    // 删完回到列表，且被删的那一行不在了
    // （mock 里只剩 daily-frames，它是 404 跳过的，所以列表可能为空 —— 断言列表视图本身即可）
    await expect(page.locator('[data-testid="edit-view"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="entry-list"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="entry-row"][data-path="src/content/series/city-lights/index.md"]'),
    ).toHaveCount(0);
  });

  test('只删 md，绝不碰照片（池是共享的，同一张图可能被多条引用）', async ({ page }) => {
    await openSeriesEditor(page);
    await page.click('[data-testid="delete"]');
    await page.click('[data-testid="delete"]');

    await expect(page.locator('[data-testid="status"]')).toContainText('已删除');
    // 整个过程中除了 DELETE 那一篇 md，不应有任何对 pool/ 的删除或写入
    const touchedPool = [...mock.deletes, ...mock.puts].filter((row) =>
      row.path.includes('src/content/pool/'),
    );
    expect(touchedPool, '删条目不该动照片池').toEqual([]);
  });

  test('提交信息用「删除系列」，不是「更新」（否则历史里看不出删了什么）', async ({ page }) => {
    await openSeriesEditor(page);
    await page.click('[data-testid="delete"]');
    await page.click('[data-testid="delete"]');
    await expect(page.locator('[data-testid="status"]')).toContainText('已删除');

    const message = String(mock.deletes[0].body.message);
    expect(message).toMatch(/^content\(series\): 删除系列「.+」$/);
    expect(message).not.toContain('更新');
  });

  test('新建条目没有删除按钮（还没存过，删什么）', async ({ page }) => {
    await page.click('[data-testid="nav-series"]');
    await page.click('[data-testid="new-entry"]');
    await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="delete"]')).toHaveCount(0);
    // 新建也不给标识框了：路径由标题派生
    await expect(page.locator('[data-testid="slug"]')).toHaveCount(0);
  });
});

test.describe('② 封面带缩略图', () => {
  test('每个候选都带一张图，不是只有文件名', async ({ page }) => {
    await openSeriesEditor(page);
    const options = page.locator('[data-testid="cover-option"]');
    // 2 张已勾选 + 1 个「不指定」
    await expect(options).toHaveCount(3);

    const withThumb = page.locator('[data-testid="cover-option"] img.cover-thumb');
    await expect(withThumb).toHaveCount(2);
    // 缩略图真的加载出来了（不是破图占位）
    const naturalWidths = await withThumb.evaluateAll((imgs) =>
      imgs.map((img) => (img as HTMLImageElement).naturalWidth),
    );
    expect(naturalWidths.every((w) => w > 0)).toBe(true);
  });

  test('点缩略图即选中，选中态唯一', async ({ page }) => {
    await openSeriesEditor(page);
    await page.click('[data-testid="cover-option"][data-photo-id="night-01.webp"]');
    await expect(page.locator('[data-testid="cover-option"].selected')).toHaveCount(1);
    await expect(page.locator('[data-testid="cover-option"].selected')).toHaveAttribute(
      'data-photo-id',
      'night-01.webp',
    );

    await page.click('[data-testid="cover-option"][data-photo-id="night-02.webp"]');
    await expect(page.locator('[data-testid="cover-option"].selected')).toHaveCount(1);
    await expect(page.locator('[data-testid="cover-option"].selected')).toHaveAttribute(
      'data-photo-id',
      'night-02.webp',
    );
  });

  test('取消勾一张照片后，它从封面候选里消失（封面不能指向不在 photos 里的图）', async ({ page }) => {
    await openSeriesEditor(page);
    await expect(
      page.locator('[data-testid="cover-option"][data-photo-id="night-01.webp"]'),
    ).toHaveCount(1);

    await page.click('[data-testid="picker-toggle"]');
    await page.click('[data-testid="pick-tile"][data-photo-id="night-01.webp"]');

    await expect(
      page.locator('[data-testid="cover-option"][data-photo-id="night-01.webp"]'),
    ).toHaveCount(0);
  });
});

test.describe('③ 系列标识行', () => {
  test('编辑已有条目：整行消失（不是禁用框）', async ({ page }) => {
    await openSeriesEditor(page);
    await expect(page.locator('[data-testid="slug"]')).toHaveCount(0);
    // 也不能以文字形式残留在标签里
    await expect(page.locator('[data-testid="edit-view"]')).not.toContainText('系列标识');
  });

  test('新建条目：不给标识框，中文标题直接派生目录名', async ({ page }) => {
    await page.click('[data-testid="nav-series"]');
    await page.click('[data-testid="new-entry"]');
    await expect(page.locator('[data-testid="slug"]')).toHaveCount(0);

    // 边打标题边能看到将来的路径（用户能提前发现 URL 长什么样）
    await page.fill('[data-field="title"]', '霓虹夜市');
    await expect(page.locator('[data-testid="entry-path"]')).toHaveText(
      'src/content/series/霓虹夜市/index.md',
    );

    await page.fill('[data-field="date"]', '2026-10-24');
    await page.click('[data-testid="save"]');
    await expect(page.locator('[data-testid="status"]')).toContainText('已保存');
    expect(
      mock.puts.some((row) => row.path === 'src/content/series/霓虹夜市/index.md'),
    ).toBe(true);
  });

  test('标题里的标点不会进路径（防 a/b 这类路径注入）', async ({ page }) => {
    await page.click('[data-testid="nav-series"]');
    await page.click('[data-testid="new-entry"]');
    await page.fill('[data-field="title"]', '夜光 · 城市 / 测试');
    await expect(page.locator('[data-testid="entry-path"]')).toHaveText(
      'src/content/series/夜光-城市-测试/index.md',
    );
  });
});

test.describe('④ 照片网格默认收起', () => {
  test('打开编辑页时网格不可见，但「＋ 选择照片」在', async ({ page }) => {
    await openSeriesEditor(page);
    const toggle = page.locator('[data-testid="picker-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-testid="photo-picker"]')).toBeHidden();
    // 已选的照片（order 条）仍然直接可见，收起的只是「从池里挑」的网格
    await expect(page.locator('[data-testid="order-item"]')).toHaveCount(2);
  });

  test('点开能勾，再点收起；展开状态在按钮上可读', async ({ page }) => {
    await openSeriesEditor(page);
    const toggle = page.locator('[data-testid="picker-toggle"]');
    await toggle.click();
    await expect(page.locator('[data-testid="photo-picker"]')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid="pick-tile"]')).toHaveCount(78);

    await page.click('[data-testid="pick-tile"][data-photo-id="P1100451.webp"]');
    await expect(page.locator('[data-testid="order-item"]')).toHaveCount(3);

    await toggle.click();
    await expect(page.locator('[data-testid="photo-picker"]')).toBeHidden();
    // 收起不影响已选
    await expect(page.locator('[data-testid="order-item"]')).toHaveCount(3);
  });

  test('收起后表单明显变短（这就是用户要的效果）', async ({ page }) => {
    await openSeriesEditor(page);
    const collapsed = await page.evaluate(() => document.body.scrollHeight);
    await page.click('[data-testid="picker-toggle"]');
    await expect(page.locator('[data-testid="pick-tile"]')).toHaveCount(78);
    const expanded = await page.evaluate(() => document.body.scrollHeight);
    expect(expanded).toBeGreaterThan(collapsed + 200);
  });
});
