import { describe, expect, it } from 'vitest';

import { filterDrafts } from '../../src/utils/collections';

// §5.2 draft 过滤纯函数：只排除 draft === true，false / 缺省一律保留。
type Entry = { id: string; data: { draft?: boolean } };

describe('filterDrafts · 草稿隔离（纯函数）', () => {
  it('排除 draft:true，保留 false 与缺省(undefined)', () => {
    const entries: Entry[] = [
      { id: 'a', data: { draft: true } },
      { id: 'b', data: { draft: false } },
      { id: 'c', data: {} },
      { id: 'd', data: { draft: true } },
      { id: 'e', data: { draft: undefined } },
    ];
    const kept = filterDrafts(entries);
    expect(kept.map((e) => e.id)).toEqual(['b', 'c', 'e']);
  });

  it('不修改入参数组，返回新数组', () => {
    const entries: Entry[] = [
      { id: 'x', data: { draft: true } },
      { id: 'y', data: {} },
    ];
    const snapshot = entries.slice();
    const out = filterDrafts(entries);
    expect(out).not.toBe(entries);
    expect(entries).toEqual(snapshot);
    expect(out).toHaveLength(1);
  });

  it('空数组返回空数组', () => {
    expect(filterDrafts([])).toEqual([]);
  });

  it('全部草稿时返回空', () => {
    const entries: Entry[] = [
      { id: 'a', data: { draft: true } },
      { id: 'b', data: { draft: true } },
    ];
    expect(filterDrafts(entries)).toEqual([]);
  });

  it('data 缺失也不抛错（容错，按非草稿保留）', () => {
    const entries = [{ id: 'a' }, { id: 'b', data: { draft: true } }] as unknown as Entry[];
    expect(filterDrafts(entries).map((e) => e.id)).toEqual(['a']);
  });
});
