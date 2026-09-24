import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '@astrojs/compiler';
import { describe, expect, it } from 'vitest';

// =============================================================================
// visual-system §4.2 测试点 4（第一半）：三件套 + 站点标识的「编译后契约」
//
// 做法：用 Astro 自己的编译器（@astrojs/compiler，Astro 7 内部同一颗）把 .astro 组件
//      编译成渲染代码 + 作用域 CSS，然后对**产物**断言结构，而不是只读源码：
//   - 图版必须输出显式 width/height/alt/loading 的 <img>（§6 防布局抖动 + 懒加载）
//   - 页码片必须等宽声部、拍摄单必须宋体题名 + 等宽参数行（三声部不越界）
//   - 组件 CSS 编译后仍不得出现裸色值 / 字面 px（样式集中在 src/styles/）
//   - 站点标识的字符串来自 site.json，不硬编码品牌字
// 行为层面（真值/缺字段/※示例 的实际渲染结果）由 tests/e2e/visual-system.spec.ts 在浏览器里验。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface Compiled {
  code: string;
  css: string[];
}

async function compile(rel: string): Promise<Compiled> {
  const source = readFileSync(resolve(ROOT, rel), 'utf8');
  const result = await transform(source, {
    filename: rel.split('/').pop(),
    normalizedFilename: `/${rel}`,
    internalURL: 'astro/compiler-runtime',
    resultScopedSlot: true,
    // Astro 构建期会做 CSS 预处理；这里保持默认，只验结构与已写的声明值
  } as Parameters<typeof transform>[1]);
  return {
    code: result.code,
    css: (result.css ?? []).map((entry: string | { code?: string }) =>
      typeof entry === 'string' ? entry : (entry.code ?? ''),
    ),
  };
}

/** 编译后的 CSS 是压缩产物：这里顺手去空白归一，断言写紧凑形式。 */
const styleText = (css: string[]) =>
  css
    .join('\n')
    .replace(/\s+/g, '')
    .replace(/:where\(\.astro-[a-z0-9]+\)/g, '')
    .toLowerCase();

describe('PhotoPlate.astro —— 图版契约（编译产物）', () => {
  let plate: Compiled;

  it('能被 Astro 编译器编译', async () => {
    plate = await compile('src/components/PhotoPlate.astro');
    expect(plate.code).toContain('$$render');
  });

  it('输出 figure.plate 包裹的 <img>，且 src/width/height/alt/loading 都是显式属性绑定', async () => {
    plate = await compile('src/components/PhotoPlate.astro');
    expect(plate.code).toContain('<figure');
    expect(plate.code).toContain('<img');
    for (const attr of ['src', 'width', 'height', 'alt', 'loading']) {
      expect(plate.code, `缺 ${attr} 绑定`).toContain(`$$addAttribute(${attr}, "${attr}")`);
    }
    expect(plate.code).toContain('decoding="async"');
    // §6：默认懒加载（只有首屏 LCP 那张才显式改 eager）
    const source = readFileSync(resolve(ROOT, 'src/components/PhotoPlate.astro'), 'utf8');
    expect(source).toMatch(/loading\s*=\s*'lazy'/);
    expect(source).toMatch(/interface Props/);
  });

  it('帧号 / 闲章 / 拍摄单的挂载点都在：PageChip 子组件 + slot', async () => {
    plate = await compile('src/components/PhotoPlate.astro');
    expect(plate.code).toContain('PageChip');
    expect(plate.code).toContain('renderSlot');
    expect(plate.code).toContain('data-frame');
  });

  it('落纸投影与呼吸 hover 都走 token，且带 reduced-motion 直出', async () => {
    plate = await compile('src/components/PhotoPlate.astro');
    const css = styleText(plate.css);
    expect(css).toContain('box-shadow:var(--shadow-plate)');
    expect(css).toContain('cursor:zoom-in');
    expect(css).toContain('transform:var(--plate-zoom)');
    expect(css).toContain('prefers-reduced-motion:reduce');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\d+(?:\.\d+)?(?:px|rem|em)\b/);
  });
});

