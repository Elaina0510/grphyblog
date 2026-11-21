import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SITE_DATA_PATH } from '../../public/admin/js/config.js';
import {
  featuredOf,
  moveFeatured,
  normalizeFeatured,
  normalizeFeaturedPhoto,
  parseSiteData,
  setFeatured,
  siteDataText,
  validateFeatured,
} from '../../public/admin/js/site.js';

// =============================================================================
// 首页精选帧（后台第四板块）的纯函数单测。
//   · site.js 只动 site.json.featured.photos，其余站点事实原样保真
//   · 每条精选帧严格 {photo,title,alt} 三键（site-data.test.ts 的形状契约）
//   · 校验挡住「不在池里 / 重复 / 缺标题 / 缺 alt」
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const siteText = readFileSync(resolve(ROOT, SITE_DATA_PATH), 'utf8');

const FRAME_A = { photo: 'night-01.webp', title: '夜光', alt: '霓虹长光带' };
const FRAME_B = { photo: 'night-02.webp', title: '街角', alt: '暖光转角' };

describe('parseSiteData / featuredOf：读 site.json', () => {
  it('真 site.json 能解析，featured.photos 归一成三键对象', () => {
    const data = parseSiteData(siteText);
    const photos = featuredOf(data);
    expect(photos.length).toBeGreaterThan(0);
    for (const frame of photos) {
      expect(Object.keys(frame).sort()).toEqual(['alt', 'photo', 'title']);
    }
  });

  it('坏 JSON / 顶层不是对象 / 缺 featured.photos 都抛错', () => {
    expect(() => parseSiteData('{bad')).toThrow(/不是合法 JSON/);
    expect(() => parseSiteData('[]')).toThrow(/顶层必须是对象/);
    expect(() => parseSiteData('{}')).toThrow(/featured\.photos/);
    expect(() => parseSiteData('{"featured":{}}')).toThrow(/featured\.photos/);
  });
});

describe('normalizeFeaturedPhoto：每条恰好三键', () => {
  it('额外键被丢掉，photo 取末段文件名', () => {
    const frame = normalizeFeaturedPhoto({
      photo: 'photos/night-01.webp?x=1',
      title: '  夜光  ',
      alt: '  说明  ',
      collection: 'series', // 旧三元组残留，必须丢掉
      id: 'city-lights',
    });
    expect(frame).toEqual({ photo: 'night-01.webp', title: '夜光', alt: '说明' });
    expect(frame).not.toHaveProperty('collection');
    expect(frame).not.toHaveProperty('id');
  });

  it('缺字段补空串，normalizeFeatured 处理非数组', () => {
    expect(normalizeFeaturedPhoto({})).toEqual({ photo: '', title: '', alt: '' });
    expect(normalizeFeatured(null)).toEqual([]);
    expect(normalizeFeatured('x')).toEqual([]);
  });
});

describe('setFeatured / siteDataText：只替换 featured.photos，其余保真', () => {
  it('导航 / 版权页 / $comments 等字段原样保留', () => {
    const data = parseSiteData(siteText);
    const next = setFeatured(data, [FRAME_A]);
    // 除 featured 外的顶层键一个不少、值不变
    for (const key of Object.keys(data)) {
      if (key === 'featured') continue;
      expect(next[key]).toEqual(data[key]);
    }
    // 顶层 $comments（含 $comments.featured 的注释）整块保真
    expect(next.$comments).toEqual(data.$comments);
    expect(next.$comments.featured).toContain('首页精选区');
  });

  it('序列化是 2 空格缩进 + 结尾换行，能被再次解析', () => {
    const text = siteDataText(setFeatured(parseSiteData(siteText), [FRAME_A, FRAME_B]));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "featured": {\n    "photos": [\n      {\n        "photo": "night-01.webp"');
    expect(featuredOf(parseSiteData(text))).toEqual([FRAME_A, FRAME_B]);
  });
});

describe('moveFeatured：拖拽排序', () => {
  it('把第 1 帧拖到第 2 帧，顺序互换', () => {
    expect(moveFeatured([FRAME_A, FRAME_B], 0, 1)).toEqual([FRAME_B, FRAME_A]);
  });

  it('越界夹紧、from === to 返回副本、不改入参', () => {
    const list = [FRAME_A, FRAME_B];
    expect(moveFeatured(list, 0, 99)).toEqual([FRAME_B, FRAME_A]);
    expect(moveFeatured(list, 0, 0)).toEqual(list);
    expect(moveFeatured(list, 0, 0)).not.toBe(list);
    expect(list).toEqual([FRAME_A, FRAME_B]);
  });
});

describe('validateFeatured：保存前的校验', () => {
  const poolIds = ['night-01.webp', 'night-02.webp'];

  it('合法列表零错误', () => {
    expect(validateFeatured([FRAME_A, FRAME_B], poolIds)).toEqual([]);
  });

  it('挡住：不在池里 / 重复 / 缺标题 / 缺 alt', () => {
    const bad = [
      { photo: 'ghost.webp', title: 'A', alt: 'a' }, // 不在池里
      { photo: 'night-01.webp', title: '', alt: 'b' }, // 缺标题
      { photo: 'night-01.webp', title: 'C', alt: '' }, // 重复 + 缺 alt
    ];
    const errors = validateFeatured(bad, poolIds);
    expect(errors.some((e) => e.includes('不在池中'))).toBe(true);
    expect(errors.some((e) => e.includes('照片重复'))).toBe(true);
    expect(errors.some((e) => e.includes('缺标题'))).toBe(true);
    expect(errors.some((e) => e.includes('缺说明文字'))).toBe(true);
  });

  it('空列表合法（允许清空精选区）', () => {
    expect(validateFeatured([], poolIds)).toEqual([]);
  });
});
