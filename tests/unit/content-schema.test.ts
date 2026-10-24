import { describe, expect, it } from 'vitest';

import { postsSchema, seriesSchema } from '../../src/content/schemas';

// §4.2 / §5.1 硬性测试点：schema 严格校验（必填 / 类型 / .strict() 拒未知键）。
// 直接对与 content.config.ts 同一份 schema 定义做断言（非复制）。
//
// 照片池化口径（admin-v2.md A3/A4/A5，2026-10-24 用户拍板）：
//   - 照片 ID = 池内**完整文件名（含 .webp）**，如 `night-01.webp`；
//   - `photos: [照片ID]` 的顺序 **= 前台照片流顺序**；
//   - `cover` 同样是照片 ID，**允许空串**（空 = 前台退回 photos[0]；
//     A5 三级回退：cover → photos[0] → 整块封面区不渲染）；
//   - 「ID 是否真实存在于池中」不在 schema 层校验（zod 读不到磁盘），由构建期检查 R6（C4）拦截。
//     本文件只有一条用例**钉住「schema 层不拦」这个事实**；C4 的规则本身不在 A 组测。

describe('seriesSchema · 合法 frontmatter', () => {
  it('完整字段通过，并把 date 归一成 Date、draft 默认生效', () => {
    const parsed = seriesSchema.parse({
      title: '夜光 · 城市',
      date: '2026-09-20',
      cover: 'night-01.webp',
      photos: ['night-01.webp', 'night-02.webp'],
      tags: ['城市', '夜景'],
      order: 1,
    });
    expect(parsed.title).toBe('夜光 · 城市');
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.date.toISOString().slice(0, 10)).toBe('2026-09-20');
    // 未写 draft 时默认 false
    expect(parsed.draft).toBe(false);
    expect(parsed.photos).toEqual(['night-01.webp', 'night-02.webp']);
  });

  it('显式 draft:true 合法（草稿仍属结构合法，仅公开查询过滤）', () => {
    const parsed = seriesSchema.parse({
      title: 't',
      date: new Date('2026-01-01'),
      cover: 'a.webp',
      photos: [],
      tags: [],
      order: 0,
      draft: true,
    });
    expect(parsed.draft).toBe(true);
  });

  it('photos 为空数组合法（0 图条目，如 wip-empty）', () => {
    const parsed = seriesSchema.parse({
      title: '留白 · 待补',
      date: '2026-07-01',
      cover: '',
      photos: [],
      tags: [],
      order: 1,
    });
    expect(parsed.photos).toEqual([]);
  });

  it('photos 顺序原样保留（顺序 = 前台照片流顺序，schema 不许重排/去重）', () => {
    const ids = ['P1100451.webp', 'dawn-01.webp', 'night-02.webp'];
    const parsed = seriesSchema.parse({
      title: 't',
      date: '2026-09-20',
      cover: 'dawn-01.webp',
      photos: ids,
      tags: [],
      order: 1,
    });
    expect(parsed.photos).toEqual(ids);
  });

  it('photos 可省略，缺省为 []（迁移期老条目尚无 photos 键，门禁 1 构建不许红）', () => {
    const parsed = seriesSchema.parse({
      title: 't',
      date: '2026-09-20',
      cover: 'night-01.webp',
      tags: [],
      order: 1,
    });
    expect(parsed.photos).toEqual([]);
  });

  it('cover 空串合法（A5：空 = 前台退回 photos[0]）', () => {
    const parsed = seriesSchema.parse({
      title: 't',
      date: '2026-09-20',
      cover: '',
      photos: ['night-01.webp'],
      tags: [],
      order: 1,
    });
    expect(parsed.cover).toBe('');
  });

  it('photos 里的 ID 不在池中：schema 层放行（拦它的是 C4 的构建期检查 R6）', () => {
    // 这条**故意断言成功**：zod 不读磁盘，判断不了 ID 是否存在。
    // 若有人把「池内存在性」塞进 schema，这条会红——职责边界仍在 C4。
    const parsed = seriesSchema.safeParse({
      title: 't',
      date: '2026-09-20',
      cover: 'not-in-pool.webp',
      photos: ['not-in-pool.webp'],
      tags: [],
      order: 1,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('seriesSchema · 缺必填字段报错', () => {
  // photos 带默认值，不在必填清单里（见下一条独立用例）。
  const base = {
    title: 't',
    date: '2026-09-20',
    cover: 'a.webp',
    photos: ['a.webp'],
    tags: ['x'],
    order: 1,
  };
  for (const key of ['title', 'date', 'cover', 'tags', 'order']) {
    it(`缺少 ${key} 时被拒绝`, () => {
      const { [key]: _omit, ...rest } = base;
      expect(seriesSchema.safeParse(rest).success).toBe(false);
    });
  }

  it('缺少 photos 不报错，补成默认空数组（photos 是有默认值的键）', () => {
    const { photos: _omit, ...rest } = base;
    const parsed = seriesSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.photos).toEqual([]);
  });
});

describe('seriesSchema · 错类型报错', () => {
  it('order 传字符串被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'a.webp',
        photos: [],
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
        cover: 'a.webp',
        photos: [],
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
        cover: 'a.webp',
        photos: [],
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
        cover: 'a.webp',
        photos: [],
        tags: [],
        order: 1,
        draft: 'yes',
      }).success,
    ).toBe(false);
  });

  it('photos 传裸字符串被拒（必须是数组）', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'a.webp',
        photos: 'night-01.webp',
        tags: [],
        order: 1,
      }).success,
    ).toBe(false);
  });

  it('photos 数组元素非字符串被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: 'a.webp',
        photos: [1],
        tags: [],
        order: 1,
      }).success,
    ).toBe(false);
  });

  it('cover 传非字符串（数组）被拒', () => {
    expect(
      seriesSchema.safeParse({
        title: 't',
        date: '2026-09-20',
        cover: ['a.webp'],
        photos: [],
        tags: [],
        order: 1,
      }).success,
    ).toBe(false);
  });
});

