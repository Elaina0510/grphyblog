import { describe, expect, it } from 'vitest';

// =============================================================================
// posts-pages §4.2 测试点 2（管线部分）+ 照片池化 D2b：
// 随笔「正文内联插图」构建期管线纯函数测
//
// 这里钉的是 src/utils/postIllustrations.ts 的口径（端到端 HTML 断言在
// tests/e2e/posts-pages.spec.ts 里打真实 dist 产物）。逐条对应交付清单：
//   ① 插图语法 `![说明](photo:照片ID)`：photo: 协议头 + 池内照片 ID，方括号即 alt；
//   ② 照片 ID → 已解析可服务 URL（注入的 resolveUrl 走 contentImageUrl，边界③），
//      产物里绝不留 `photo:` 协议头；
//   ③ 宽高只从**全局池 sidecar** 取；缺 sidecar 条目 → 告警 + 跳过灯箱，**不伪造尺寸**；
//   ④ 灯箱帧序列（frames 岛数据）字段齐、按正文首现顺序、索引连续；
//   ⑤ 同一张图在正文里重复引用只占一个灯箱帧；
//   ⑥ 退役的旧相对路径写法（`photos/x.webp`）告警但不再接灯箱；
//   ⑦ Astro 7 markdown 管线的 __ASTRO_IMAGE_ 占位写法也必须认（旧写法残留时仍会走到）。
// 纯函数层用注入的假 URL 解析器，因此本文件不需要起一次 astro build。
// =============================================================================

import type { PhotoEntry, PhotoSidecar } from '../../src/types/photoSidecar';
import {
  buildIllustrationFramesJson,
  findSidecarIndex,
  isPhotoRef,
  normalizeIllustrationPath,
  parseIllustrationSource,
  photoIdOfRef,
  processPostIllustrations,
  refPhotoId,
} from '../../src/utils/postIllustrations';

/** 池内一条 PhotoEntry（file/thumb 是池内相对路径口径 `photos/…`）。 */
const entry = (file: string, width: number, height: number): PhotoEntry => ({
  file,
  thumb: file.replace(/\.webp$/, '.thumb.webp'),
  width,
  height,
  thumbWidth: 800,
  thumbHeight: Math.round((800 * height) / width),
  exif: { camera: 'GX85', aperture: 2.5, shutter: '1/125', iso: 200, dateTaken: '2026-09-21' },
});

/** 全局池 sidecar 的两条夹具（与 src/content/pool/photos.meta.json 同形）。 */
const sidecar = (): PhotoSidecar => [
  entry('photos/dawn-01.webp', 2560, 1707),
  entry('photos/dawn-02.webp', 1922, 2560),
];

/** 假解析器：把池内相对路径映射成 /_astro/ 形 URL（真管线用 contentImageUrl 同形）。 */
const fakeResolve = (rel: string) => `/_astro/${rel.split('/').pop()}.hash.webp`;

