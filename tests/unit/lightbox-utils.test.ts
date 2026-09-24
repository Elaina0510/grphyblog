import { describe, expect, it } from 'vitest';

// =============================================================================
// lightbox 模块 · 纯逻辑单测（帧解析 / 索引与预加载选择 / 滑动判定 / 播报文案 / 岛生成）
//
// 这些函数是 Lightbox.astro 客户端脚本的「可判定部分」，被抽到 src/utils/lightbox.ts
// 正是为了能在 Node 端直接钉住（DOM 侧行为归 tests/e2e/lightbox.spec.ts）。
// 三处入口（首页 / 系列详情 / 随笔插图）共用同一套规则，所以这里绿 = 三处一致的一半。
// =============================================================================

import {
  announceText,
  buildFramesIslandJson,
  chipText,
  clampIndex,
  createFrameRegistry,
  neighborIndices,
  pad2,
  parseFramesIsland,
  swipeDecision,
} from '../../src/utils/lightbox';

const FRAME_A = {
  src: '/_astro/a.webp',
  thumb: '/_astro/a.thumb.webp',
  width: 2560,
  height: 1707,
  alt: '甲',
  title: '夜光 · 城市',
  exif: { camera: 'FUJIFILM X-T5', aperture: 1.2 },
};
const FRAME_B = {
  src: '/_astro/b.webp',
  thumb: '/_astro/b.thumb.webp',
  width: 1922,
  height: 2560,
  alt: '乙',
  exif: {},
};

describe('parseFramesIsland · frames 岛是唯一数据来源', () => {
  it('正常岛：按顺序还原全部帧，字段齐备', () => {
    const json = JSON.stringify({ frames: [FRAME_A, FRAME_B] });
    const { frames, rejected } = parseFramesIsland(json);
    expect(rejected).toEqual([]);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      src: '/_astro/a.webp',
      thumb: '/_astro/a.thumb.webp',
      width: 2560,
      height: 1707,
      alt: '甲',
      title: '夜光 · 城市',
    });
    expect(frames[0].exif).toEqual({ camera: 'FUJIFILM X-T5', aperture: 1.2 });
    expect(frames[1].title).toBeUndefined();
  });

  it('转义过的 u003c 也能解析（页面里 < 被转义，防 script 标签提前闭合）', () => {
    const json = JSON.stringify({ frames: [{ ...FRAME_A, alt: '<script>x</script>' }] });
    const escaped = json.replace(/</g, '\\u003c');
    expect(escaped).not.toContain('<');
    const { frames } = parseFramesIsland(escaped);
    expect(frames[0].alt).toBe('<script>x</script>');
  });

  it('坏 JSON / 空文本 / 形状不对 → 空表且抛错都不发生（调用方据此不开灯箱）', () => {
    expect(parseFramesIsland('{oops').frames).toEqual([]);
    expect(parseFramesIsland('').frames).toEqual([]);
    expect(parseFramesIsland(null).frames).toEqual([]);
    expect(parseFramesIsland(undefined).frames).toEqual([]);
    expect(parseFramesIsland('{"notFrames":1}').frames).toEqual([]);
    expect(parseFramesIsland('[]').frames).toEqual([]);
  });

  it('缺 src 的条目整帧丢弃并记进 rejected（不伪造占位帧）', () => {
    const json = JSON.stringify({ frames: [{ thumb: 't' }, FRAME_A, { src: '   ' }] });
    const { frames, rejected } = parseFramesIsland(json);
    expect(rejected).toEqual([0, 2]);
    expect(frames).toHaveLength(1);
    expect(frames[0].src).toBe('/_astro/a.webp');
  });

  it('缺宽高 / 非有限宽高 → 归 0（表示未知，绝不猜尺寸），缺 thumb → 退回 src', () => {
    const json = JSON.stringify({
      frames: [{ src: '/x.webp', width: 0, height: Number.NaN, alt: 'x' }],
    });
    const { frames } = parseFramesIsland(json);
    expect(frames[0].width).toBe(0);
    expect(frames[0].height).toBe(0);
    expect(frames[0].thumb).toBe('/x.webp');
    expect(frames[0].exif).toEqual({});
  });

  it('alt 缺失归空串（组件仍会显式写 alt=""，不留 null 描述）', () => {
    const { frames } = parseFramesIsland(JSON.stringify({ frames: [{ src: '/x.webp' }] }));
    expect(frames[0].alt).toBe('');
  });
});

