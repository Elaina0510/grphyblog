import { describe, expect, it } from 'vitest';

import { POOL_DIR, contentImageUrl, photoIdOf, resolveContentImage } from '../../src/utils/contentImages';
import { findPoolPhoto, poolSidecar, resolveCoverPhotoId } from '../../src/utils/photoPool';
import type { PhotoEntry } from '../../src/types/photoSidecar';

// =============================================================================
// 照片池化 · D 组共享口径（admin-v2.md D1 / D3 / D4）
//
// 池化后前台只剩两件事要做：拿 frontmatter 的照片 ID 去**全局** sidecar 查那一条
// （真宽高 / 缩略图 / EXIF），以及封面三级回退（A5：cover → photos[0] → 空）。
// 这两件事收在 src/utils/photoPool.ts，本文件钉它的口径，并顺带验证它读的是**真文件**
// （import.meta.glob 在 Vitest 下走 Vite 转换，因此这里断言的是真实 78 条池数据，
//  不是 mock —— 单测不许把真实文件读写 mock 到失真）。
// =============================================================================

const photo = (file: string): PhotoEntry => ({
  file,
  thumb: file.replace(/\.webp$/, '.thumb.webp'),
  width: 2560,
  height: 1707,
  thumbWidth: 800,
  thumbHeight: 533,
  exif: {},
});

describe('poolSidecar · 读的是真文件（src/content/pool/photos.meta.json）', () => {
  it('非空数组，每条都带池内相对路径（photos/<名>.webp）', () => {
    expect(Array.isArray(poolSidecar)).toBe(true);
    expect(poolSidecar.length).toBeGreaterThan(0);
    for (const entry of poolSidecar) {
      expect(entry.file).toMatch(/^photos\/[^/]+\.webp$/);
      expect(entry.thumb).toMatch(/^photos\/[^/]+\.thumb\.webp$/);
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
    }
  });

  it('照片 ID（file 末段）在池里唯一 —— 前台按 ID 查表不会歧义', () => {
    const ids = poolSidecar.map((entry) => photoIdOf(entry.file));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('池里的照片都能经 contentImageUrl 解析成可服务 URL（图片 URL 单一出口）', () => {
    for (const entry of poolSidecar.slice(0, 5)) {
      expect(resolveContentImage(POOL_DIR, entry.file)).toBeTypeOf('string');
      expect(contentImageUrl(POOL_DIR, entry.file).length).toBeGreaterThan(0);
      expect(contentImageUrl(POOL_DIR, entry.thumb).length).toBeGreaterThan(0);
    }
  });
});

describe('findPoolPhoto · 按照片 ID 查池', () => {
  it('真实种子的 ID 能查中（city-lights 的两帧）', () => {
    expect(findPoolPhoto(poolSidecar, 'night-01.webp')?.file).toBe('photos/night-01.webp');
    expect(findPoolPhoto(poolSidecar, 'night-02.webp')?.file).toBe('photos/night-02.webp');
  });

  it('多形写法归一：ID / 池内相对路径 / 旧条目路径 / photo: 引用都查中同一条', () => {
    const byId = findPoolPhoto(poolSidecar, 'night-01.webp');
    for (const raw of [
      'photos/night-01.webp',
      'series/city-lights/photos/night-01.webp',
      'photo:night-01.webp',
      '/src/content/pool/photos/night-01.webp',
      'night-01.webp?v=2',
    ]) {
      expect(findPoolPhoto(poolSidecar, raw)?.file, raw).toBe(byId?.file);
    }
  });

  it('缩略图是另一个 ID，不会命中展示图那条', () => {
    expect(findPoolPhoto(poolSidecar, 'night-01.thumb.webp')).toBeUndefined();
  });

  it('池里没有 / 空入参 / 空表 → undefined（绝不猜一条回来）', () => {
    expect(findPoolPhoto(poolSidecar, 'ghost-09.webp')).toBeUndefined();
    expect(findPoolPhoto(poolSidecar, '')).toBeUndefined();
    expect(findPoolPhoto(null, 'night-01.webp')).toBeUndefined();
    expect(findPoolPhoto(undefined, 'night-01.webp')).toBeUndefined();
  });

  it('传入自定义表时只在该表里查（纯函数，便于单测）', () => {
    const table = [photo('photos/a.webp'), photo('photos/b.webp')];
    expect(findPoolPhoto(table, 'b.webp')?.file).toBe('photos/b.webp');
    expect(findPoolPhoto(table, 'night-01.webp')).toBeUndefined();
  });
});

describe('resolveCoverPhotoId · A5 封面三级回退（K1）', () => {
  it('cover 有值 → 取它（路径形也归一成 ID）', () => {
    expect(resolveCoverPhotoId('night-02.webp', ['night-01.webp', 'night-02.webp'])).toBe(
      'night-02.webp',
    );
    expect(resolveCoverPhotoId('photos/night-02.webp', ['night-01.webp'])).toBe('night-02.webp');
  });

  it('cover 空串 → 退回 photos[0]', () => {
    expect(resolveCoverPhotoId('', ['night-01.webp', 'night-02.webp'])).toBe('night-01.webp');
    expect(resolveCoverPhotoId(undefined, ['P1.webp'])).toBe('P1.webp');
    expect(resolveCoverPhotoId(null, ['P1.webp'])).toBe('P1.webp');
  });

  it('cover 与 photos 都空 → 空串（调用方据此整块封面区不渲染）', () => {
    expect(resolveCoverPhotoId('', [])).toBe('');
    expect(resolveCoverPhotoId('', null)).toBe('');
    expect(resolveCoverPhotoId(undefined, undefined)).toBe('');
  });

  it('真实种子：city-lights 走 cover，wip-empty 无封面可解析', () => {
    const cityCover = resolveCoverPhotoId('night-02.webp', ['night-01.webp', 'night-02.webp']);
    expect(findPoolPhoto(poolSidecar, cityCover)?.file).toBe('photos/night-02.webp');
    expect(resolveCoverPhotoId('', [])).toBe('');
  });
});
