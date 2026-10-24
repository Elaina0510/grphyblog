import { expect, test, type Page } from '@playwright/test';

import { installGitHubMock, SERIES_MD } from './helpers/admin-mock';

// ============================================================================
// 保存反馈的可见性（回归：2026-10-24 线上反馈「点了保存一点反应都没有」）
//
// 当时的现场：状态提示被放在表单最末尾（正文编辑器之后），而保存按钮在页面顶栏。
// 表单有字段 + 78 张照片网格 + 正文编辑器，两者隔好几屏 —— 保存其实成功了
// （远端确实多出 commit），但提示在视口外，用户完全看不到，于是连点多次重复提交。
//
// 所以这里不只断言「文本里有『已保存』」（那早就成立，正是它掩盖了问题），
// 而是断言 **提示在视口内可见** + **按钮点击后立刻有忙碌态**。
// ============================================================================

async function openSeriesEditor(page: Page): Promise<void> {
  await page.goto('/admin/');
  await page.fill('[data-testid="token-input"]', 'e2e-token');
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
  await page.click('[data-testid="nav-series"]');
  await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
  await page.click('[data-testid="entry-edit"]');
  await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();
}

test.describe('保存反馈必须在视口内（不是「存在但看不见」）', () => {
  test('状态提示与保存按钮同屏：滚动到页面底部后点保存，提示仍在视口内', async ({ page }) => {
    const mock = await installGitHubMock(page);
    await openSeriesEditor(page);

    // 模拟真实操作：先把页面滚到底部（正文编辑器那儿），再滚回顶部点保存
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.click('[data-testid="save"]');
    const status = page.locator('[data-testid="status"]');
    await expect(status).toContainText('已保存');

    // 核心断言：提示必须在当前视口内（这条在修复前会失败——它当时在页底）
    await expect(status).toBeInViewport();
    expect(mock.puts.length).toBeGreaterThan(0);
  });

  test('点击保存后按钮立刻进入「保存中…」并禁用（防重复提交）', async ({ page }) => {
    await installGitHubMock(page);
    await openSeriesEditor(page);

    const save = page.locator('[data-testid="save"]');
    await expect(save).toHaveText('保存');

    // 拦一下 PUT，让它停留一会儿，好观察忙碌态
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('https://api.github.com/**', async (route) => {
      if (route.request().method() === 'PUT') await gate;
      await route.fallback();
    });

    await save.click();
    await expect(save).toHaveText('保存中…');
    await expect(save).toBeDisabled();

    release();
    await expect(page.locator('[data-testid="status"]')).toContainText('已保存');
    await expect(save).toHaveText('保存');
    await expect(save).toBeEnabled();
  });

  test('保存失败时错误也在同一位置显示（不静默失败）', async ({ page }) => {
    // 正常登录（GET 通过），只让这一篇的 PUT 返回 409（sha 不匹配 = 别人先推了）
    await installGitHubMock(page);
    await page.goto('/admin/');
    await page.fill('[data-testid="token-input"]', 'e2e-token');
    await page.click('[data-testid="login-submit"]');
    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();

    await page.click('[data-testid="nav-series"]');
    await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
    await page.click('[data-testid="entry-edit"]');
    await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();

    // 后注册的 route 优先：只拦 PUT，GET 继续走 mock
    await page.route(`**/contents/${SERIES_MD}`, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'sha does not match' }),
        });
        return;
      }
      await route.fallback();
    });

    await page.click('[data-testid="save"]');
    const status = page.locator('[data-testid="status"]');
    await expect(status).toHaveClass(/error/);
    await expect(status).toBeInViewport();
    // 失败后按钮必须恢复可用，否则用户改完也存不了
    await expect(page.locator('[data-testid="save"]')).toBeEnabled();
    await expect(page.locator('[data-testid="save"]')).toHaveText('保存');
  });
});
