import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GITIGNORE = readFileSync(resolve(ROOT, '.gitignore'), 'utf8');

/** 调 `git check-ignore` 判断路径是否被忽略（退出码 0 = 被忽略）。 */
function isIgnored(relPath: string): boolean {
  const r = spawnSync(`git check-ignore -v "${relPath}"`, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
  });
  if (r.status === 128) {
    throw new Error(`git check-ignore 失败（仓库未初始化？）：${r.stderr?.trim()}`);
  }
  return r.status === 0;
}

describe('.gitignore 生效（design §4 原图策略）', () => {
  // 文本层面：要求的条目必须写明
  it.each(['node_modules/', 'dist/', '.astro/', '/raw/', '/thumbs/'])(
    '.gitignore 含条目 %s',
    (entry) => {
      expect(GITIGNORE).toContain(entry);
    },
  );

  // 行为层面：git 真的会忽略它们（含 raw/ 下真实存在的样例文件名）
  it.each([
    'raw/P1230857.jpg',
    'raw/some-future-shot.jpg',
    'thumbs/placeholder.jpg',
    'node_modules/astro/index.js',
    'dist/index.html',
    '.astro/types.d.ts',
  ])('git check-ignore 判定被忽略：%s', (p) => {
    expect(isIgnored(p), `${p} 应当被 .gitignore 排除`).toBe(true);
  });

  it('站点源码与文档不被忽略（不能顺手把该进仓库的东西排除掉）', () => {
    for (const p of ['src/pages/index.astro', 'astro.config.mjs', 'README.md', 'doc/designv0.0.1.md']) {
      expect(isIgnored(p), `${p} 不应被忽略`).toBe(false);
    }
  });

  it('raw/ 与 thumbs/ 下没有任何文件被 Git 跟踪', () => {
    const r = spawnSync('git ls-files "raw" "thumbs"', {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
    });
    expect(r.status, r.stderr?.trim()).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});