describe('插图语法 photo:<照片ID>：解析口径', () => {
  it('photo: 协议头 + 池内 ID → {kind:photo,id}', () => {
    expect(parseIllustrationSource('photo:dawn-01.webp')).toEqual({
      kind: 'photo',
      id: 'dawn-01.webp',
    });
    // 多写一层 photos/ 也取末段（手滑容错）
    expect(parseIllustrationSource('photo:photos/dawn-01.webp')).toEqual({
      kind: 'photo',
      id: 'dawn-01.webp',
    });
    // 协议头大小写不敏感
    expect(isPhotoRef('PHOTO:dawn-01.webp')).toBe(true);
    expect(photoIdOfRef('PHOTO:dawn-01.webp')).toBe('dawn-01.webp');
  });

  it('photo: 后面没东西 → 不算合法插图引用（落到退役写法分支）', () => {
    expect(photoIdOfRef('photo:')).toBe('');
    expect(parseIllustrationSource('photo:').kind).toBe('legacyPath');
  });

  it('退役的旧相对路径写法被识别为 legacyPath（归一到 photos/<名>.webp）', () => {
    expect(parseIllustrationSource('photos/dawn-01.webp')).toEqual({
      kind: 'legacyPath',
      rel: 'photos/dawn-01.webp',
    });
    expect(parseIllustrationSource('2026-09-21-morning-fog/photos/dawn-01.webp')).toEqual({
      kind: 'legacyPath',
      rel: 'photos/dawn-01.webp',
    });
    expect(parseIllustrationSource('./photos/dawn-01.webp?v=2')).toEqual({
      kind: 'legacyPath',
      rel: 'photos/dawn-01.webp',
    });
  });

  it('外链 / data: / 站点绝对路径 → external（即使 basename 撞上池里的图）', () => {
    for (const raw of [
      'https://cdn.example.com/photos/dawn-01.webp',
      'data:image/webp;base64,AAAA',
      'blob:https://x/y',
      '//cdn.example.com/photos/dawn-01.webp',
      '/photos/dawn-01.webp',
    ]) {
      expect(parseIllustrationSource(raw).kind, raw).toBe('external');
    }
  });

  it('normalizeIllustrationPath 保留旧口径（contentImages 的多形查表仍依赖它）', () => {
    expect(normalizeIllustrationPath('photos/dawn-01.webp')).toBe('photos/dawn-01.webp');
    expect(normalizeIllustrationPath('2026-09-21-morning-fog/photos/dawn-01.webp')).toBe(
      'photos/dawn-01.webp',
    );
    expect(normalizeIllustrationPath('/src/content/posts/x/photos/dawn-01.webp')).toBe(
      'photos/dawn-01.webp',
    );
    expect(normalizeIllustrationPath('')).toBe('');
  });

  it('refPhotoId 是查表的匹配键：photo:ID / 裸 ID / 旧路径都归一成同一 ID', () => {
    for (const raw of [
      'photo:dawn-01.webp',
      'dawn-01.webp',
      'photos/dawn-01.webp',
      'posts/2026-09-21-morning-fog/photos/dawn-01.webp',
    ]) {
      expect(refPhotoId(raw), raw).toBe('dawn-01.webp');
    }
  });
});

describe('findSidecarIndex · 按照片 ID 在全局池 sidecar 里定位', () => {
  it('三种写法都命中同一条；缩略图不误命中', () => {
    const table = sidecar();
    expect(findSidecarIndex(table, 'photo:dawn-01.webp')).toBe(0);
    expect(findSidecarIndex(table, 'dawn-02.webp')).toBe(1);
    expect(findSidecarIndex(table, '2026-09-21-morning-fog/photos/dawn-02.webp')).toBe(1);
    // 缩略图是另一个 ID（x.thumb.webp ≠ x.webp），不会串到展示图那一条
    expect(findSidecarIndex(table, 'photo:dawn-01.thumb.webp')).toBe(-1);
  });

  it('池里没有 / 空表 / 空引用 → -1', () => {
    expect(findSidecarIndex(sidecar(), 'photo:ghost-09.webp')).toBe(-1);
    expect(findSidecarIndex([], 'photo:dawn-01.webp')).toBe(-1);
    expect(findSidecarIndex(sidecar(), '')).toBe(-1);
  });
});

