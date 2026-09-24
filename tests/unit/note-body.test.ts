import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hasNoteContent, normalizeNoteBody } from '../../src/utils/noteBody';

// =============================================================================
// series-pages §4 测试点 4「手记为空则详情省略整块」的判定口径单测
//
// 详情页模板里手记块是 `{notePresent ? (...) : null}`，而 notePresent = hasNoteContent(entry.body)。
// 因此「body 空 / 只有一句 HTML 注释（导入脚本新建草稿的常见形态）/ 只剩 Markdown 符号」
// 都必须判为 false，才能既不误留空壳、也不把有正文的系列（city-lights）判空。
// 这里除了内联样例，还直接拿仓库里两份真实 index.md 的正文体做断言，锁死行为。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 模拟 Astro 交给页面的 entry.body：砍掉 `---` frontmatter，只留正文。 */
function bodyOf(rel: string): string {
  const raw = readFileSync(resolve(ROOT, rel), 'utf8');
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  return m ? m[1] : raw;
}

describe('hasNoteContent · 空/纯注释/纯符号 → false', () => {
  it('空串 / 仅空白 / null / undefined 都算无手记', () => {
    for (const b of ['', '   ', '\n\n\t \n ', null, undefined]) {
      expect(hasNoteContent(b), `应判为无手记：${JSON.stringify(b)}`).toBe(false);
    }
  });

  it('只有 HTML 注释（导入脚本生成的草稿正文）→ false', () => {
    const b = '<!-- 由 npm run import 新建（系列标识 x）。手记写完再把 draft 改成 false。 -->';
    expect(hasNoteContent(b)).toBe(false);
    expect(normalizeNoteBody(b)).toBe('');
  });

  it('只有 Markdown 结构记号（标题井号 / 引用 / 列表符 / 强调）→ false', () => {
    expect(hasNoteContent('#   \n>   \n-   \n**__~~`')).toBe(false);
  });

  it('只有图片语法（空 alt、无正文）→ false', () => {
    expect(hasNoteContent('![](photos/x.webp)')).toBe(false);
    expect(hasNoteContent('正文前\n\n![](photos/y.webp)')).toBe(true); // 有真文字仍为 true
  });
});

describe('hasNoteContent · 有可见正文 → true', () => {
  it('含普通散文 → true', () => {
    expect(hasNoteContent('第一次把城市入夜当作一个系列来拍。')).toBe(true);
  });

  it('含链接文字（去 URL 留文字）→ true', () => {
    expect(hasNoteContent('见 [逢简市集](/series/city-lights/) 一册。')).toBe(true);
  });
});

describe('hasNoteContent · 直接对仓库真实内容取证（锁死页面会怎样渲）', () => {
  it('city-lights 有手记正文 → 详情页会渲染手记块', () => {
    expect(hasNoteContent(bodyOf('src/content/series/city-lights/index.md'))).toBe(true);
  });

  it('daily-frames 正文只有一句 HTML 注释 → 判为无手记（其发布后不会留空壳）', () => {
    expect(hasNoteContent(bodyOf('src/content/series/daily-frames/index.md'))).toBe(false);
  });

  it('wip-empty 正文为空 → 判为无手记（详情页不渲染手记块，由 §4 测试点 4 的 e2e 端到端复核）', () => {
    expect(hasNoteContent(bodyOf('src/content/series/wip-empty/index.md'))).toBe(false);
  });
});
