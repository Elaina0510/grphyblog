import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// posts-pages §4.2 测试点 5 + 验收标准：随笔页的源码级护栏（端到端断言在 tests/e2e 里）
//
// 钉的是四件「结构约定」，都是能在纯 Node 里跑死的东西：
//   ① 边界①「新建随笔 = 丢一个 md + 资源文件夹，零代码改动」：页面里不得出现任何
//      种子随笔的专属字面量（题名 / 资源夹名 / 张数），路由与文案必须全部由内容查询驱动；
//   ② 排 draft 只有一个口径：页面调 getPublishedPosts()，不得散写 getCollection + 自 filtering；
//   ③ 图片 URL 单一出口（边界③）：随笔页必须经 contentImageUrl / entryResourceDir 解析，
//      且不许出现手写的相对图片路径；正文内联图的宽高只从 sidecar 取；
//   ④ DESIGN §8.1 样式集中：随笔页（src/pages/posts/ 子目录，不在既有页面扫描范围内）
//      的 <style> 不许出现裸色值 / 第二条缓动曲线 / 字面 px·rem 尺寸，朱砂只能 var()。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const POSTS_DIR = 'src/pages/posts';
const PAGE_FILES = existsSync(resolve(ROOT, POSTS_DIR))
  ? readdirSync(resolve(ROOT, POSTS_DIR))
      .filter((f) => f.endsWith('.astro'))
      .map((f) => `${POSTS_DIR}/${f}`)
  : [];

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const all = PAGE_FILES.map(read).join('\n');

