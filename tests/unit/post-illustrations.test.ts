import { describe, expect, it } from 'vitest';

// =============================================================================
// posts-pages §4.2 测试点 2（管线部分）：随笔「正文内联插图」构建期管线纯函数测
//
// 这里钉的是 src/utils/postIllustrations.ts 的口径（端到端 HTML 断言在
// tests/e2e/posts-pages.spec.ts 里打真实 dist 产物）。逐条对应交付清单第 4 点：
//   ① 相对路径 → 已解析可服务 URL（注入的 resolveUrl 走 contentImageUrl，边界③）；
//   ② 宽高只从 sidecar 取；缺 sidecar 条目 → 告警 + 跳过灯箱，**不伪造尺寸**；
//   ③ 灯箱帧序列（frames 岛数据）字段齐、按 sidecar 顺序、索引连续；
//   ④ 同一张图在正文里重复引用只占一个灯箱帧（与「封面/正文同 sidecar 不重复渲染」同口径）；
//   ⑤ Astro 7 markdown 管线的 __ASTRO_IMAGE_ 占位写法（真 src 被摘掉）也必须认。
// 纯函数层用注入的假 URL 解析器，因此本文件不需要起一次 astro build。
// =============================================================================

import type { PhotoEntry, PhotoSidecar } from '../../src/types/photoSidecar';
import {
  buildIllustrationFramesJson,
  findSidecarIndex,
  normalizeIllustrationPath,
  processPostIllustrations,
} from '../../src/utils/postIllustrations';

const entry = (file: string, width: number, height: number): PhotoEntry => ({
  file,
  thumb: file.replace(/\.webp$/, '.thumb.webp'),
  width,
  height,
  thumbWidth: 800,
  thumbHeight: Math.round((800 * height) / width),
  exif: { camera: 'GX85', aperture: 2.5, shutter: '1/125', iso: 200, dateTaken: '2026-09-21' },
});

const sidecar = (): PhotoSidecar => [
  entry('photos/dawn-01.webp', 2560, 1707),
  entry('photos/dawn-02.webp', 1922, 2560),
];

/** 假解析器：把资源相对路径映射成 /_astro/ 形 URL（真管线用 contentImageUrl 同形）。 */
const fakeResolve = (rel: string) => `/_astro/${rel.split('/').pop()}.hash.webp`;

describe('相对路径归一与 sidecar 查表', () => {
  it('正文各种写法都归一成 sidecar 口径的 photos/<名>.webp', () => {
    expect(normalizeIllustrationPath('photos/dawn-01.webp')).toBe('photos/dawn-01.webp');
    expect(normalizeIllustrationPath('./photos/dawn-01.webp')).toBe('photos/dawn-01.webp');
    expect(normalizeIllustrationPath('2026-09-21-morning-fog/photos/dawn-01.webp')).toBe(
      'photos/dawn-01.webp',
    );
    expect(normalizeIllustrationPath('/src/content/posts/x/photos/dawn-01.webp')).toBe(
      'photos/dawn-01.webp',
    );
    expect(normalizeIllustrationPath('photos/dawn-01.webp?v=2')).toBe('photos/dawn-01.webp');
    expect(normalizeIllustrationPath('')).toBe('');
  });

  it('findSidecarIndex：精确 / 目录尾段 / basename 三种命中路径，缩略图不误命中', () => {
    const table = sidecar();
    expect(findSidecarIndex(table, 'photos/dawn-01.webp')).toBe(0);
    expect(findSidecarIndex(table, '2026-09-21-morning-fog/photos/dawn-02.webp')).toBe(1);
    expect(findSidecarIndex(table, 'dawn-02.webp')).toBe(1);
    expect(findSidecarIndex(table, 'photos/nope.webp')).toBe(-1);
    expect(findSidecarIndex([], 'photos/dawn-01.webp')).toBe(-1);
  });
});