describe('内联插图管线：photo:ID → URL 解析 + 池真宽高 + 灯箱帧', () => {
  it('普通 <img src="photo:…">：换掉整枚标签、真宽高、可服务 URL、不留协议头', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<p>前段</p><p><img src="photo:dawn-01.webp" alt="晨雾"></p><p>后段</p>',
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

    // 文本段里不再残留任何未解析的相对路径 / photo: 协议头
    const text = out.parts
      .filter((p) => p.kind === 'html')
      .map((p) => (p.kind === 'html' ? p.html : ''))
      .join('');
    expect(text).not.toContain('photos/dawn-01.webp');
    expect(text).not.toContain('photo:');
    expect(text).not.toContain('<img');
  });

  it('多张图：frames 按**正文首现顺序**编号，索引连续且每张恰一帧', () => {
    const html =
      '<p>一</p><img src="photo:dawn-02.webp" alt="二">' +
      '<p>三</p><img src="photo:dawn-01.webp" alt="一">';
    const out = processPostIllustrations({ html, sidecar: sidecar(), resolveUrl: fakeResolve });

    // 正文顺序 = dawn-02 → dawn-01；帧序跟正文走（池化后没有「条目 sidecar 顺序」可依）
    const domOrder = out.parts
      .filter((p) => p.kind === 'illustration')
      .map((p) => (p.kind === 'illustration' ? p.ref.photo.file : ''));
    expect(domOrder).toEqual(['photos/dawn-02.webp', 'photos/dawn-01.webp']);
    expect(out.frames.map((f) => f.photo.file)).toEqual([
      'photos/dawn-02.webp',
      'photos/dawn-01.webp',
    ]);
    expect(out.frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    const indexes = out.parts
      .filter((p) => p.kind === 'illustration')
      .map((p) => (p.kind === 'illustration' ? p.ref.frameIndex : -1));
    expect(indexes).toEqual([0, 1]);
  });

  it('同一张图正文里引用两次：出两块图版，但只占一个灯箱帧（重复引用复用首帧号）', () => {
    const html =
      '<img src="photo:dawn-01.webp" alt="首"><img src="photo:dawn-01.webp" alt="重">';
    const out = processPostIllustrations({ html, sidecar: sidecar(), resolveUrl: fakeResolve });

    const refs = out.parts.filter((p) => p.kind === 'illustration');
    expect(refs).toHaveLength(2);
    expect(out.plateCount).toBe(2);
    expect(out.frames).toHaveLength(1); // 灯箱里这张只有一帧
    const numbers = refs.map((p) => (p.kind === 'illustration' ? p.ref.frameIndex : -1));
    expect(numbers).toEqual([0, 0]);
    expect(refs[1].kind === 'illustration' && refs[1].ref.duplicate).toBe(true);
  });

  it('单独成段的插图不残留空 <p>；图片在段落中间时前后文字仍在', () => {
    const out = processPostIllustrations({
      html: '<p><img src="photo:dawn-01.webp" alt="田埂"></p>',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].kind).toBe('illustration');

    const inline = processPostIllustrations({
      html: '<p>雾起<img src="photo:dawn-01.webp" alt="田埂">之前</p>',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    expect(inline.parts.map((p) => p.kind)).toEqual(['html', 'illustration', 'html']);
    const before = inline.parts[0];
    if (before.kind === 'html') expect(before.html).toContain('雾起');
  });
});

describe('缺 sidecar 条目：构建期告警 + 跳过灯箱，不伪造尺寸（契约①）', () => {
  it('池里没有这张图 → 一条含 ID 的告警，图留在正文里但不进 frames、无宽高', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<p>正文</p><img src="photo:ghost-09.webp" alt="幽灵">',
      sidecar: sidecar(),
      resolveUrl: () => '', // 构建图里也没有这个文件
      onWarn: (m) => warnings.push(m),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ghost-09.webp');
    expect(warnings[0]).toContain('photo:ghost-09.webp');
    expect(warnings[0]).toContain('npm run import --pool');
    expect(out.skipped).toEqual(['ghost-09.webp']);
    expect(out.frames).toEqual([]);
    // 图仍留在文本段里（不丢内容），但没有任何图版 / 帧号结构
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].kind).toBe('html');
    if (out.parts[0].kind === 'html') {
      expect(out.parts[0].html).toContain('ghost-09.webp');
      expect(out.parts[0].html).toContain('<img');
      expect(out.parts[0].html).not.toMatch(/\bwidth=/);
      expect(out.parts[0].html).not.toMatch(/\bheight=/);
    }
  });

  it('整份池 sidecar 缺失（还没导入任何照片）→ 全部告警跳过，正文照出不炸', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<img src="photo:dawn-01.webp" alt="雾">',
      sidecar: null,
      resolveUrl: () => '',
      onWarn: (m) => warnings.push(m),
    });
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    expect(warnings.join('\n')).toContain('npm run import --pool');
  });

  it('图在池里能解析、只是 sidecar 漏记：URL 仍解析成可服务地址，但不加宽高', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<img src="photo:extra-01.webp" alt="漏记">',
      sidecar: sidecar(),
      resolveUrl: (rel) => `/_astro/${rel.split('/').pop()}.hash.webp`,
      onWarn: (m) => warnings.push(m),
    });
    const html = out.parts.map((p) => (p.kind === 'html' ? p.html : '')).join('');
    expect(html).toContain('src="/_astro/extra-01.webp.hash.webp"');
    expect(html).not.toMatch(/\bwidth=/);
    expect(html).not.toMatch(/\bheight=/);
    expect(out.frames).toEqual([]);
    expect(out.skipped).toEqual(['extra-01.webp']);
    expect(warnings).toHaveLength(1);
  });

  it('sidecar 有记录但产物不在构建图里：告警 + 不占帧，也不留空壳图版（契约②）', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<p>前</p><img src="photo:dawn-01.webp" alt="被删掉的图">',
      sidecar: sidecar(),
      resolveUrl: () => '', // 文件被手删 / 没重跑导入
      onWarn: (m) => warnings.push(m),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('dawn-01.webp');
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].kind).toBe('html');
  });
});

