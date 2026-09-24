import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import site from '../../src/data/site.json';

// =============================================================================
// about-404 §4.2 测试点（源码级护栏；产物级与真 HTTP 断言在 tests/e2e/about-404.spec.ts）
//
// 钉四件「结构约定」：
//   ① 路由约定 —— about.astro / 404.astro 在 src/pages 顶层；404 文件名是 Astro 约定
//      （产出 dist/404.html）；astro.config 不得改成 format:'file'（否则 /about/ 路由口径变）；
//   ② 数据驱动（任务 5 的静态面）—— 关于页正文全部从 site.json 取：页面源码（去注释）里
//      不得出现任何站点事实字面量（制作信息值 / 书名 / 品牌串 / 简介句），且必须逐源引用
//      site.intro / site.colophon / site.social / site.contact / site.nav；
//      「改 site.json 文案 → 重建即生效」的另一半（产物真的跟着变）由 e2e fs/HTTP 断言钉；
//   ③ 占位诚实（DESIGN §8.2）—— 页内必须有 ※示例 / ※待补 机制，placeholder 链接降级为 #；
//   ④ 样式集中（验收标准）—— 两页 <style> 零裸色值 / 零曲线 / 零字面尺寸（var()/0/关键字）。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const ABOUT = 'src/pages/about.astro';
const NOT_FOUND = 'src/pages/404.astro';

/** 剥掉块注释、行注释与 HTML 注释：注释里允许出现说明性字面量，不算硬编码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function styleBlocks(source: string): string[] {
  return [...stripComments(source).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

describe('路由与文件约定（about-404 任务 2 / 3）', () => {
  it('src/pages/ 顶层有 about.astro 与 404.astro（404 文件名 = Astro 的 dist/404.html 约定）', () => {
    expect(existsSync(resolve(ROOT, ABOUT))).toBe(true);
    expect(existsSync(resolve(ROOT, NOT_FOUND))).toBe(true);
  });

  it('astro.config 未改 format:file —— directory 格式下 /about/ 命中 dist/about/index.html', () => {
    const config = read('astro.config.mjs');
    expect(config).not.toMatch(/format:\s*['"]file['"]/);
  });

  it('两页都套 Base：关于 current="about"（导航点亮），404 current="none"（非四页不点亮）', () => {
    expect(read(ABOUT)).toMatch(/<Base[\s\S]*?current="about"/);
    expect(read(NOT_FOUND)).toMatch(/<Base[\s\S]*?current="none"/);
  });

  it('404 有明确的回首页链接：href="/" + 可达名「回首页」（design §5）', () => {
    const code = stripComments(read(NOT_FOUND));
    expect(code).toContain('href="/"');
    expect(code).toContain('回首页');
  });
});

describe('关于页数据驱动：站点事实零硬编码（任务 1/2 + 验收「改 site.json 即生效」的源码面）', () => {
  const code = stripComments(read(ABOUT));

  it('页面按字段消费 site.json：intro / colophon / social / contact / nav 逐源在场', () => {
    for (const ref of ['site.intro', 'site.colophon', 'site.social', 'site.contact', 'site.nav', 'site.bookName']) {
      expect(code, `关于页未从 ${ref} 取数`).toContain(ref);
    }
  });

  it('制作信息（colophon）的 term/value 不落到页面源码里（只从 JSON 循环渲染）', () => {
    for (const row of site.colophon) {
      expect(code, `term 被硬编码：${row.term}`).not.toContain(row.term);
      expect(code, `value 被硬编码：${row.value}`).not.toContain(row.value);
    }
  });

  it('书名 / 品牌串 / 简介句 / 社交 label 不落到页面源码里', () => {
    expect(code).not.toContain(site.bookName.cjk);
    expect(code).not.toContain(site.bookName.latin);
    expect(code).not.toContain(site.name.display);
    expect(code).not.toContain(site.name.spine);
    expect(code).not.toContain(site.intro.text.slice(0, 16));
    // 「联系邮箱」这类布局措辞含「邮箱」子串属允许；label 单独走整词硬编码检查：
    // 页面里不得以字符串字面量形式写 Instagram（渲染只经 {item.label}）。
    expect(code).not.toContain('Instagram');
  });

  it('导航四项文案不在页面里二次硬编码（书脊只由 Base 提供）', () => {
    expect(code).not.toContain('spine-nav');
    const notFound = stripComments(read(NOT_FOUND));
    expect(notFound).not.toContain('spine-nav');
    expect(notFound).not.toContain(site.name.spine);
  });

  it('章题与回首页措辞取 site.nav 的 label（about / home），不是复制品', () => {
    expect(code).toContain("item.key === 'about'");
    expect(stripComments(read(NOT_FOUND))).toContain("item.key === 'home'");
  });
});

describe('占位诚实 + 样式集中（DESIGN §8.2 / §8.1，验收标准「无新增样式源」）', () => {
  const about = stripComments(read(ABOUT));
  const notFound = stripComments(read(NOT_FOUND));

  it('placeholder → href 降级为 #，且 ※示例 / ※待补 记号在场', () => {
    expect(about).toContain("item.placeholder ? '#' : item.href");
    expect(about).toContain('※示例');
    expect(about).toContain('※待补');
  });

  it.each([
    ['about', ABOUT],
    ['404', NOT_FOUND],
  ] as const)('%s 页全文无裸色值 / 无第二条曲线', (_name, file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
    expect(code).not.toMatch(/\brgba?\(/);
    expect(code).not.toMatch(/\bhsla?\(/);
    expect(code).not.toMatch(/cubic-bezier\(/);
    for (const line of code.split('\n')) {
      if (/cinnabar/i.test(line)) expect(line).toContain('var(--cinnabar');
    }
  });

  it.each([
    ['about', ABOUT],
    ['404', NOT_FOUND],
  ] as const)('%s 页 <style> 只用 var()/0/关键字：无字面 px/rem/em/pt、无字面字号', (_name, file) => {
    for (const block of styleBlocks(read(file))) {
      expect(block, `${file} 的样式没引用任何 token`).toContain('var(--');
      const withUnits = [...block.matchAll(/:\s*[^;{}]*?\d+(?:\.\d+)?(?:px|rem|em|pt)\b[^;{}]*/g)].map(
        (m) => m[0].trim(),
      );
      expect(withUnits, `${file} 的样式带长度字面量`).toEqual([]);
      for (const m of block.matchAll(/font-size:\s*([^;{}]+)/g)) {
        expect(m[1], `${file} 出现字面字号`).toContain('var(');
      }
    }
  });

  it('两页不引入照片组件（关于与 404 原则上无照片）', () => {
    expect(about).not.toContain('PhotoPlate');
    expect(notFound).not.toContain('PhotoPlate');
  });
});
