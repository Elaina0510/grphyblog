import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageUrl } from '../../src/utils/imageUrl';

// PUBLIC_IMAGE_BASE 是 imageUrl 的默认 base 回落来源（边界③的单一切换点）。
// 用 vi.stubEnv 改写 import.meta.env，afterEach 统一 unstub 还原。
beforeEach(() => {
  vi.stubEnv('PUBLIC_IMAGE_BASE', ''); // 空串 → imageUrl 视为未设置，回落 '/'
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('imageUrl · 本地/同源拼接', () => {
  it('无 base 时输出同源根路径', () => {
    expect(imageUrl('photos/a.webp')).toBe('/photos/a.webp');
  });
  it('对已带前导斜杠的构建 URL 规整为单个前导斜杠', () => {
    expect(imageUrl('/_astro/a-abc123.webp')).toBe('/_astro/a-abc123.webp');
    expect(imageUrl('//_astro/a.webp')).toBe('/_astro/a.webp');
  });
  it('显式 base:"/" 与默认一致', () => {
    expect(imageUrl('a.webp', { base: '/' })).toBe('/a.webp');
  });
});

describe('imageUrl · base 可切换（迁 R2/图床只改一处）', () => {
  it('opts.base 传入 CDN 绝对 base', () => {
    expect(imageUrl('_astro/a.webp', { base: 'https://cdn.example/' })).toBe(
      'https://cdn.example/_astro/a.webp',
    );
  });
  it('base 无尾斜杠也能补一个分隔斜杠', () => {
    expect(imageUrl('a.webp', { base: 'https://cdn.example' })).toBe('https://cdn.example/a.webp');
  });
  it('base 含子路径前缀', () => {
    expect(imageUrl('a.webp', { base: 'https://cdn.example/imgs/' })).toBe(
      'https://cdn.example/imgs/a.webp',
    );
  });
  it('多余斜杠被规整（base 尾 + path 头）', () => {
    expect(imageUrl('//a.webp', { base: 'https://cdn.example///' })).toBe(
      'https://cdn.example/a.webp',
    );
  });
  it('env PUBLIC_IMAGE_BASE 生效，且 opts.base 优先级更高', () => {
    vi.stubEnv('PUBLIC_IMAGE_BASE', 'https://img.env.example/');
    expect(imageUrl('a.webp')).toBe('https://img.env.example/a.webp');
    expect(imageUrl('a.webp', { base: 'https://override.example/' })).toBe(
      'https://override.example/a.webp',
    );
  });
});

describe('imageUrl · 绝对 URL 原样返回', () => {
  it('http(s) 绝对链接不加 base', () => {
    expect(imageUrl('https://elsewhere.com/a.webp', { base: 'https://cdn.example/' })).toBe(
      'https://elsewhere.com/a.webp',
    );
    expect(imageUrl('http://elsewhere.com/a.webp')).toBe('http://elsewhere.com/a.webp');
    expect(imageUrl('HTTPS://MixedCase.com/a.webp')).toBe('HTTPS://MixedCase.com/a.webp');
  });
});

describe('imageUrl · 内联 data:/blob: 原样返回（回归 /data: 缺陷）', () => {
  it('data: URI 不加 base（否则变不可加载的 /data:）', () => {
    const data = 'data:image/webp;base64,UklGRi...';
    expect(imageUrl(data)).toBe(data);
    expect(imageUrl(data, { base: 'https://cdn.example/' })).toBe(data);
  });
  it('blob: URI 不加 base', () => {
    const blob = 'blob:https://example/1-2-3';
    expect(imageUrl(blob)).toBe(blob);
    expect(imageUrl(blob, { base: '/' })).toBe(blob);
  });
});
