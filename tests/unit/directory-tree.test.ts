import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// 验收点：目录树与 design §3 一致。空目录以 .gitkeep 占位，保证能被 Git 跟踪。
const REQUIRED_DIRS = [
  'src',
  'src/pages',
  'src/content',
  'src/content/series',
  'src/content/posts',
  'src/components',
  'src/layouts',
  'src/styles',
  'scripts',
  'public',
  'public/admin',
  'tests/unit',
  'tests/e2e',
];

const GITKEEP_DIRS = [
  'src/content/series',
  'src/content/posts',
  'src/components',
  'src/layouts',
  'src/styles',
  'scripts',
  'public/admin',
];

describe('目录树（design §3）', () => {
  it.each(REQUIRED_DIRS)('目录存在：%s', (dir) => {
    const abs = resolve(ROOT, dir);
    expect(existsSync(abs), `缺少目录 ${dir} -> ${abs}`).toBe(true);
  });

  it.each(GITKEEP_DIRS)('空目录有 .gitkeep 占位：%s', (dir) => {
    expect(existsSync(resolve(ROOT, dir, '.gitkeep'))).toBe(true);
  });

  it('保留区仍在原位（doc/ raw/ thumbs/ 未被骨架流程破坏）', () => {
    expect(existsSync(resolve(ROOT, 'doc'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'raw'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'thumbs'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'PRODUCT.md'))).toBe(true);
  });

  it('首页入口存在', () => {
    expect(existsSync(resolve(ROOT, 'src/pages/index.astro'))).toBe(true);
  });
});
