import { describe, expect, it, vi } from 'vitest';

import {
  countDisplayWebp,
  countPhotosFromSidecar,
  resolveSeriesCount,
} from '../../src/utils/photoCount';
import type { PhotoEntry, PhotoSidecar } from '../../src/types/photoSidecar';

// =============================================================================
// home-page §4.2 测试点 1：张数共享工具函数（纯计算、可注入 fs/告警、无副作用）
//
// 口径钉死：sidecar 优先（数组长度，含空数组）；缺 sidecar 才兜底数展示图（排除 .thumb.webp）
// 并回调一条含条目 id 的告警。resolveSeriesCount 不 import fs/console，是纯函数。
// =============================================================================

/** 造一个结构合法的 PhotoEntry（只关心 file，其余给占位即可）。 */
function photo(file: string): PhotoEntry {
  return {
    file,
    thumb: file.replace(/\.webp$/, '.thumb.webp'),
    width: 2560,
    height: 1707,
    thumbWidth: 800,
    thumbHeight: 533,
    exif: {},
  };
}

describe('countPhotosFromSidecar · sidecar 长度即张数', () => {
  it('数组 → 长度', () => {
    const sidecar: PhotoSidecar = [photo('photos/a.webp'), photo('photos/b.webp')];
    expect(countPhotosFromSidecar(sidecar)).toBe(2);
  });
  it('空数组 → 0', () => expect(countPhotosFromSidecar([])).toBe(0));
  it('null / undefined → 0（不当 sidecar 用）', () => {
    expect(countPhotosFromSidecar(null)).toBe(0);
    expect(countPhotosFromSidecar(undefined)).toBe(0);
  });
});

describe('countDisplayWebp · 兜底计数（排除缩略图）', () => {
  it('成对的 a.webp + a.thumb.webp 只数 1 张', () => {
    const files = [
      'series/x/photos/a.webp',
      'series/x/photos/a.thumb.webp',
      'series/x/photos/b.webp',
      'series/x/photos/b.thumb.webp',
    ];
    expect(countDisplayWebp(files)).toBe(2);
  });
  it('忽略非 webp 文件', () => {
    expect(countDisplayWebp(['a.webp', 'a.thumb.webp', 'readme.md', 'c.jpg'])).toBe(1);
  });
  it('大小写不敏感', () => {
    expect(countDisplayWebp(['A.WEBP', 'A.THUMB.WEBP'])).toBe(1);
  });
  it('空数组 / 非数组 → 0', () => {
    expect(countDisplayWebp([])).toBe(0);
    expect(countDisplayWebp(undefined as unknown as string[])).toBe(0);
  });
});

describe('resolveSeriesCount · 优先/兜底/告警（纯函数、无 console 副作用）', () => {
  it('有 sidecar：返回长度，既不告警也不数文件', () => {
    const warn = vi.fn();
    const n = resolveSeriesCount({
      sidecar: [photo('photos/a.webp'), photo('photos/b.webp'), photo('photos/c.webp')],
      files: ['should/be/ignored.webp'],
      entryId: 'city-lights',
      onWarn: warn,
    });
    expect(n).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('空数组 sidecar：据实返回 0，且不告警（sidecar 是事实源，非缺失）', () => {
    const warn = vi.fn();
    expect(resolveSeriesCount({ sidecar: [], files: ['photos/a.webp'], entryId: 'x', onWarn: warn })).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('缺 sidecar(null)：兜底数展示图（排除 thumb）并触发一次含 id 的告警', () => {
    const msgs: string[] = [];
    const n = resolveSeriesCount({
      sidecar: null,
      files: ['series/y/photos/a.webp', 'series/y/photos/a.thumb.webp', 'series/y/photos/b.webp'],
      entryId: 'y-series',
      onWarn: (m) => msgs.push(m),
    });
    expect(n).toBe(2);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('y-series');
  });

  it('缺 sidecar(undefined) 且无文件：返回 0 并告警', () => {
    const warn = vi.fn();
    expect(resolveSeriesCount({ sidecar: undefined, files: [], entryId: 'empty', onWarn: warn })).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('不注入 onWarn 也能安全兜底（不外泄全局副作用）', () => {
    expect(resolveSeriesCount({ sidecar: null, files: ['a.webp', 'a.thumb.webp'], entryId: 'z' })).toBe(1);
  });
});
