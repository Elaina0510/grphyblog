import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// lightbox 模块 · 接线与静态约束单测（DOM 行为归 tests/e2e/lightbox.spec.ts）
//
// 钉四件事，都是「跑一次 e2e 看不见但一改就坏」的：
//   1. 灯箱外壳的无障碍语义齐备（role/aria-modal/aria-live/inert/焦点回归/标签）；
//   2. 三条动效分支都在（View Transition / 淡入降级 / reduced-motion instant）且只用 --ease；
//   3. <Lightbox /> 只挂在有灯箱图版的三页（首页 / 系列详情 / 随笔详情），列表·关于·404 不挂；
//   4. 帧数据只有一个来源 = 脚本生成的 sidecar 序列化的 frames 岛（组件与页面都不许内联字面帧数据）。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const LIGHTBOX = read('src/components/Lightbox.astro');
const PAGES = readdirSync(resolve(ROOT, 'src/pages'))
  .filter((f) => f.endsWith('.astro'))
  .map((f) => `src/pages/${f}`);

/** 剥掉注释后的正文（注释里允许出现「inert」「44px」这类说明文字）。 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Lightbox 外壳 · 无障碍语义（任务 7）', () => {
  it('dialog 语义齐备：role=dialog + aria-modal + 可读名 + 可聚焦外壳', () => {
    expect(LIGHTBOX).toContain('role="dialog"');
    expect(LIGHTBOX).toContain('aria-modal="true"');
    expect(LIGHTBOX).toContain('aria-label={label}');
    expect(LIGHTBOX).toContain('tabindex="-1"');
    expect(LIGHTBOX).toContain('hidden');
  });

  it('换帧 aria-live：role=status + aria-live=polite 的状态行', () => {
    expect(LIGHTBOX).toMatch(/aria-live="polite"/);
    expect(LIGHTBOX).toMatch(/role="status"/);
  });

  it('每个控制按钮都带 aria-label（切帧/关闭/拍摄单/收起）', () => {
    for (const key of ['data-lb-prev', 'data-lb-next', 'data-lb-close', 'data-lb-exif', 'data-lb-sheet-close']) {
      expect(LIGHTBOX, `缺 ${key} 的接线`).toContain(key);
    }
    const labels = [...LIGHTBOX.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels.some((l) => l.includes('上一帧'))).toBe(true);
    expect(labels.some((l) => l.includes('下一帧'))).toBe(true);
    expect(labels.some((l) => l.includes('关闭灯箱'))).toBe(true);
    expect(labels.some((l) => l.includes('拍摄单'))).toBe(true);
  });

  it('背景 inert（含无 inert 支持的 aria-hidden 退路）+ 焦点回归原图版 + Tab 圈闭', () => {
    const src = code(LIGHTBOX);
    expect(src).toContain("'inert' in HTMLElement.prototype");
    expect(src).toContain("setAttribute('inert', '')");
    expect(src).toContain("setAttribute('aria-hidden', 'true')"); // 退路
    expect(src).toContain('function trapTab');
    expect(src).toContain('restore?.focus()'); // 关闭后焦点回到触发图版
    expect(src).toContain('exifBtn.focus()'); // 收起抽屉后焦点不落回 body
  });

  it('拍摄单收起时真的从 AT 与 Tab 里消失（inert / aria-hidden），展开靠 aria-expanded', () => {
    expect(LIGHTBOX).toContain('aria-expanded');
    expect(LIGHTBOX).toContain('aria-controls="lb-sheet"');
    const src = code(LIGHTBOX);
    expect(src).toContain('sheet.dataset.lbSheetOpen');
  });
});

describe('Lightbox 动效分支（任务 3/8 + DESIGN §6 降级）', () => {
  it('View Transition 形变：startViewTransition + plate 命名 + 结束清名', () => {
    const src = code(LIGHTBOX);
    expect(src).toContain('startViewTransition');
    expect(src).toContain("'view-transition-name'");
    expect(src).toContain("removeProperty('view-transition-name')");
    expect(src).toContain("runTransition('plate'");
    expect(src).toContain("runTransition('frame'");
  });

  it('三条分支各有落点：view-transition / fade / instant', () => {
    expect(LIGHTBOX).toContain("'view-transition'");
    expect(LIGHTBOX).toContain("'fade'");
    expect(LIGHTBOX).toContain("'instant'");
    expect(LIGHTBOX).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it('降级淡入用 CSS 类承载动画，样式里只有 var() 引用的时长与曲线', () => {
    const styles = [...LIGHTBOX.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    expect(styles).toContain('lb--fade');
    expect(styles).toContain('var(--ease)');
    expect(styles).toContain('var(--dur-sheet)');
    expect(styles).toContain('var(--dur-fade)');
    // 图版 ↔ 灯箱的形变时长由 global.css 的 (plate) 组承担（DESIGN §6 表）
    expect(read('src/styles/global.css')).toMatch(
      /::view-transition-old\(plate\)[\s\S]*?var\(--dur-morph\)/,
    );
    expect(styles).not.toMatch(/cubic-bezier\(/);
    expect(styles).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem|em|pt)\b/);
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // 夜底与浮起阴影都走 token
    expect(styles).toContain('var(--night)');
    expect(styles).toContain('var(--shadow-plate-float)');
    // 触摸目标与内衬走 1.13 的新 token（DESIGN §7.6：新 token 只准加在 global.css）
    expect(styles).toContain('var(--lb-hit)');
    expect(styles).toContain('var(--lb-sheet-w)');
  });

  it('reduced-motion 分支显式取消位移（无 VT、无 sheet transform）', () => {
    expect(LIGHTBOX).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(LIGHTBOX).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
  });
});

describe('挂载范围（任务 10）与数据来源单一（硬约束）', () => {
  it('只有首页 / 系列详情 / 随笔详情引入 <Lightbox />', () => {
    const users = [
      'src/pages/index.astro',
      'src/pages/series/[id].astro',
      'src/pages/posts/[slug].astro',
    ];
    for (const file of users) expect(read(file), `${file} 应挂灯箱`).toContain('<Lightbox');
    // 列表页 / 关于 / 404 / 演示页都不挂
    const others = [...PAGES, 'src/pages/series/index.astro', 'src/pages/posts/index.astro'].filter(
      (f) => !users.includes(f),
    );
    for (const file of new Set(others)) expect(read(file), `${file} 不该挂灯箱`).not.toContain('<Lightbox');
  });

  it('三页都只在真有帧时才挂外壳（空册 / 纯文字随笔不产壳）', () => {
    for (const file of ['src/pages/series/[id].astro', 'src/pages/posts/[slug].astro']) {
      expect(read(file)).toMatch(/\?\s*<Lightbox/);
    }
    expect(read('src/pages/index.astro')).toMatch(/homeFrameTotal > 0 \? <Lightbox/);
  });

  it('组件不内联任何帧数据：只从 frames 岛解析（数据只出自脚本生成的 sidecar）', () => {
    const src = code(LIGHTBOX);
    expect(src).toContain("script.lightbox-frames[data-gallery=");
    expect(src).toContain('parseFramesIsland');
    expect(src).not.toMatch(/\/_astro\//); // 不硬编码图片 URL
    expect(src).not.toMatch(/photos\/[A-Za-z0-9._-]+\.webp/); // 不硬编码照片路径
  });

  it('零框架、零新依赖：只 import 本项目 utils', () => {
    const imports = [...code(LIGHTBOX).matchAll(/import[^;]*from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(
        ['../utils/exifFormat', '../utils/lightbox'].includes(spec),
        `灯箱引入了计划外依赖：${spec}`,
      ).toBe(true);
    }
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const banned of ['react', 'vue', 'svelte', 'solid-js', 'tailwindcss', 'nanostores', 'alpinejs']) {
      expect(pkg.dependencies[banned], `不该出现框架依赖 ${banned}`).toBeUndefined();
      expect(pkg.devDependencies[banned], `不该出现框架依赖 ${banned}`).toBeUndefined();
    }
  });

  it('首页接线：gid=home 的岛 + 三张图版 + 与 series/posts 同一段契约 markup', () => {
    const home = read('src/pages/index.astro');
    expect(home).toContain('const HOME_GALLERY =');
    expect(home).toContain('class="lightbox-frames"');
    expect(home).toContain('data-gallery={HOME_GALLERY}');
    expect(home).toContain('lightboxGallery={HOME_GALLERY}');
    expect(home).toContain('buildFramesIslandJson');
  });

  it('global.css 1.13 区块真的有灯箱 token（组件不许自带字面度量）', () => {
    const css = read('src/styles/global.css');
    for (const name of [
      '--lb-z',
      '--lb-pad',
      '--lb-gap',
      '--lb-hit',
      '--lb-btn-pad',
      '--lb-nav-inset',
      '--lb-sheet-w',
      '--lb-dim',
      '--lb-lock-pad',
    ]) {
      expect(css, `缺 token ${name}`).toContain(`${name}:`);
    }
    // 灯箱 token 不许带色相（只有夜底一族已在 1.1/1.3 定义）
    const lbLines = css.split('\n').filter((line) => /^\s*--lb-/.test(line));
    for (const line of lbLines) {
      expect(line, `灯箱 token 不该出现裸色值：${line.trim()}`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});
