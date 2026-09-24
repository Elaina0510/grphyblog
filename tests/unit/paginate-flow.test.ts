import { describe, expect, it } from 'vitest';

import { chunkSizes, planPhotoFlow } from '../../src/utils/paginateFlow';

// =============================================================================
// series-pages §3 交付 6 / §6「>30 张分批」纯逻辑单测
//
// paginateFlow 是「照片流是否分批 + 首屏几帧 + 后续每批几帧」的唯一算法口径，
// 页面只据它决定 IntersectionObserver 行为；把它从 Astro 里剥出来直接测（零 I/O）。
// 当前种子 <30 属正常，>30 的真实浏览器分批 e2e 归后续 performance-acceptance。
// =============================================================================

describe('planPhotoFlow · ≤30 不分批', () => {
  it('total <= threshold（含 30 整）→ batched=false，首屏即全部，无后续批次', () => {
    for (const n of [0, 1, 2, 15, 29, 30]) {
      const plan = planPhotoFlow(n);
      expect(plan.batched, `${n} 张不该分批`).toBe(false);
      expect(plan.total).toBe(n);
      expect(plan.firstScreen).toBe(n);
      expect(plan.remaining).toBe(0);
      expect(plan.batches).toEqual([]);
    }
  });

  it('默认阈值就是 30（严格「>30」才分批）', () => {
    expect(planPhotoFlow(30).batched).toBe(false);
    expect(planPhotoFlow(31).batched).toBe(true);
  });
});

describe('planPhotoFlow · >30 分批计划', () => {
  it('31 张默认：首屏 30，剩余 1 落成一批 [1]', () => {
    const plan = planPhotoFlow(31);
    expect(plan.batched).toBe(true);
    expect(plan.firstScreen).toBe(30);
    expect(plan.remaining).toBe(1);
    expect(plan.batches).toEqual([1]);
    expect(plan.batches.reduce((a, b) => a + b, 0)).toBe(plan.remaining);
  });

  it('55 张默认（chunk=20）：首屏 30，剩余 25 → [20, 5]', () => {
    const plan = planPhotoFlow(55);
    expect(plan).toMatchObject({ batched: true, firstScreen: 30, remaining: 25, chunkSize: 20 });
    expect(plan.batches).toEqual([20, 5]);
  });

  it('批次大小之和恒等于剩余帧数（不吞帧、不重复）', () => {
    for (const n of [31, 40, 60, 100, 137]) {
      const plan = planPhotoFlow(n);
      const summed = plan.firstScreen + plan.batches.reduce((a, b) => a + b, 0);
      expect(summed, `${n} 张分批计划未覆盖全部`).toBe(n);
      for (const b of plan.batches) {
        expect(b).toBeGreaterThan(0);
        expect(b).toBeLessThanOrEqual(plan.chunkSize);
      }
    }
  });

  it('可自定义阈值 / 首屏 / 批大小', () => {
    const plan = planPhotoFlow(24, { threshold: 10, initialSize: 12, chunkSize: 5 });
    expect(plan).toMatchObject({ batched: true, firstScreen: 12, remaining: 12, chunkSize: 5 });
    expect(plan.batches).toEqual([5, 5, 2]);
  });

  it('initialSize 大于 total 时首屏夹到 total（不越界）', () => {
    const plan = planPhotoFlow(40, { threshold: 20, initialSize: 100 });
    expect(plan.firstScreen).toBe(40);
    expect(plan.remaining).toBe(0);
    // 虽然名义上 batched（40>20），但没有剩余帧可追加：批次为空
    expect(plan.batches).toEqual([]);
  });
});

describe('planPhotoFlow · 脏输入归一（不抛错、按 0 计）', () => {
  it('NaN / 负数 / Infinity / 非数字 → total=0，不分批', () => {
    for (const bad of [NaN, -5, -0.5, Infinity, undefined as unknown as number, null as unknown as number]) {
      const plan = planPhotoFlow(bad);
      expect(plan.total).toBe(0);
      expect(plan.batched).toBe(false);
      expect(plan.firstScreen).toBe(0);
      expect(plan.batches).toEqual([]);
    }
  });

  it('小数 total 向下取整（帧数是整数语义）', () => {
    expect(planPhotoFlow(31.9).total).toBe(31);
  });

  it('threshold/chunkSize 给 0 或缺省回落默认（30 / 20）', () => {
    expect(planPhotoFlow(31, { threshold: 0 }).threshold).toBe(30);
    expect(planPhotoFlow(31, { chunkSize: 0 }).chunkSize).toBe(20);
  });
});

describe('chunkSizes · 切批基元', () => {
  it('把 remaining 按 size 切成末批取余的序列', () => {
    expect(chunkSizes(0, 20)).toEqual([]);
    expect(chunkSizes(20, 20)).toEqual([20]);
    expect(chunkSizes(21, 20)).toEqual([20, 1]);
    expect(chunkSizes(45, 10)).toEqual([10, 10, 10, 10, 5]);
  });

  it('size<=0 或 remaining<=0 → 空（避免死循环）', () => {
    expect(chunkSizes(10, 0)).toEqual([]);
    expect(chunkSizes(-3, 5)).toEqual([]);
  });
});
