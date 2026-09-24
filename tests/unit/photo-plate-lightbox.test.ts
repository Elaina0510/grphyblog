import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '@astrojs/compiler';
import { describe, expect, it } from 'vitest';

// =============================================================================
// series-pages §2 灯箱数据契约（本模块侧）：PhotoPlate 的 data-lightbox* 最小透传
//
// 契约要求「每张参与灯箱的图版根 <figure> 带 data-lightbox / data-lightbox-gallery /
// data-lightbox-index」。做法是给 PhotoPlate 新增三个**可选** prop（lightbox /
// lightboxGallery / lightboxIndex），不破坏既有调用（首页不传 → 属性省略）。
// 这里用 Astro 编译器（与 visual-system 同法）把组件编译成渲染代码，断言：
//   - Props 接口声明了三个可选透传 prop；
//   - 根 <figure> 输出三个 data-lightbox* 属性；
//   - 未给值时是「条件省略」（$$addAttribute 对 undefined 不输出）——不影响无灯箱的旧用法。
// 真正的 HTML 级断言（具体值/递增索引）在 tests/e2e/series-pages.spec.ts 打真实产物。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE = 'src/components/PhotoPlate.astro';

async function compiledCode(): Promise<string> {
  const source = readFileSync(resolve(ROOT, SOURCE), 'utf8');
  const result = await transform(source, {
    filename: 'PhotoPlate.astro',
    normalizedFilename: `/${SOURCE}`,
    internalURL: 'astro/compiler-runtime',
    resultScopedSlot: true,
  } as Parameters<typeof transform>[1]);
  return result.code;
}

describe('PhotoPlate · data-lightbox* 透传 prop（新增可选，不破坏既有）', () => {
  it('Props 声明三个可选 lightbox 透传字段', () => {
    const src = readFileSync(resolve(ROOT, SOURCE), 'utf8');
    expect(src).toMatch(/lightbox\?:\s*boolean/);
    expect(src).toMatch(/lightboxGallery\?:\s*string/);
    expect(src).toMatch(/lightboxIndex\?:\s*number\s*\|\s*string/);
  });

  it('编译产物里根 figure 绑定 data-lightbox / -gallery / -index 三个属性', async () => {
    const code = await compiledCode();
    expect(code).toContain('data-lightbox');
    expect(code).toContain('data-lightbox-gallery');
    expect(code).toContain('data-lightbox-index');
    // 既有 data-frame 绑定仍在（未回归）
    expect(code).toContain('data-frame');
  });

  it('三者经 addAttribute 条件输出：不给值即省略，旧调用（首页）不受影响', async () => {
    const code = await compiledCode();
    // Astro 对可空属性走 $$addAttribute(...)，值为 undefined 时不渲染 —— 断言确用了该机制
    expect(code).toMatch(/\$\$addAttribute\([^)]*data-lightbox/);
  });
});