describe('内联插图管线：URL 解析 + sidecar 真宽高 + 灯箱帧', () => {
  it('普通 <img src="photos/…">：换掉整枚标签、按 sidecar 记真宽高、解析出可服务 URL', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<p>前段</p><p><img src="photos/dawn-01.webp" alt="晨雾"></p><p>后段</p>',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
      onWarn: (m) => warnings.push(m),
    });

    // 正文被切成「文本 / 插图 / 文本」三段，且顺序不变
    expect(out.parts.map((p) => p.kind)).toEqual(['html', 'illustration', 'html']);
    expect(warnings).toEqual([]);

    const ref = out.parts[1];
    if (ref.kind !== 'illustration') throw new Error('插图段丢失');
    expect(ref.ref.photo.width).toBe(2560);
    expect(ref.ref.photo.height).toBe(1707);
    expect(ref.ref.src).toBe('/_astro/dawn-01.webp.hash.webp');
    expect(ref.ref.thumb).toBe('/_astro/dawn-01.thumb.webp.hash.webp');
    expect(ref.ref.alt).toBe('晨雾');
    expect(ref.ref.frameIndex).toBe(0);

    // 文本段里不再残留任何未解析的相对路径
    const text = out.parts
      .filter((p) => p.kind === 'html')
      .map((p) => (p.kind === 'html' ? p.html : ''))
      .join('');
    expect(text).not.toContain('photos/dawn-01.webp');
    expect(text).not.toContain('<img');
  });

  it('Astro 7 的 __ASTRO_IMAGE_ 占位写法（src 被摘掉）同样能取到 src/alt 并接上灯箱', () => {
    const html =
      '<p><img __ASTRO_IMAGE_="{&quot;alt&quot;:&quot;田埂&quot;,&quot;src&quot;:&quot;2026-09-21-morning-fog/photos/dawn-02.webp&quot;,&quot;index&quot;:0}"></p>';
    const out = processPostIllustrations({ html, sidecar: sidecar(), resolveUrl: fakeResolve });

    expect(out.parts).toHaveLength(1);
    const only = out.parts[0];
    if (only.kind !== 'illustration') throw new Error('占位图未被识别为插图');
    expect(only.ref.sidecarIndex).toBe(1);
    expect(only.ref.photo.width).toBe(1922);
    expect(only.ref.alt).toBe('田埂');
    // 单独成段的图片被剥掉空 <p>，不会留下 <p></p> 残渣
    expect(out.parts.some((p) => p.kind === 'html' && p.html.includes('<p></p>'))).toBe(false);
  });

  it('多张图：frames 按 sidecar 顺序编号，索引连续且与正文出现顺序无关', () => {
    const html =
      '<p>一</p><img src="photos/dawn-02.webp" alt="二">' +
      '<p>三</p><img src="photos/dawn-01.webp" alt="一">';
    const out = processPostIllustrations({ html, sidecar: sidecar(), resolveUrl: fakeResolve });

    // 正文顺序 = dawn-02 → dawn-01；帧号顺序 = sidecar 顺序 = dawn-01(0) → dawn-02(1)
    const domOrder = out.parts
      .filter((p) => p.kind === 'illustration')
      .map((p) => (p.kind === 'illustration' ? p.ref.photo.file : ''));
    expect(domOrder).toEqual(['photos/dawn-02.webp', 'photos/dawn-01.webp']);
    expect(out.frames.map((f) => f.photo.file)).toEqual([
      'photos/dawn-01.webp',
      'photos/dawn-02.webp',
    ]);
    expect(out.frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    const indexes = out.parts
      .filter((p) => p.kind === 'illustration')
      .map((p) => (p.kind === 'illustration' ? p.ref.frameIndex : -1))
      .sort((a, b) => a - b);
    expect(indexes).toEqual([0, 1]);
  });

  it('同一张图正文里引用两次：出两块图版，但只占一个灯箱帧（重复引用复用首帧号）', () => {
    const html =
      '<img src="photos/dawn-01.webp" alt="首"><img src="photos/dawn-01.webp" alt="重">';
    const out = processPostIllustrations({ html, sidecar: sidecar(), resolveUrl: fakeResolve });

    const refs = out.parts.filter((p) => p.kind === 'illustration');
    expect(refs).toHaveLength(2);
    expect(out.plateCount).toBe(2);
    expect(out.frames).toHaveLength(1); // 灯箱里这张只有一帧
    const numbers = refs.map((p) => (p.kind === 'illustration' ? p.ref.frameIndex : -1));
    expect(numbers).toEqual([0, 0]);
    expect(refs[1].kind === 'illustration' && refs[1].ref.duplicate).toBe(true);
  });
});

