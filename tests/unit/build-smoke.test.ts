import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// 验收点：空站可 build —— `npm run build` 零报错并真的产出 dist/。
describe('build 冒烟（npm run build）', () => {
  let buildOut = '';

  beforeAll(() => {
    rmSync(resolve(ROOT, 'dist'), { recursive: true, force: true });
    buildOut = execSync('npm run build', {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('构建过程无报错关键字', () => {
    expect(buildOut + '\n').not.toMatch(/error TS|Invalid config|Cannot find module|ENOENT/i);
  });

  it('产出 dist/index.html（真实首页：四区齐备、无骨架占位）', () => {
    const distIndex = resolve(ROOT, 'dist/index.html');
    expect(existsSync(distIndex)).toBe(true);
    const html = readFileSync(distIndex, 'utf8');
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).not.toContain('骨架占位首页');
    for (const region of ['开卷', '精选', '最新系列', '最新随笔']) {
      expect(html, `首页缺「${region}」区`).toContain(region);
    }
  });

  it('构建产物 dist/ 不进仓库（.gitignore 已排除）', () => {
    const r = execSync('git check-ignore -v dist/index.html', {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.trim()).not.toBe('');
  });
});