describe('PageChip.astro —— 页码片契约', () => {
  it('等宽声部 + 夜底 84% 遮罩，全部走 token', async () => {
    const chip = await compile('src/components/PageChip.astro');
    expect(chip.code).toContain('frame-chip');
    const css = styleText(chip.css);
    expect(css).toContain('font-family:var(--font-mono)');
    expect(css).toContain('background:var(--scrim-night)');
    expect(css).toContain('color:var(--paper)');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\d+(?:\.\d+)?(?:px|rem)\b/);
  });

  it('无帧号则不渲染：条件是显式写在模板里的', async () => {
    const chip = await compile('src/components/PageChip.astro');
    expect(chip.code).toMatch(/text\s*\?/);
    const source = readFileSync(resolve(ROOT, 'src/components/PageChip.astro'), 'utf8');
    expect(source).toContain("padStart(2, '0')");
  });
});

describe('ExifCard.astro —— 拍摄单契约', () => {
  it('结构是 figcaption.shotcard：宋体题名 + 等宽参数行 + 逐字段 data-field', async () => {
    const card = await compile('src/components/ExifCard.astro');
    expect(card.code).toContain('<figcaption');
    expect(card.code).toContain('shotcard');
    expect(card.code).toContain('data-field');
    const css = styleText(card.css);
    expect(css).toContain('font-family:var(--font-serif)');
    expect(css).toContain('font-family:var(--font-mono)');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\d+(?:\.\d+)?(?:px|rem)\b/);
  });

  it('※示例 标注存在，且七个 EXIF 字段都有口径', async () => {
    const card = await compile('src/components/ExifCard.astro');
    expect(card.code).toContain('※示例');
    expect(card.code).toContain('data-demo');
    const source = readFileSync(resolve(ROOT, 'src/components/ExifCard.astro'), 'utf8');
    for (const field of ['camera', 'lens', 'focalLength', 'aperture', 'shutter', 'iso', 'dateTaken']) {
      expect(source, `EXIF 字段 ${field} 未纳入口径表`).toContain(`'${field}'`);
    }
    // 缺字段容错：present() 过滤 + 空则整块不渲染
    expect(source).toContain('function present');
    expect(source).toContain('items.length > 0');
  });

  it('只吃 sidecar 的 Exif 类型，不自造字段', async () => {
    const source = readFileSync(resolve(ROOT, 'src/components/ExifCard.astro'), 'utf8');
    expect(source).toContain("import type { Exif } from '../types/photoSidecar'");
  });
});

describe('SiteMark.astro —— 站点标识契约（柚 / Justyou 并用）', () => {
  it('四个变体齐备：spine / display / inline / seal', async () => {
    const mark = await compile('src/components/SiteMark.astro');
    for (const variant of ['spine', 'display', 'inline', 'seal']) {
      expect(mark.code, `缺 ${variant} 变体`).toContain(`'${variant}'`);
    }
    expect(mark.code).toContain('v-writing');
    expect(mark.code).toContain('v-latin');
    expect(mark.code).toContain('seal');
  });

  it('品牌字来自 site.json，组件里不硬编码', async () => {
    const source = readFileSync(resolve(ROOT, 'src/components/SiteMark.astro'), 'utf8');
    expect(source).toContain("import site from '../data/site.json'");
    const body = source.split('---').slice(2).join('---');
    expect(body).not.toContain('柚影集');
    expect(body).not.toMatch(/Justyou/);
  });
});

describe('Base.astro —— 骨架与书脊导航契约', () => {
  it('书脊 / 导航 / 页脚 / 容器都编译进页面，且导航项来自 site.json', async () => {
    const base = await compile('src/layouts/Base.astro');
    expect(base.code).toContain('<header');
    expect(base.code).toContain('spine-nav');
    expect(base.code).toContain('site-footer');
    expect(base.code).toContain('class="page"');
    expect(base.code).toContain('wrap');
    expect(base.code).toContain('nav.map');
    expect(base.code).toContain('aria-current');
    expect(base.code).toContain('SiteMark');
  });

  it('骨架样式来自 global.css，入场编排在脚本里且读 token', async () => {
    const source = readFileSync(resolve(ROOT, 'src/layouts/Base.astro'), 'utf8');
    expect(source).toContain("import '../styles/global.css'");
    expect(source).toMatch(/<script>/);
    expect(source).toContain("readMs('--stagger-step'");
    expect(source).toContain("readMs('--stagger-max'");
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain("classList.add('js')");
  });
});
