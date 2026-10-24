import { describe, expect, it, vi } from 'vitest';

import { countEntryPhotos, resolveSeriesCount } from '../../src/utils/photoCount';

// =============================================================================
// 照片池化 · G1（admin-v2.md "清理死代码"）：张数唯一口径 = photos.length
//
// 池化后照片只有一份全局 sidecar，条目侧只保存照片 ID 列表，于是——
//   · 张数 = frontmatter `photos` 的长度（顺序无关，重复 ID 也照数，那是内容问题不是口径问题）；
//   · 「缺 sidecar 就数 photos/ 下的展示图」的兜底分支连同它的告警一起删除（K4）：
//     入参里再传 files / onWarn 也不再有任何作用，**不许**悄悄退回数文件。
// =============================================================================

describe('countEntryPhotos · photos 列表长度即张数', () => {
  it('照片 ID 数组 → 长度', () => {
    expect(countEntryPhotos(['night-01.webp', 'night-02.webp'])).toBe(2);
  });

  it('空数组 → 0（0 图条目是合法内容，如 wip-empty）', () => {
    expect(countEntryPhotos([])).toBe(0);
  });

  it('null / undefined / 非数组 → 0（脏 frontmatter 不许让构建崩）', () => {
    expect(countEntryPhotos(null)).toBe(0);
    expect(countEntryPhotos(undefined)).toBe(0);
    expect(countEntryPhotos('night-01.webp' as unknown as string[])).toBe(0);
    expect(countEntryPhotos({ length: 3 } as unknown as string[])).toBe(0);
  });

  it('重复 ID 照数（张数只回答「列表有几项」，去重是内容侧的活）', () => {
    expect(countEntryPhotos(['a.webp', 'a.webp'])).toBe(2);
  });
});

describe('resolveSeriesCount · 只剩 photos 一个事实源（G1 / K4）', () => {
  it('{ photos } → 长度', () => {
    expect(resolveSeriesCount({ photos: ['a.webp', 'b.webp', 'c.webp'] })).toBe(3);
  });

  it('photos 缺省 → 0', () => {
    expect(resolveSeriesCount({})).toBe(0);
    expect(resolveSeriesCount({ photos: null })).toBe(0);
  });

  it('不再接受兜底入参：只给 files 不给 photos → 0（绝不回退去数文件）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const legacyInput = {
        files: ['series/y/photos/a.webp', 'series/y/photos/a.thumb.webp'],
        entryId: 'y-series',
        onWarn: () => {},
      } as unknown as Parameters<typeof resolveSeriesCount>[0];
      expect(resolveSeriesCount(legacyInput)).toBe(0);
      // 旧的「缺 sidecar 告警」也不该再发出来（死代码已删，函数是纯的）
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('纯函数：不读盘、不发 console（计数器只看入参）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      resolveSeriesCount({ photos: ['x.webp'] });
      resolveSeriesCount({ photos: [] });
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