describe('缺 sidecar 条目：构建期告警 + 跳过灯箱，不伪造尺寸', () => {
  it('sidecar 里没有这张图 → 记一条含路径的告警，图不进 frames，也不接 data-lightbox 口径', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<p>正文</p><img src="photos/ghost-09.webp" alt="幽灵">',
      sidecar: sidecar(),
      resolveUrl: () => '', // 资源夹里也没有这个文件
      onWarn: (m) => warnings.push(m),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('photos/ghost-09.webp');
    expect(out.skipped).toEqual(['photos/ghost-09.webp']);
    expect(out.frames).toEqual([]);
    // 图仍留在文本段里（不丢内容），但没有任何图版 / 帧号结构
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].kind).toBe('html');
    if (out.parts[0].kind === 'html') {
      expect(out.parts[0].html).toContain('ghost-09.webp');
      expect(out.parts[0].html).toContain('<img');
    }
  });

  it('整份 sidecar 缺失（新随笔还没跑导入脚本）→ 全部告警跳过，正文照出不炸', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<img src="photos/dawn-01.webp" alt="雾">',
      sidecar: null,
      resolveUrl: () => '',
      onWarn: (m) => warnings.push(m),
    });
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    expect(warnings.join('\n')).toContain('npm run import');
  });

  it('文件在资源夹里、只是 sidecar 漏记：URL 仍解析成可服务地址，但不加宽高（不伪造）', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<img src="photos/extra-01.webp" alt="漏记">',
      sidecar: sidecar(),
      resolveUrl: (rel) => `/_astro/${rel.split('/').pop()}.hash.webp`,
      onWarn: (m) => warnings.push(m),
    });
    const html = out.parts.map((p) => (p.kind === 'html' ? p.html : '')).join('');
    expect(html).toContain('src="/_astro/extra-01.webp.hash.webp"');
    expect(html).not.toMatch(/\bwidth=/);
    expect(html).not.toMatch(/\bheight=/);
    expect(out.frames).toEqual([]);
    expect(out.skipped).toEqual(['photos/extra-01.webp']);
    // 缺 sidecar 条目即告警（哪怕文件本身能加载）
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('photos/extra-01.webp');
    expect(warnings[0]).toContain('npm run import');
  });

  it('外链 / 绝对路径 / data URI 即使 basename 撞上 sidecar 也不算资源夹插图', () => {
    const out = processPostIllustrations({
      html:
        '<img src="https://cdn.example.com/photos/dawn-01.webp" alt="外链">' +
        '<img src="/photos/dawn-01.webp" alt="站点绝对">' +
        '<img src="data:image/webp;base64,AAAA" alt="内联">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    const html = out.parts.map((p) => (p.kind === 'html' ? p.html : '')).join('');
    expect(html).toContain('https://cdn.example.com/photos/dawn-01.webp');
    expect(html).toContain('src="/photos/dawn-01.webp"');
    expect(html).toContain('data:image/webp;base64,AAAA');
  });

  it('sidecar 有记录但产物不在构建图里：告警 + 不占帧，也不留一个空壳图版', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<p>前</p><img src="photos/dawn-01.webp" alt="被删掉的图">',
      sidecar: sidecar(),
      resolveUrl: () => '', // 文件被手删 / 没重跑导入
      onWarn: (m) => warnings.push(m),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('photos/dawn-01.webp');
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].kind).toBe('html');
  });

  it('留在文本段里的 <img> 必须已被剥掉 __ASTRO_IMAGE_ 构建期占位属性', () => {
    const out = processPostIllustrations({
      html:
        '<img __ASTRO_IMAGE_="{&quot;alt&quot;:&quot;幽灵&quot;,&quot;src&quot;:&quot;ghost/x.webp&quot;,&quot;index&quot;:0}">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve, // 资源夹里没有 ghost/x.webp，但假解析器照给
    });
    const html = out.parts.map((p) => (p.kind === 'html' ? p.html : '')).join('');
    expect(html).not.toContain('__ASTRO_IMAGE_');
    expect(html).toContain('<img');
    expect(html).toContain('src="/_astro/x.webp.hash.webp"');
    expect(html).toContain('alt="幽灵"');
    expect(html).not.toContain('src="ghost/x.webp"');
  });
});

describe('无插图的随笔正文', () => {
  it('纯文字正文：一个文本段、零帧，占位记号不残留', () => {
    const out = processPostIllustrations({
      html: '<h2>标题</h2><p>只有字。</p>',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    expect(out.parts).toHaveLength(1);
    if (out.parts[0].kind === 'html') {
      expect(out.parts[0].html).toContain('只有字。');
      expect(out.parts[0].html).not.toContain('astro-illus');
    }
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
  });

  it('空字符串 / 脏输入一律安全返回空 parts，不抛错', () => {
    expect(processPostIllustrations({ html: '' }).parts).toEqual([]);
    expect(processPostIllustrations({ html: '<p></p>', sidecar: [] }).parts).toEqual([]);
  });
});

describe('frames JSON 岛（§2 契约数据本体）', () => {
  it('字段齐（src/thumb/width/height/alt/exif + title），且 < 已转义防 </script> 提前闭合', () => {
    const out = processPostIllustrations({
      html: '<img src="photos/dawn-01.webp" alt="光">&lt;script&gt;alert(1)&lt;/script&gt;',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    const json = buildIllustrationFramesJson(out.frames, { title: '晨雾里的第一束光' });
    expect(json).not.toContain('<');

    const parsed = JSON.parse(json) as {
      frames: Array<Record<string, unknown>>;
    };
    expect(parsed.frames).toHaveLength(1);
    const frame = parsed.frames[0];
    expect(Object.keys(frame).sort()).toEqual(
      ['alt', 'exif', 'height', 'src', 'thumb', 'title', 'width'].sort(),
    );
    expect(frame.src).toBe('/_astro/dawn-01.webp.hash.webp');
    expect(frame.thumb).toBe('/_astro/dawn-01.thumb.webp.hash.webp');
    expect(frame.width).toBe(2560);
    expect(frame.height).toBe(1707);
    expect(frame.alt).toBe('光');
    expect(frame.title).toBe('晨雾里的第一束光');
    expect(frame.exif).toMatchObject({ camera: 'GX85' });
  });

  it('alt 为空时回落到题名，不留空描述', () => {
    const out = processPostIllustrations({
      html: '<img src="photos/dawn-01.webp" alt="">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    const parsed = JSON.parse(buildIllustrationFramesJson(out.frames, { title: '雾' })) as {
      frames: Array<{ alt: string }>;
    };
    expect(parsed.frames[0].alt).toBe('雾');
  });
});
