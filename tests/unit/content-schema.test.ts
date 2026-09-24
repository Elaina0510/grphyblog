import { describe, expect, it } from 'vitest';

import { postsSchema, seriesSchema } from '../../src/content/schemas';

// §4.2 / §5.1 硬性测试点：schema 严格校验（必填 / 类型 / .strict() 拒未知键）。
// 直接对与 content.config.ts 同一份 schema 定义做断言（非复制）。

describe('seriesSchema · 合法 frontmatter', () => {
  it('完整字段通过，并把 date 归一成 Date、draft 默认生效', () => {
    const parsed = seriesSchema.parse({
      title: '夜光 · 城市',
      date: '2026-09-20',
      cover: 'photos/night-01.webp',
      tags: ['城市', '夜景'],
      order: 1,
    });
    expect(parsed.title).toBe('夜光 · 城市');
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.date.toISOString().slice(0, 10)).toBe('2026-09-20');
    // 未写 draft 时默认 false
    expect(parsed.draft).toBe(false);
  });

  it('显式 draft:true 合法（草稿仍属结构合法，仅公开查询过滤）', () => {
    const parsed = seriesSchema.parse({
      title: 't',
      date: new Date('2026-01-01'),
      cover: 'photos/a.webp',
      tags: [],
      order: 0,
      draft: true,
    });
    expect(parsed.draft).toBe(true);
  });
});

describe('seriesSchema · 缺必填字段报错', () => {
  const base = {
    title: 't',
    date: '2026-09-20',
    cover: 'photos/a.webp',
    tags: ['x'],
    order: 1,
  };
  for (const key of ['title', 'date', 'cover', 'tags', 'order']) {
    it(`缺少 ${key} 时被拒绝`, () => {
      const { [key]: _omit, ...rest } = base;
      expect(seriesSchema.safeParse(rest).success).toBe(false);
    });
  }
});

describe('seriesSchema · 错类型报错', () => {
  it('order 传字符串被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'photos/a.webp',
        tags: [],
        order: 'first',
      }).success,
    ).toBe(false);
  });

  it('tags 传非数组被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'photos/a.webp',
        tags: '城市',
        order: 1,
      }).success,
    ).toBe(false);
  });

  it('tags 数组元素非字符串被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'photos/a.webp',
        tags: [1, 2],
        order: 1,
      }).success,
    ).toBe(false);
  });

  it('draft 传字符串被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'photos/a.webp',
        tags: [],
        order: 1,
        draft: 'yes',
      }).success,
    ).toBe(false);
  });
});

describe('seriesSchema · .strict() 拒未知/写错字段名', () => {
  const valid = {
    title: 't',
    date: '2026-09-20',
    cover: 'photos/a.webp',
    tags: [],
    order: 1,
  };
  it('多余未知键 author 被拒', () => {
    expect(seriesSchema.safeParse({ ...valid, author: 'me' }).success).toBe(false);
  });
  it('写错字段名 cover→coverr 被拒（既缺 cover 又含未知键）', () => {
    const { cover: _c, ...rest } = valid;
    expect(seriesSchema.safeParse({ ...rest, coverr: 'photos/a.webp' }).success).toBe(false);
  });
});

describe('postsSchema · 无 order、其余与 series 同口径', () => {
  it('合法通过', () => {
    const parsed = postsSchema.parse({
      title: '晨雾',
      date: '2026-09-21',
      cover: 'photos/dawn-01.webp',
      tags: ['风光'],
    });
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.draft).toBe(false);
  });

  it('缺 cover 报错', () => {
    expect(
      postsSchema.safeParse({ title: 't', date: '2026-09-21', tags: [] }).success,
    ).toBe(false);
  });

  it('带 order 反而被 .strict() 拒（随笔无 order 字段）', () => {
    expect(
      postsSchema.safeParse({
        title: 't',
        date: '2026-09-21',
        cover: 'photos/a.webp',
        tags: [],
        order: 1,
      }).success,
    ).toBe(false);
  });

  it('未知字段被拒', () => {
    expect(
      postsSchema.safeParse({
        title: 't',
        date: '2026-09-21',
        cover: 'photos/a.webp',
        tags: [],
        extraNope: 1,
      }).success,
    ).toBe(false);
  });
});
