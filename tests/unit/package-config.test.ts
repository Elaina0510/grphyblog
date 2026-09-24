import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

describe('package.json · 脚本登记（task 6）', () => {
  it('dev / build / preview 指向 astro 原生命令', () => {
    expect(pkg.scripts.dev).toBe('astro dev');
    expect(pkg.scripts.build).toBe('astro build');
    expect(pkg.scripts.preview).toBe('astro preview');
  });

  it('预留 import 入口指向 scripts/import-photos.mjs（脚本本体属 import-photos 模块）', () => {
    expect(pkg.scripts.import).toBe('node scripts/import-photos.mjs');
  });

  it('测试工具链脚本齐备：test / test:run / coverage / test:e2e', () => {
    expect(pkg.scripts.test).toContain('vitest');
    expect(pkg.scripts['test:run']).toContain('vitest run');
    expect(pkg.scripts.coverage).toContain('--coverage');
    expect(pkg.scripts['test:e2e']).toContain('playwright test');
  });
});

describe('package.json · 环境与依赖约束（task 7、全局硬约束）', () => {
  it('engines.node 锁定当前 LTS 主版本 24', () => {
    expect(pkg.engines?.node).toBe('24');
  });

  it('type: module 且 private', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.private).toBe(true);
  });

  it('技术栈依赖就位：sharp / exifr 已在依赖里', () => {
    expect(pkg.dependencies).toHaveProperty('astro');
    expect(pkg.dependencies).toHaveProperty('sharp');
    expect(pkg.dependencies).toHaveProperty('exifr');
  });

  it('未引入任何前端框架依赖（React/Vue/Svelte/Preact/Solid）', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const banned = [
      'react',
      'react-dom',
      '@astrojs/react',
      'vue',
      '@astrojs/vue',
      'svelte',
      '@astrojs/svelte',
      'preact',
      '@astrojs/preact',
      'solid-js',
      '@astrojs/solid-js',
      '@nanostores',
    ];
    for (const name of Object.keys(all)) {
      for (const b of banned) expect(name).not.toBe(b);
    }
  });
});