describe('索引与相邻预加载（验收：切帧不白屏）', () => {
  it('clampIndex：越界折回边界，非法值归 0，空表归 0', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(4, 5)).toBe(4);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(Number.NaN, 5)).toBe(0);
    expect(clampIndex(1, 0)).toBe(0);
  });

  it('neighborIndices：左右各一、到头不循环、不含自己', () => {
    expect(neighborIndices(0, 5)).toEqual([1]);
    expect(neighborIndices(2, 5)).toEqual([1, 3]);
    expect(neighborIndices(4, 5)).toEqual([3]);
    expect(neighborIndices(0, 2)).toEqual([1]);
    expect(neighborIndices(1, 2)).toEqual([0]);
    expect(neighborIndices(0, 1)).toEqual([]);
    expect(neighborIndices(1, 5, 2)).toEqual([0, 2, 3]);
  });

  it('单帧图库没有邻居可预加载（随笔插图只有一张时属正常）', () => {
    expect(neighborIndices(0, 1, 1)).toEqual([]);
  });
});

describe('文案口径：页码片 / aria-live 播报', () => {
  it('pad2 与 chipText 同 PageChip 补零口径', () => {
    expect(pad2(1)).toBe('01');
    expect(pad2(10)).toBe('10');
    expect(chipText(0, 2)).toBe('01 / 02');
    expect(chipText(1, 12)).toBe('02 / 12');
  });

  it('announceText：「第 N 帧，共 M 帧 · 题名」，无题名不编造', () => {
    expect(announceText(1, 5, '夜光 · 城市')).toBe('第 2 帧，共 5 帧 · 夜光 · 城市');
    expect(announceText(0, 3)).toBe('第 1 帧，共 3 帧');
    expect(announceText(0, 3, '   ')).toBe('第 1 帧，共 3 帧');
  });
});

describe('swipeDecision · 手势判定（左右滑切帧 / 下滑关闭）', () => {
  it('横向过阈值：向左滑=下一帧，向右滑=上一帧', () => {
    expect(swipeDecision(-120, 6, 44)).toBe('next');
    expect(swipeDecision(120, 6, 44)).toBe('prev');
  });

  it('纵向占优且过阈值 → 下滑关闭；上滑不做动作', () => {
    expect(swipeDecision(10, 160, 44)).toBe('down');
    expect(swipeDecision(10, -160, 44)).toBe('none');
  });

  it('未过阈值 / 太小 → 不动作（不误触切帧）', () => {
    expect(swipeDecision(-30, 2, 44)).toBe('none');
    expect(swipeDecision(0, 0, 44)).toBe('none');
    expect(swipeDecision(30, 40, 44)).toBe('none'); // 纵向占优但未过阈值
  });

  it('非有限输入不炸', () => {
    expect(swipeDecision(Number.NaN, Number.POSITIVE_INFINITY, 44)).toBe('none');
  });
});

describe('岛生成与首页去重（三处入口一致的最后一半）', () => {
  it('buildFramesIslandJson：输出 {"frames":[…]}，title 只给非空值，< 一律转义', () => {
    const json = buildFramesIslandJson([FRAME_A, FRAME_B]);
    expect(json).not.toContain('<');
    const back = JSON.parse(json.replace(/\\u003c/g, '<')) as { frames: unknown[] };
    expect(back.frames).toHaveLength(2);
    const [a, b] = back.frames as Array<Record<string, unknown>>;
    expect(a.title).toBe('夜光 · 城市');
    expect('title' in b).toBe(false);
  });

  it('生成的岛能被同一个解析器读回（首页产出 / 灯箱消费闭环）', () => {
    const { frames } = parseFramesIsland(buildFramesIslandJson([FRAME_A, FRAME_B]));
    expect(frames.map((f) => f.src)).toEqual(['/_astro/a.webp', '/_astro/b.webp']);
  });

  it('createFrameRegistry：同一 src 只占一帧，两处图版共享索引（开场图 = 精选首图）', () => {
    const registry = createFrameRegistry();
    expect(registry.indexOf(FRAME_A)).toBe(0);
    expect(registry.indexOf(FRAME_A)).toBe(0);
    expect(registry.indexOf({ ...FRAME_A, thumb: '另一个缩略图' })).toBe(0);
    expect(registry.indexOf(FRAME_B)).toBe(1);
    expect(registry.frames).toHaveLength(2);
  });
});
