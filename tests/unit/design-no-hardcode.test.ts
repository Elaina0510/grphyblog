import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// visual-system §4.2 测试点 2 + 3：组件层零硬编码 & 朱砂面积/色值合规
//
// 全局硬约束（design §3 + DESIGN.md §8.1）：设计变量只存在于 src/styles/。
// 所以组件层（src/components/*.astro、src/layouts/Base.astro）与页面层
// （src/pages/*.astro）里：
//   - 不许出现裸色值（#hex / rgba() / rgb() / hsl()）
//   - 不许出现第二套缓动曲线（cubic-bezier）
//   - 不许出现字面 px/rem 尺寸（含 font-size: 数字）——一律 var(--…)
// 朱砂 #A03B28 在全 src 只允许出现 1 次（global.css 的 --cinnabar 定义处）。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const listAstro = (dir: string) =>
  readdirSync(resolve(ROOT, dir))
    .filter((f) => f.endsWith('.astro'))
    .map((f) => `${dir}/${f}`);

const COMPONENT_FILES = listAstro('src/components');
const LAYOUT_FILES = listAstro('src/layouts');
const PAGE_FILES = listAstro('src/pages');

/** 剥掉块注释与 HTML 注释：注释里允许出现「76px」这类说明文字，不算硬编码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 只取 <style> 块的内容（组件的结构 CSS）。 */
function styleBlocks(source: string): string[] {
  return [...stripComments(source).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

/** 违规扫描：命中即返回可读的违规清单。 */
function findLiterals(code: string): string[] {
  const patterns: Array<[RegExp, string]> = [
    [/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/, '裸十六进制色值'],
    [/\brgba?\(/, '裸 rgb()/rgba()（应改用 --scrim-* / --hairline-on-night 等 token）'],
    [/\bhsla?\(/, '裸 hsl()'],
    [/cubic-bezier\(/, '第二条缓动曲线（全站只允许 --ease）'],
    [/\d+(?:\.\d+)?(?:px|rem)\b/, '字面 px/rem 尺寸（应下沉为 token）'],
  ];
  const hits: string[] = [];
  for (const [re, label] of patterns) {
    for (const m of code.matchAll(new RegExp(re.source, 'g'))) {
      hits.push(`${label} → "${m[0]}"`);
    }
  }
  // font-size 单独检查：值里没有 var() 就是硬编码字号
  for (const m of code.matchAll(/font-size:\s*([^;{}]+)/g)) {
    if (!m[1].includes('var(')) hits.push(`font-size 字面值 → "${m[0].trim()}"`);
  }
  return hits;
}

describe('组件层零硬编码（DESIGN.md §8.1 / §3 样式集中）', () => {
  it('src/components/ 下确有图版 / 页码片 / 拍摄单 / 站点标识四件', () => {
    expect(COMPONENT_FILES.sort()).toEqual([
      'src/components/ExifCard.astro',
      'src/components/PageChip.astro',
      'src/components/PhotoPlate.astro',
      'src/components/SiteMark.astro',
    ]);
  });

  it.each([...COMPONENT_FILES, ...LAYOUT_FILES])('%s：全文无裸色值 / 无第二条曲线 / 无字面 px', (file) => {
    const code = stripComments(read(file));
    expect(findLiterals(code), `${file} 里发现硬编码设计值`).toEqual([]);
  });

  it.each(COMPONENT_FILES)('%s：<style> 只通过 var(--token) 取设计值', (file) => {
    const blocks = styleBlocks(read(file));
    expect(blocks.length, `${file} 应有自己的结构化样式`).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, `${file} 的样式没引用任何 token`).toContain('var(--');
      const withUnits = [...block.matchAll(/:\s*[^;{}]*?\d+(?:\.\d+)?(?:px|rem|em|pt)\b[^;{}]*/g)].map(
        (m) => m[0].trim(),
      );
      expect(withUnits, `${file} 的样式带长度字面量`).toEqual([]);
    }
  });

  it('Base.astro 不自带 <style>：骨架样式全部来自 global.css', () => {
    for (const file of LAYOUT_FILES) {
      expect(styleBlocks(read(file)), `${file} 不该另起一套样式`).toEqual([]);
    }
  });

  it.each(PAGE_FILES)('%s：页面层同样不许出现裸色值', (file) => {
    const code = stripComments(read(file));
    const colorHits = findLiterals(code).filter((h) => /色值|rgb|hsl|曲线/.test(h));
    expect(colorHits, `${file} 里发现绕过 token 的颜色/曲线`).toEqual([]);
  });
});

describe('朱砂合规：色值单一出处 + 面积白名单（The One Seal Rule）', () => {
  const ALL_SRC_FILES = [
    ...listAstro('src/components'),
    ...listAstro('src/layouts'),
    ...listAstro('src/pages'),
    'src/styles/global.css',
    'src/styles/fonts.css',
  ];

  it('#A03B28 在 src/ 全树只出现一次，且就在 global.css 的 --cinnabar 定义处', () => {
    const occurrences: Array<{ file: string; count: number }> = [];
    for (const file of ALL_SRC_FILES) {
      const count = (read(file).match(/#a03b28/gi) ?? []).length;
      if (count > 0) occurrences.push({ file, count });
    }
    expect(occurrences).toEqual([{ file: 'src/styles/global.css', count: 1 }]);
    expect(read('src/styles/global.css')).toMatch(/--cinnabar:\s*#a03b28/i);
  });

  it('组件与页面若要用朱砂，只能写 var(--cinnabar)', () => {
    for (const file of [...listAstro('src/components'), ...listAstro('src/pages'), ...listAstro('src/layouts')]) {
      const code = stripComments(read(file));
      for (const line of code.split('\n')) {
        if (!/cinnabar/i.test(line)) continue;
        expect(line, `${file} 里的朱砂引用不合法：${line.trim()}`).toContain('var(--cinnabar');
      }
    }
    expect(read('src/components/SiteMark.astro')).not.toMatch(/#a03b28/i);
  });

  it('global.css 里用朱砂的规则都在「盖章级」白名单内', () => {
    const css = read('src/styles/global.css');
    const users: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = m;
      if (!/var\(--cinnabar(?:-deep)?\)/.test(body)) continue;
      const clean = selector
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/[\s\S]*\}/, '')
        .trim();
      users.push(clean.replace(/\s+/g, ' '));
    }
    // 允许：选区 / 链接悬停 / 焦点环 / 书脊当前项 / 方印与闲章底色描边 /
    //       册号与条目号 / 强调 em / 首字下沉 / ※记号 / 页边批注顶线 / 目次册号
    const allowed =
      /^(::selection|a:hover|:focus-visible|\.spine-nav a:hover|\.spine-nav a\[aria-current\]|\.spine-nav a:hover, \.spine-nav a\[aria-current\]|\.seal|\.stamp|\.chapter-no|\.t-no|\.t-body em|\.dropcap::first-letter|\.mark, \.demo|\.marginalia|\.toc \.no|\.toc a:hover)$/;
    const notSealed = users.filter((s) => !allowed.test(s));
    expect(
      notSealed,
      `这些规则用了朱砂但不在盖章级白名单里（新增需人工确认面积 ≤5%）：${notSealed.join(' | ')}`,
    ).toEqual([]);
    // 白名单确实生效（防「解析没抓到东西」的假绿）
    expect(users.length).toBeGreaterThanOrEqual(8);
  });

  it('大面积底色只允许纸白与夜底；朱砂不做背景铺陈', () => {
    const css = read('src/styles/global.css');
    const backgrounds = [...css.matchAll(/background:\s*([^;]+);/g)].map((m) => m[1].trim());
    const cinnabarBackgrounds = backgrounds.filter((b) => b === 'var(--cinnabar)');
    // 仅方印一处（::selection 属选区高亮，不是版面底色）
    expect(cinnabarBackgrounds.length).toBeLessThanOrEqual(2);
    expect(backgrounds.some((b) => b.includes('var(--paper)'))).toBe(true);
  });

  it('示例值 ※ 标注走朱砂 token（不得用别的颜色弱化它）', () => {
    const css = read('src/styles/global.css');
    expect(css).toMatch(/\.mark,\s*\.demo\s*\{[^}]*color:\s*var\(--cinnabar\)/);
    const exif = read('src/components/ExifCard.astro');
    expect(exif).toContain('※示例');
    expect(exif).toContain('class="demo"');
    const page = PAGE_FILES.map((file) => read(file)).join('\n');
    expect(page).toContain('※');
  });
});
