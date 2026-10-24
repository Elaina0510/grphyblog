import { describe, expect, it } from 'vitest';

import { DISPLAY_LONG_EDGE, THUMB_LONG_EDGE } from '../../public/admin/js/config.js';
import { planCompression, planDisplay, planThumb } from '../../public/admin/js/imageplan.js';
import { scaleToLongEdge } from '../../astro.config.mjs';

// =============================================================================
// 直传缩放计划（public/admin/js/imageplan.js）单测 —— E6 的纯函数层
//
// 规则只有三条，但每条都会被真实相机文件踩到：
//   ① 长边收敛到目标值（横图 / 竖图都一样）；
//   ② 小图不放大（原样输出，不做无意义重采样）；
//   ③ 比例换算四舍五入且最小 1px（极端细长图不会算出 0 宽）。
// 另外与 astro.config.mjs 的 scaleToLongEdge 交叉比对：后台直传和本地导入脚本
// 必须用同一套缩放口径，否则同一张图从两条通道进来尺寸会不一样。
// =============================================================================

describe('长边收敛', () => {
  it('6000×4000 → 2560×1707（横图）', () => {
    expect(planCompression({ width: 6000, height: 4000, longEdge: 2560 })).toEqual({
      width: 2560,
      height: 1707,
      longEdge: 2560,
      scale: 2560 / 6000,
      resized: true,
    });
  });

  it('4000×6000 → 1707×2560（竖图：宽高交换由长边算法自然处理）', () => {
    expect(planCompression({ width: 4000, height: 6000, longEdge: 2560 })).toMatchObject({
      width: 1707,
      height: 2560,
    });
  });

  it('4000×4000 方图 → 2560×2560', () => {
    expect(planCompression({ width: 4000, height: 4000, longEdge: 2560 })).toMatchObject({
      width: 2560,
      height: 2560,
    });
  });

  it('长边恰好等于目标值 → 不缩放（resized=false）', () => {
    expect(planCompression({ width: 2560, height: 1707, longEdge: 2560 })).toMatchObject({
      width: 2560,
      height: 1707,
      scale: 1,
      resized: false,
    });
  });
});

describe('不放大', () => {
  it('300×200 的小图原样输出（不会变成 2560 宽）', () => {
    expect(planCompression({ width: 300, height: 200, longEdge: 2560 })).toMatchObject({
      width: 300,
      height: 200,
      resized: false,
    });
  });

  it('缩略图通道同样不放大：600×400 不会撑到 800', () => {
    expect(planCompression({ width: 600, height: 400, longEdge: THUMB_LONG_EDGE })).toMatchObject({
      width: 600,
      height: 400,
      resized: false,
    });
  });
});

describe('边界与非法输入', () => {
  it('极端细长图最小 1px（5000×2 → 2560×1）', () => {
    expect(planCompression({ width: 5000, height: 2, longEdge: 2560 })).toMatchObject({ width: 2560, height: 1 });
  });

  it('小数尺寸向下取整后再算（像素是整数语义）', () => {
    expect(planCompression({ width: 5120.9, height: 2880.2, longEdge: 2560 }).width).toBe(2560);
  });

  it('非正 / 非有限尺寸与长边直接抛错（不静默产出 0×0）', () => {
    for (const bad of [
      { width: 0, height: 100, longEdge: 2560 },
      { width: 100, height: -1, longEdge: 2560 },
      { width: Number.NaN, height: 100, longEdge: 2560 },
      { width: 100, height: 100, longEdge: 0 },
      { width: 100, height: 100, longEdge: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => planCompression(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('两个通道的口径（展示版 2560 / 缩略图 800）', () => {
  it('默认长边就是 config 里的 2560 / 800', () => {
    expect(DISPLAY_LONG_EDGE).toBe(2560);
    expect(THUMB_LONG_EDGE).toBe(800);
    expect(planDisplay(6000, 4000, DISPLAY_LONG_EDGE).width).toBe(2560);
    expect(planThumb(6000, 4000, THUMB_LONG_EDGE).width).toBe(800);
  });

  it('与 astro.config.mjs 的 scaleToLongEdge 同口径（本地 import 与浏览器直传不能两套算法）', () => {
    const samples = [
      [6000, 4000],
      [4000, 6000],
      [2560, 1707],
      [300, 200],
      [5000, 2],
      [1922, 2560],
    ];
    for (const [width, height] of samples) {
      const mine = planCompression({ width, height, longEdge: DISPLAY_LONG_EDGE });
      const theirs = scaleToLongEdge(width, height, DISPLAY_LONG_EDGE);
      expect({ width: mine.width, height: mine.height }, `${width}×${height}`).toEqual(theirs);
    }
  });
});
