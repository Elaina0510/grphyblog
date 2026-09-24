import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// visual-system §4.2 测试点 1：token 存在性快照
//
// 目的：设计数值只有「一处真相」（src/styles/global.css），而 DESIGN.md 是它的规范表述。
//      这里把两侧的关键值同时钉住 —— 谁漂移谁红。
//      （§10 与 design.json 里写的是 cubic-bezier(.16,1,.3,1) 这类紧凑式，
//        CSS 文件按格式化习惯写成 cubic-bezier(0.16, 1, 0.3, 1)，
//        所以比对前先做 normalize：去空白 + 去前导零 + 小写。）
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const globalCss = readFileSync(resolve(ROOT, 'src/styles/global.css'), 'utf8');
const fontsCss = readFileSync(resolve(ROOT, 'src/styles/fonts.css'), 'utf8');
const designMd = readFileSync(resolve(ROOT, 'DESIGN.md'), 'utf8');

/** 去掉空白 + 把 `0.16` 记法归一成 `.16` + 统一小写，便于跨写法比对。 */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/([(:,])0\./g, '$1.');
}

const css = normalize(globalCss);

/** 取某个自定义属性的声明值（已 normalize）。 */
function tokenValue(name: string): string | undefined {
  const re = new RegExp(`${name}:([^;]+);`);
  const m = normalize(globalCss).match(re);
  return m?.[1];
}

