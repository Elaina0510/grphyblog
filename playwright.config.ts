import { defineConfig, devices } from '@playwright/test';

// E2E 层（Playwright）：起 `astro preview` 预览真实构建产物，再打 HTTP 断言。
// 本模块只放最小冒烟用例；灯箱/切图完整 E2E 属后续 lightbox 模块。
const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 先构建再 preview，保证 E2E 打的是上线同源的静态产物
    command: `npm run build && npm run preview -- --port ${PORT} --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