/** 剥掉块注释与 HTML 注释：注释里允许写「76px / #A03B28」这类说明文字，不算硬编码。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function styleBlocks(source: string): string[] {
  return [...stripComments(source).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

describe('随笔页存在且成对（列表 + 详情）', () => {
  it('src/pages/posts/ 下有 index.astro 与 [slug].astro', () => {
    expect(PAGE_FILES.sort()).toEqual([`${POSTS_DIR}/[slug].astro`, `${POSTS_DIR}/index.astro`]);
  });

  it('详情页有 getStaticPaths，slug 由 entryResourceDir 从文件名推（不写死）', () => {
    const detail = read(`${POSTS_DIR}/[slug].astro`);
    expect(detail).toMatch(/export async function getStaticPaths/);
    expect(detail).toContain("entryResourceDir('posts'");
    expect(detail).toContain('params: { slug }');
  });
});

describe('边界①：内容与代码分离 —— 页面零随笔专属字面量', () => {
  const SEED_LITERALS = [
    '晨雾里的第一束光',
    '巷子里的光比街上早',
    '雾起的那个早上',
    '2026-09-21-morning-fog',
    '2026-07-02-alley-light',
    '2026-08-10-foggy-morning',
    'dawn-01',
  ];

  it('列表与详情都不内联种子随笔的题名 / 资源夹名 / 文件名', () => {
    for (const literal of SEED_LITERALS) {
      // 注释里允许出现（用来解释口径），所以只扫剥注释后的代码
      expect(stripComments(all), `页面里出现了写死的内容字面量：${literal}`).not.toContain(literal);
    }
  });

  it('列表条目数、张数、日期都来自数据：无「2 篇 / 1 帧」这类死数字', () => {
    const code = stripComments(read(`${POSTS_DIR}/index.astro`));
    expect(code).toContain('getPublishedPosts()');
    expect(code).toMatch(/rows\.length/);
    expect(code).not.toMatch(/已收录 \d/);
  });

  it('页面不数缩略图、不自造张数：张数只走 photoCount 的共享口径', () => {
    const code = stripComments(read(`${POSTS_DIR}/index.astro`));
    expect(code).toContain('resolveSeriesCount');
    expect(code).toContain("from '../../utils/photoCount'");
  });
});

describe('边界②③：排 draft 与图片 URL 的唯一口径', () => {
  it('不散写 getCollection / 不自带 draft 过滤（一律走 collections 的统一入口）', () => {
    const code = stripComments(all);
    expect(code).not.toMatch(/\bgetCollection\s*\(/);
    expect(code).not.toMatch(/\bdraft\b\s*[!=]==?\s*(true|false)/);
  });

  it('详情页用 postIllustrations 管线画正文，不直接吐未解析的 entry.body', () => {
    const detail = stripComments(read(`${POSTS_DIR}/[slug].astro`));
    expect(detail).toContain('processPostIllustrations');
    expect(detail).toContain('buildIllustrationFramesJson');
    expect(detail).not.toMatch(/<div[^>]*set:html=\{entry\.body\}/);
  });

  it('不手写图片相对路径：src 只来自解析后的变量', () => {
    const code = stripComments(all);
    expect(code).not.toMatch(/src=["'](\/|\.)?[^"']*photos\//);
    expect(code).toContain("from '../../utils/contentImages'");
  });

  it('宽高只从 sidecar 取：页面里不出现字面图片尺寸', () => {
    const detail = stripComments(read(`${POSTS_DIR}/[slug].astro`));
    // 图版宽高必须取自 ref.photo.*（sidecar 本体），不得写死数字
    expect(detail).toMatch(/width=\{part\.ref\.photo\.width\}/);
    expect(detail).toMatch(/height=\{part\.ref\.photo\.height\}/);
  });

  it('灯箱契约：data-gallery 固定 post-<slug>，帧号与 frames 岛同源', () => {
    const detail = stripComments(read(`${POSTS_DIR}/[slug].astro`));
    expect(detail).toMatch(/const gallery = `post-\$\{slug\}`/);
    expect(detail).toContain('class="lightbox-frames"');
    expect(detail).toContain('data-gallery={gallery}');
    expect(detail).toContain('lightboxGallery={gallery}');
    expect(detail).toContain('lightboxIndex={part.ref.frameIndex}');
  });
});

/** 媒体查询条件是「全站唯一断点 900px」的字面量容身处（DESIGN §4：CSS 不能在条件里用 var()）。 */
function dropMediaConditions(code: string): string {
  return code.replace(/@media[^{]*/g, '@media{');
}

/**
 * 尺寸字面量只扫「模板 + <style>」：<script> 里的 IntersectionObserver rootMargin '200px'
 * 是 JS 滚动预判常量（与 series/[id].astro 同一口径），不是设计值。颜色与曲线仍全文扫。
 */
function dropScripts(code: string): string {
  return code.replace(/<script[\s\S]*?<\/script>/g, '');
}

describe('DESIGN §8.1：随笔页样式只走 token（子目录页面补扫描）', () => {
  it('页面全文无裸色值 / 无第二条缓动曲线；模板与样式里无字面 px·rem', () => {
    for (const file of PAGE_FILES) {
      const full = stripComments(read(file));
      const code = dropMediaConditions(dropScripts(full));
      const hits: string[] = [];
      for (const [re, label, scope] of [
        [/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/, '裸十六进制色值', full],
        [/\brgba?\(/, '裸 rgb()/rgba()', full],
        [/\bhsla?\(/, '裸 hsl()', full],
        [/cubic-bezier\(/, '第二条缓动曲线', full],
        [/\d+(?:\.\d+)?(?:px|rem)\b/, '字面 px/rem 尺寸', code],
      ] as Array<[RegExp, string, string]>) {
        for (const m of scope.matchAll(new RegExp(re.source, 'g'))) hits.push(`${label} → "${m[0]}"`);
      }
      expect(hits, `${file} 里发现硬编码设计值`).toEqual([]);
    }
  });

  it('<style> 每条声明只引用 var(--token) / 关键字，不出现字面长度', () => {
    for (const file of PAGE_FILES) {
      const blocks = styleBlocks(read(file));
      expect(blocks.length, `${file} 应有自己的组装样式`).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block, `${file} 的样式没引用任何 token`).toContain('var(--');
        const withUnits = [
          ...dropMediaConditions(block).matchAll(
            /:\s*[^;{}]*?\d+(?:\.\d+)?(?:px|rem|pt)\b[^;{}]*/g,
          ),
        ].map((m) => m[0].trim());
        expect(withUnits, `${file} 的样式带长度字面量`).toEqual([]);
      }
    }
  });

  it('朱砂只以 var(--cinnabar) 出现（The One Seal Rule）', () => {
    for (const file of PAGE_FILES) {
      for (const line of stripComments(read(file)).split('\n')) {
        if (!/cinnabar/i.test(line)) continue;
        expect(line, `${file} 里的朱砂引用不合法：${line.trim()}`).toContain('var(--cinnabar');
      }
    }
  });

  it('骨架不重写：随笔页一律套 Base.astro，导航与页脚不在页面里硬编码', () => {
    for (const file of PAGE_FILES) {
      const code = read(file);
      expect(code, `${file} 必须套 Base`).toContain("from '../../layouts/Base.astro'");
      expect(code).toContain('current="posts"');
      expect(stripComments(code)).not.toMatch(/<footer/);
      expect(stripComments(code)).not.toMatch(/class="spine"/);
    }
  });

  it('正文插图全部 lazy（§6：本页 LCP 是标题文字，不设 eager 例外）', () => {
    const detail = stripComments(read(`${POSTS_DIR}/[slug].astro`));
    expect(detail).toContain('loading="lazy"');
    expect(detail).not.toContain('fetchpriority="high"');
  });
});
