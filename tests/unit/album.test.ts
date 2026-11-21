import { describe, expect, it } from 'vitest';

import {
  TWO_UP,
  announceSpread,
  clampSpread,
  paginateAlbum,
  spreadLabel,
  type AlbumPhoto,
} from '../../src/utils/album';

// =============================================================================
// album 纯逻辑单测：摄影集画册「一屏两页」的分页算术。
// 页面只据 paginateAlbum 铺页、据 clampSpread 翻页；这里把死数字钉住。
// =============================================================================

const photo = (id: string): AlbumPhoto => ({
  id,
  src: `/_astro/${id}`,
  width: 2560,
  height: 1707,
  alt: id,
  exif: {},
});
const list = (n: number) => Array.from({ length: n }, (_, i) => photo(`p${i}.webp`));

describe('paginateAlbum · 一屏两张', () => {
  it('两张一屏，序号连续', () => {
    expect(TWO_UP).toBe(2);
    const spreads = paginateAlbum(list(4));
    expect(spreads.map((s) => s.photos.map((p) => p.id))).toEqual([
      ['p0.webp', 'p1.webp'],
      ['p2.webp', 'p3.webp'],
    ]);
    expect(spreads.map((s) => s.index)).toEqual([0, 1]);
  });

  it('奇数张：末屏只剩 1 张，不补空位、不吞帧', () => {
    const spreads = paginateAlbum(list(5));
    expect(spreads).toHaveLength(3);
    expect(spreads[2].photos).toEqual([photo('p4.webp')]);
    expect(spreads.flatMap((s) => s.photos)).toHaveLength(5);
  });

  it('单张 = 一屏；0 张 = 0 屏；脏输入按空处理', () => {
    expect(paginateAlbum(list(1))[0].photos).toEqual([photo('p0.webp')]);
    expect(paginateAlbum([])).toEqual([]);
    expect(paginateAlbum(null as unknown as AlbumPhoto[])).toEqual([]);
  });
});

describe('clampSpread · 翻页到头就停', () => {
  it('夹到 [0, total-1]', () => {
    expect(clampSpread(-5, 10)).toBe(0);
    expect(clampSpread(3, 10)).toBe(3);
    expect(clampSpread(99, 10)).toBe(9);
  });

  it('空册 / 脏输入回 0，不产生负页', () => {
    expect(clampSpread(3, 0)).toBe(0);
    expect(clampSpread(NaN, 10)).toBe(0);
    expect(clampSpread(2.9, 10)).toBe(2);
  });
});

describe('spreadLabel / announceSpread · 展示与读屏', () => {
  it('补零页码串', () => {
    expect(spreadLabel(0, 38)).toBe('01 / 38');
    expect(spreadLabel(9, 38)).toBe('10 / 38');
    expect(spreadLabel(0, 1)).toBe('01 / 01');
  });

  it('播报当前页与总页', () => {
    expect(announceSpread(0, 3)).toBe('第 1 页，共 3 页');
    expect(announceSpread(2, 3)).toBe('第 3 页，共 3 页');
  });
});
