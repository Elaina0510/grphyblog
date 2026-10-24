import { expect, test } from '@playwright/test';

import { installGitHubMock, seedToken } from './helpers/admin-mock';

// =============================================================================
// /admin 登录态（admin-v2.md E1 + 测试要求「登录态（localStorage 有/无 token 两种）」）
//
// 令牌只存活在浏览器存储里：勾「记住」→ localStorage（下次免填），不勾 → sessionStorage
// （只活在当前标签页）。这两条是文档对用户的承诺，所以必须被 e2e 钉住。
// 全程走 mock 的 Contents API，不打真实 GitHub。
// =============================================================================

const TOKEN_KEY = 'grphyblog:admin:token';

test.describe('/admin 登录', () => {
  test('没有令牌：只有登录框，三个板块不出现、不发任何写请求', async ({ page }) => {
    const mock = await installGitHubMock(page);
    await page.goto('/admin/');

    await expect(page.locator('[data-testid="login"]')).toBeVisible();
    await expect(page.locator('[data-testid="token-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav"]')).toBeHidden();
    await expect(page.locator('[data-testid="logout"]')).toBeHidden();
    // 登录框交代了仓库与分支（后台无配置文件，这两条只能由界面 + 文档承担）
    await expect(page.locator('[data-testid="login"]')).toContainText('Elaina0510/grphyblog');
    await expect(page.locator('[data-testid="login"]')).toContainText('main');
    expect(mock.puts).toHaveLength(0);
  });

  test('令牌无效（401）：停在登录框，并给出可执行的排障话术', async ({ page }) => {
    await installGitHubMock(page, { unauthorized: true });
    await seedToken(page, 'expired-token');
    await page.goto('/admin/');

    await expect(page.locator('[data-testid="login"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-error"]')).toContainText('401');
    await expect(page.locator('[data-testid="login-error"]')).toContainText('令牌无效');
    await expect(page.locator('[data-testid="nav"]')).toBeHidden();
  });

  test('粘贴令牌登录：进入照片池，出现「照片池 / 系列 / 随笔」三个板块', async ({ page }) => {
    await installGitHubMock(page);
    await page.goto('/admin/');
    await page.fill('[data-testid="token-input"]', 'e2e-token');
    await page.click('[data-testid="login-submit"]');

    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav"] button')).toHaveCount(3);
    await expect(page.locator('[data-testid="nav-photos"]')).toHaveText('照片池');
    await expect(page.locator('[data-testid="nav-series"]')).toHaveText('系列');
    await expect(page.locator('[data-testid="nav-posts"]')).toHaveText('随笔');
    // 三个板块都能点开（片段渲染不崩）
    await page.click('[data-testid="nav-series"]');
    await expect(page.locator('[data-testid="entry-list"]')).toBeVisible();
    await page.click('[data-testid="nav-posts"]');
    await expect(page.locator('[data-testid="entry-list"]')).toBeVisible();
  });

  test('勾「记住」→ 令牌进 localStorage，刷新后免登录', async ({ page }) => {
    await installGitHubMock(page);
    await page.goto('/admin/');
    await page.fill('[data-testid="token-input"]', 'e2e-token');
    await page.check('[data-testid="remember"]');
    await page.click('[data-testid="login-submit"]');
    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();

    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY)).toBe('e2e-token');
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();

    await page.reload();
    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="login"]')).toHaveCount(0);
    // 刷新不该把「记住」降级成 sessionStorage（否则换个标签页就要重填令牌）
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();

    // 新标签页（同源 localStorage 共享、sessionStorage 不共享）也要免登录
    const second = await page.context().newPage();
    await installGitHubMock(second);
    await second.goto('/admin/');
    await expect(second.locator('[data-testid="pool-grid"]')).toBeVisible();
    await second.close();
  });

  test('不勾「记住」→ 令牌只进 sessionStorage（关标签页即失效）', async ({ page }) => {
    await installGitHubMock(page);
    await page.goto('/admin/');
    await page.fill('[data-testid="token-input"]', 'e2e-token');
    await page.click('[data-testid="login-submit"]');
    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();

    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY)).toBeNull();
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TOKEN_KEY)).toBe('e2e-token');
  });

  test('退出：两个 storage 都清空，回到登录框', async ({ page }) => {
    await installGitHubMock(page);
    await seedToken(page);
    await page.goto('/admin/');
    await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();

    await page.click('[data-testid="logout"]');
    await expect(page.locator('[data-testid="login"]')).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY)).toBeNull();
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();
  });
});
