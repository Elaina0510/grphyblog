import { defineConfig } from 'vitest/config';

// 单元测试 / 集成测试层（Vitest）。E2E 由 Playwright 负责，见 playwright.config.ts。
// 目录约定：tests/unit/ 走 Vitest，tests/e2e/ 走 Playwright（此处显式排除，避免互相误跑）。
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', '.astro/**'],
    environment: 'node',
    // build 冒烟用例会真的跑一次 astro build，给足时间
    testTimeout: 300_000,
    hookTimeout: 300_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['astro.config.mjs', 'src/**/*.ts'],
      // 纯类型声明文件无可执行语句，排除掉免得把覆盖率数字拉成噪音
      exclude: ['**/*.d.ts', '.astro/**'],
      all: false,
    },
  },
});
