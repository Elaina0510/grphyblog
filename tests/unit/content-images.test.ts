import { describe, expect, it } from 'vitest';

import {
  contentImageKey,
  contentImageMap,
  contentImageUrl,
  entryResourceDir,
  resolveContentImage,
} from '../../src/utils/contentImages';

// 契约 (c) 附带：contentImages 把内容夹图片解析成构建期可服务 URL，再经 imageUrl 出口。
// 这些用例同时充当「glob 模式对复合后缀 .thumb.webp 生效」的实证（若有冲突会在此暴露）。

describe('contentImageMap · 扫描种子内容图片', () => {
  it('展示版与 .thumb.webp 缩略图都被收录（复合后缀可识别）', () => {
    expect(contentImageMap).toHaveProperty('series/city-lights/photos/night-01.webp');
    expect(contentImageMap).toHaveProperty('series/city-lights/photos/night-01.thumb.webp');
    expect(contentImageMap).toHaveProperty('posts/2026-09-21-morning-fog/photos/dawn-01.webp');
  });

  it('每个映射值都是非空字符串 URL', () => {
    for (const url of Object.values(contentImageMap)) {
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    }
  });
});

describe('contentImageKey · 拼接归一', () => {
  it('目录相对 + 资源相对拼成 map key', () => {
    expect(contentImageKey('series/city-lights', 'photos/night-01.webp')).toBe(
      'series/city-lights/photos/night-01.webp',
    );
  });
  it('多余斜杠被规整', () => {
    expect(contentImageKey('/series/foo/', '/photos/a.webp')).toBe('series/foo/photos/a.webp');
  });
});

describe('resolveContentImage / contentImageUrl', () => {
  it('resolve 命中返回构建 URL，未命中返回 undefined', () => {
    expect(resolveContentImage('series/city-lights', 'photos/night-01.webp')).toBeTypeOf('string');
    expect(resolveContentImage('series/city-lights', 'photos/missing.webp')).toBeUndefined();
  });

  it('默认（无 env base）输出同源可加载 URL', () => {
    const url = contentImageUrl('series/city-lights', 'photos/night-01.webp');
    expect(url.startsWith('/')).toBe(true);
    expect(url).toContain('night-01');
  });

  it('base 可切换：把构建 URL 前缀换成 CDN', () => {
    const url = contentImageUrl('series/city-lights', 'photos/night-01.webp', {
      base: 'https://cdn.example/',
    });
    expect(url.startsWith('https://cdn.example/')).toBe(true);
    // 去掉了构建 URL 原本的前导斜杠，避免出现 //
    expect(url).not.toContain('cdn.example//');
  });

  it('查不到时退回把相对路径直接交给 imageUrl（单出口、不抛错）', () => {
    const url = contentImageUrl('series/nope', 'photos/ghost.webp', {
      base: 'https://cdn.example/',
    });
    expect(url).toBe('https://cdn.example/photos/ghost.webp');
  });

  it('随笔资源夹（同名目录）同样解析', () => {
    const url = contentImageUrl('posts/2026-09-21-morning-fog', 'photos/dawn-01.thumb.webp');
    expect(url.startsWith('/')).toBe(true);
    expect(url).toContain('dawn-01.thumb');
  });
});

describe('entryResourceDir · 由 collection+id/slug 归一资源目录（页面/灯箱一次调用）', () => {
  // 对 Astro 7 的两可能 id 形态都稳健：series 带 `/index.md`，posts 为扁平 `.md`；
  // 也接受已剥扩展的 slug 传入，结果一致。
  it('系列 id=city-lights/index.md → series/city-lights', () => {
    expect(entryResourceDir('series', 'city-lights/index.md')).toBe('series/city-lights');
  });
  it('系列传 slug（无扩展/index）也归一到同目录', () => {
    expect(entryResourceDir('series', 'city-lights')).toBe('series/city-lights');
  });
  it('随笔 id=x.md → posts/x（资源夹与 md 同名）', () => {
    expect(entryResourceDir('posts', '2026-09-21-morning-fog.md')).toBe(
      'posts/2026-09-21-morning-fog',
    );
  });

  it('归一目录能直接查中真实种子图片', () => {
    const dir = entryResourceDir('series', 'city-lights/index.md');
    expect(resolveContentImage(dir, 'photos/night-01.webp')).toBeTypeOf('string');
    // 与 contentImageMap 的既有 key 对齐
    expect(contentImageKey(dir, 'photos/night-01.webp')).toBe(
      'series/city-lights/photos/night-01.webp',
    );
    expect(contentImageMap).toHaveProperty(contentImageKey(dir, 'photos/night-01.webp'));
  });
});