describe('seriesSchema · .strict() 拒未知/写错字段名', () => {
  const valid = {
    title: 't',
    date: '2026-09-20',
    cover: 'a.webp',
    photos: ['a.webp'],
    tags: [],
    order: 1,
  };
  it('多余未知键 author 被拒', () => {
    expect(seriesSchema.safeParse({ ...valid, author: 'me' }).success).toBe(false);
  });
  it('写错字段名 cover→coverr 被拒（既缺 cover 又含未知键）', () => {
    const { cover: _c, ...rest } = valid;
    expect(seriesSchema.safeParse({ ...rest, coverr: 'a.webp' }).success).toBe(false);
  });
  it('写错字段名 photos→photo（单数）被拒：有默认值也不许乱起名', () => {
    const { photos: _p, ...rest } = valid;
    expect(seriesSchema.safeParse({ ...rest, photo: ['a.webp'] }).success).toBe(false);
  });
  it('旧口径伪字段 photosDir 被拒', () => {
    expect(seriesSchema.safeParse({ ...valid, photosDir: 'photos/' }).success).toBe(false);
  });
});

describe('postsSchema · 无 order、其余与 series 同口径', () => {
  it('合法通过（cover 与 photos 都是照片 ID）', () => {
    const parsed = postsSchema.parse({
      title: '晨雾',
      date: '2026-09-21',
      cover: 'dawn-01.webp',
      photos: ['dawn-01.webp', 'dawn-02.webp'],
      tags: ['风光'],
    });
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.draft).toBe(false);
    expect(parsed.photos).toEqual(['dawn-01.webp', 'dawn-02.webp']);
  });

  it('photos 为空数组合法（0 图随笔，如 2026-07-02-alley-light）', () => {
    const parsed = postsSchema.parse({
      title: '纯文字',
      date: '2026-07-02',
      cover: '',
      photos: [],
      tags: ['街拍'],
    });
    expect(parsed.photos).toEqual([]);
  });

  it('photos 可省略，缺省为 []', () => {
    const parsed = postsSchema.parse({
      title: 't',
      date: '2026-09-21',
      cover: 'dawn-01.webp',
      tags: [],
    });
    expect(parsed.photos).toEqual([]);
  });

  it('cover 空串合法（A5 三级回退：空 → photos[0]）', () => {
    const parsed = postsSchema.parse({
      title: 't',
      date: '2026-09-21',
      cover: '',
      photos: ['dawn-01.webp'],
      tags: [],
    });
    expect(parsed.cover).toBe('');
  });

  it('缺 cover 报错（cover 仍是必填键，只是值可为空串）', () => {
    expect(
      postsSchema.safeParse({ title: 't', date: '2026-09-21', tags: [] }).success,
    ).toBe(false);
  });

  it('photos 传裸字符串被拒（必须是数组）', () => {
    expect(
      postsSchema.safeParse({
        title: 't',
        date: '2026-09-21',
        cover: 'a.webp',
        photos: 'a.webp',
        tags: [],
      }).success,
    ).toBe(false);
  });

  it('photos 数组元素非字符串被拒', () => {
    expect(
      postsSchema.safeParse({
        title: 't',
        date: '2026-09-21',
        cover: 'a.webp',
        photos: [null],
        tags: [],
      }).success,
    ).toBe(false);
  });

  it('带 order 反而被 .strict() 拒（随笔无 order 字段）', () => {
    expect(
      postsSchema.safeParse({
        title: 't',
        date: '2026-09-21',
        cover: 'a.webp',
        photos: [],
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
        cover: 'a.webp',
        photos: [],
        tags: [],
        extraNope: 1,
      }).success,
    ).toBe(false);
  });
});