describe('退役写法与外部引用：不接灯箱、不伪造宽高', () => {
  it('旧相对路径写法：告警提示改 `photo:ID`，图仍尽量能加载，但不计帧', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html: '<img src="photos/dawn-01.webp" alt="旧写法">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
      onWarn: (m) => warnings.push(m),
    });
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    expect(out.skipped).toEqual(['photos/dawn-01.webp']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('photo:');
    expect(warnings[0]).toContain('退役');
    const html = out.parts.map((p) => (p.kind === 'html' ? p.html : '')).join('');
    expect(html).toContain('src="/_astro/dawn-01.webp.hash.webp"');
  });

  it('外链 / 站点绝对路径 / data URI 原样留着（不换 src、不占帧、不告警）', () => {
    const warnings: string[] = [];
    const out = processPostIllustrations({
      html:
        '<img src="https://cdn.example.com/photos/dawn-01.webp" alt="外链">' +
        '<img src="/photos/dawn-01.webp" alt="站点绝对">' +
        '<img src="data:image/webp;base64,AAAA" alt="内联">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
      onWarn: (m) => warnings.push(m),
    });
    expect(out.frames).toEqual([]);
    expect(out.plateCount).toBe(0);
    expect(warnings).toEqual([]);
    const html = out.parts.map((p) => (p.kind === 'html' ? p.html : '')).join('');
    expect(html).toContain('https://cdn.example.com/photos/dawn-01.webp');
    expect(html).toContain('src="/photos/dawn-01.webp"');
    expect(html).toContain('data:image/webp;base64,AAAA');
  });

  it('Astro 占位属性（__ASTRO_IMAGE_）的形状必须能读：src/alt 都在 JSON 里', () => {
    const html =
      '<p><img __ASTRO_IMAGE_="{&quot;alt&quot;:&quot;田埂&quot;,&quot;src&quot;:&quot;photo:dawn-02.webp&quot;,&quot;index&quot;:0}"></p>';
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
    expect(html).toContain('alt="幽灵"');
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
    expect(processPostIllustrations({ html: null as unknown as string }).parts).toEqual([]);
  });
});

describe('frames JSON 岛（§2 契约数据本体）', () => {
  it('字段齐（src/thumb/width/height/alt/exif + title），且 < 已转义防 </script> 提前闭合', () => {
    const out = processPostIllustrations({
      html: '<img src="photo:dawn-01.webp" alt="光">&lt;script&gt;alert(1)&lt;/script&gt;',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    const json = buildIllustrationFramesJson(out.frames, { title: '晨雾里的第一束光' });
    expect(json).not.toContain('<');

    const parsed = JSON.parse(json) as { frames: Array<Record<string, unknown>> };
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
      html: '<img src="photo:dawn-01.webp" alt="">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    const parsed = JSON.parse(buildIllustrationFramesJson(out.frames, { title: '雾' })) as {
      frames: Array<{ alt: string }>;
    };
    expect(parsed.frames[0].alt).toBe('雾');
  });

  it('frames 岛里没有重复帧：正文重复引用两次仍然只有一帧', () => {
    const out = processPostIllustrations({
      html: '<img src="photo:dawn-01.webp" alt="甲"><img src="photo:dawn-01.webp" alt="乙">',
      sidecar: sidecar(),
      resolveUrl: fakeResolve,
    });
    const parsed = JSON.parse(buildIllustrationFramesJson(out.frames, { title: '雾' })) as {
      frames: unknown[];
    };
    expect(parsed.frames).toHaveLength(1);
  });
});