describe('global.css · 四色锁死（§10 / design.json colorMeta）', () => {
  const FOUR_COLORS: Array<[string, string, string]> = [
    ['--paper', '#f2f1ec', '纸白'],
    ['--ink', '#26241f', '墨'],
    ['--cinnabar', '#a03b28', '朱砂'],
    ['--night', '#191816', '夜底'],
  ];

  it.each(FOUR_COLORS)('%s = %s（%s）', (name, value, role) => {
    expect(tokenValue(name), `${name} 未定义`).toBe(value);
    expect(globalCss).toContain(role);
  });

  it('派生色只取同族色阶，不出现新色相', () => {
    // 允许的全部色值（hex）：四色 + paper/ink/cinnabar 的既有阶
    const allowed = new Set([
      '#f2f1ec',
      '#26241f',
      '#a03b28',
      '#191816',
      '#e8e6dd',
      '#b9b7ae',
      '#d5d2c8',
      '#5b574e',
      '#85806f',
      '#7e2e1f',
    ]);
    const found = [...globalCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(found.length).toBeGreaterThan(8);
    for (const hex of found) {
      expect(allowed.has(hex), `出现色相之外的色值 ${hex}`).toBe(true);
    }
  });

  it('透明叠加都是四色的 alpha 变体（组件因此不需要裸 rgba）', () => {
    for (const name of ['--scrim-night', '--scrim-paper', '--hairline-on-night', '--gutter-ink']) {
      expect(tokenValue(name), `${name} 未定义`).toMatch(/^rgba\(/);
    }
  });
});

describe('global.css · 动效与降级（§10 + design.json motion）', () => {
  it('全站唯一曲线就是 §10 那条 cubic-bezier(.16,1,.3,1)', () => {
    expect(css).toContain('--ease:cubic-bezier(.16,1,.3,1)');
  });

  it('--ease 是曲线唯一的落点：文件里 cubic-bezier 只出现在 token 定义处', () => {
    const matches = [...globalCss.matchAll(/cubic-bezier\(/g)];
    expect(matches.length).toBe(1);
  });

  it('rise 编排与错峰上限都成了 token', () => {
    for (const [name, value] of [
      ['--dur-rise', '.9s'],
      ['--rise-y', '26px'],
      ['--rise-clip', '12%'],
      ['--stagger-step', '90ms'],
      ['--stagger-max', '270ms'],
      ['--dur-morph', '.42s'],
      ['--dur-sheet', '.55s'],
      ['--sheet-y', '18px'],
      ['--dur-hover', '.8s'],
      ['--plate-zoom', 'scale(1.012)'],
    ] as const) {
      expect(tokenValue(name), `${name} 未定义`).toBe(normalize(value));
    }
  });

  it('prefers-reduced-motion 两侧规则都在：no-preference 才有隐藏态，reduce 有总开关', () => {
    expect(globalCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    expect(globalCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // 无脚本（html 没有 .js）也必须直出
    expect(globalCss).toMatch(/html:not\(\.js\)\s*\.rise/);
  });

  it('View Transition 的 plate 命名已备好（灯箱模块直接沿用）', () => {
    expect(css).toContain('::view-transition-old(plate)');
    expect(css).toContain('::view-transition-new(plate)');
  });
});

describe('global.css · 字体与字号阶梯（§10 定值优先）', () => {
  it('三声部字族齐备：宋=书、黑=文、等宽=数据', () => {
    expect(tokenValue('--font-serif')).toContain('notoserifsc');
    expect(tokenValue('--font-serif')).toContain('songtisc'); // macOS/iOS 真宋体回退
    expect(tokenValue('--font-serif')).toContain('simsun');
    expect(tokenValue('--font-sans')).toContain('notosanssc');
    expect(tokenValue('--font-sans')).toContain('pingfangsc');
    expect(tokenValue('--font-sans')).toContain('microsoftyahei');
    expect(tokenValue('--font-mono')).toContain('courierprime');
  });

  it('正文 16.5px / 行高 1.9 是 §10 定值', () => {
    expect(tokenValue('--text-body')).toBe('16.5px');
    expect(tokenValue('--leading-body')).toBe('1.9');
    // 并且真的落在 body 上
    expect(css).toMatch(/body\{[^}]*font-size:var\(--text-body\)[^}]*line-height:var\(--leading-body\)/);
  });

  it('字号阶梯各层级都在（display / headline / title / label / 导航 / 印章）', () => {
    for (const name of [
      '--text-display',
      '--text-display-narrow',
      '--text-spine-brand',
      '--text-headline',
      '--text-subtitle',
      '--text-title',
      '--text-body-lead',
      '--text-margin',
      '--text-nav',
      '--text-label-xl',
      '--text-label-lg',
      '--text-label',
      '--text-label-md',
      '--text-label-sm',
    ] as const) {
      expect(tokenValue(name), `${name} 未定义`).toBeTruthy();
    }
    expect(tokenValue('--text-display')).toBe(normalize('clamp(56px,7vw,84px)'));
    expect(tokenValue('--text-headline')).toBe(normalize('clamp(26px,3.2vw,36px)'));
  });

  it('字重只有 900 / 600 / 500 三档，中文一律正值宽字距', () => {
    expect(tokenValue('--weight-book')).toBe('900');
    expect(tokenValue('--weight-entry')).toBe('600');
    expect(tokenValue('--weight-em')).toBe('500');
    const trackings = [...globalCss.matchAll(/--tracking-[a-z]+:\s*([^;]+);/g)].map((m) => m[1]);
    expect(trackings.length).toBeGreaterThanOrEqual(6);
    for (const value of trackings) {
      expect(value.trim().startsWith('-'), `负字距违反 The Positive Tracking Rule：${value}`).toBe(false);
    }
  });

  it('行长守 66ch 上限', () => {
    expect(tokenValue('--measure')).toBe('66ch');
  });

  it('字体接入文件只自建必要子集，不引第三方 CDN', () => {
    expect(fontsCss).toContain("@import '@fontsource/courier-prime/latin-400.css'");
    expect(fontsCss).toContain("@import '@fontsource/courier-prime/latin-700.css'");
    expect((fontsCss.split('*/').pop() ?? '')).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\./i);
    // global.css 的唯一字体入口就是 fonts.css
    expect(globalCss).toMatch(/@import\s*'\.\/fonts\.css'/);
  });
});

describe('global.css · 版式骨架与节奏（§10 版式条）', () => {
  it('书脊 76px · 容器 1280 · 章间留白 clamp(72px,12vh,128px)', () => {
    expect(tokenValue('--spine-w')).toBe('76px');
    expect(tokenValue('--container-w')).toBe('1280px');
    expect(tokenValue('--gap-page')).toBe(normalize('clamp(72px,12vh,128px)'));
  });

  it('开场跨页 1/3 文字 · 2/3 图版', () => {
    expect(tokenValue('--open-cols')).toBe(normalize('minmax(280px,1fr) 2fr'));
  });

  it('竖排工具类在（书脊导航 / 章题 / 开场书名共用）', () => {
    expect(css).toMatch(/\.v-writing\{writing-mode:vertical-rl;text-orientation:upright;?\}/);
    expect(css).toMatch(/\.v-latin\{writing-mode:vertical-rl;?\}/);
  });

  it('全站只有一个断点：900px（design.json page-narrow）', () => {
    const breakpoints = [...globalCss.matchAll(/@media\s*\(max-width:\s*([^)]+)\)/g)].map((m) => m[1].trim());
    expect(breakpoints.length).toBe(1);
    expect(breakpoints[0]).toBe('900px');
  });

  it('落纸影 token 存在且只有一条（The Paper-Stack Rule）', () => {
    expect(tokenValue('--shadow-plate')).toBe(normalize('0 10px 28px -18px rgba(38,36,31,.45)'));
    expect(tokenValue('--shadow-plate-float')).toBe(normalize('0 24px 60px -30px rgba(0,0,0,.9)'));
    expect(tokenValue('--gutter-spine')).toContain('linear-gradient');
  });
});

describe('DESIGN.md ↔ global.css 一致性（规范文档不得与代码漂移）', () => {
  it('DESIGN.md 用 §10 的紧凑写法复述关键值', () => {
    for (const needle of [
      '#F2F1EC',
      '#26241F',
      '#A03B28',
      '#191816',
      'cubic-bezier(.16,1,.3,1)',
      'clamp(72px,12vh,128px)',
      'clamp(56px,7vw,84px)',
      '16.5px',
      '1.9',
      '66ch',
      '76px',
      '1280px',
      '900px',
      '≤5%',
      '≤66ch',
    ]) {
      expect(designMd, `DESIGN.md 少了关键值 ${needle}`).toContain(needle);
    }
  });

  it('DESIGN.md 覆盖了 global.css 里的核心 token 名', () => {
    for (const name of [
      '--paper',
      '--ink',
      '--cinnabar',
      '--night',
      '--rule',
      '--ink-soft',
      '--shadow-plate',
      '--ease',
      '--gap-page',
      '--spine-w',
      '--container-w',
      '--open-cols',
      '--text-display',
      '--text-headline',
      '--text-body',
      '--font-serif',
      '--font-sans',
      '--font-mono',
      '--measure',
      '--stagger-max',
    ]) {
      expect(designMd, `DESIGN.md 未记录 token ${name}`).toContain(name);
    }
  });

  it('DESIGN.md 有八节结构与降级说明', () => {
    for (const heading of [
      '## 1. 世界与规则',
      '## 2. 色彩 token',
      '## 3. 字体与三声部',
      '## 4. 版式骨架与断点',
      '## 5. 节奏与留白',
      '## 6. 动效',
      '## 7. 组件规范与 props 契约',
      '## 8. 工程约定与验收',
    ]) {
      expect(designMd, `DESIGN.md 缺小节 ${heading}`).toContain(heading);
    }
    expect(designMd).toContain('降级');
    expect(designMd).toContain('升级路径');
  });
});
