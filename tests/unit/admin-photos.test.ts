import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  appendPhotoEntry,
  buildUploadEntry,
  entryPhotoId,
  findPhoto,
  hasPhoto,
  isThumbId,
  isValidBaseName,
  makeBaseName,
  movePhoto,
  movePhotoToId,
  photoIdOf,
  poolPhotoPath,
  poolRelPath,
  rawPhotoUrl,
  thumbIdOf,
  togglePhoto,
} from '../../public/admin/js/photos.js';
import { isExifPending, newEntryPath, poolIds, sidecarText } from '../../public/admin/js/api.js';

// =============================================================================
// 照片口径 + 勾选排序 + sidecar 追加（public/admin/js/photos.js / api.js 纯函数）
//
// 与前台 relationship：照片 ID = 池内完整文件名含 .webp；sidecar 的 file/thumb 是
// `photos/<id>`；frontmatter photos[] 的顺序 = 前台照片流顺序。
// 这些口径必须与 src/utils/contentImages.ts 一致 —— 最后两个用例直接拿**真实 sidecar**
// 做回归，防止后台自己发明一套 ID 规则。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SIDECAR = JSON.parse(
  readFileSync(resolve(ROOT, 'src/content/pool/photos.meta.json'), 'utf8'),
) as Array<{ file: string; thumb: string }>;

describe('照片 ID 口径', () => {
  it('各种写法都归一成末段文件名（含 .webp）', () => {
    expect(photoIdOf('night-01.webp')).toBe('night-01.webp');
    expect(photoIdOf('photos/night-01.webp')).toBe('night-01.webp');
    expect(photoIdOf('series/city-lights/photos/night-01.webp')).toBe('night-01.webp');
    expect(photoIdOf('/src/content/pool/photos/night-01.webp?raw=1')).toBe('night-01.webp');
    expect(photoIdOf('photo:night-01.webp')).toBe('photo:night-01.webp'); // 协议头由调用方剥
    expect(photoIdOf('')).toBe('');
    expect(photoIdOf('   ')).toBe('');
  });

  it('池内相对路径 = photos/<id>；真实路径 = src/content/pool/photos/<id>', () => {
    expect(poolRelPath('night-01.webp')).toBe('photos/night-01.webp');
    expect(poolPhotoPath('photos/night-01.webp')).toBe('src/content/pool/photos/night-01.webp');
    expect(poolRelPath('')).toBe('');
    expect(poolPhotoPath('')).toBe('');
  });

  it('缩略图 ID：x.webp → x.thumb.webp（幂等）', () => {
    expect(thumbIdOf('night-01.webp')).toBe('night-01.thumb.webp');
    expect(thumbIdOf('night-01.thumb.webp')).toBe('night-01.thumb.webp');
    expect(isThumbId('night-01.thumb.webp')).toBe(true);
    expect(isThumbId('night-01.webp')).toBe(false);
  });

  it('预览地址 = 仓库原始地址 + 池内相对路径（同一套 base+path 规则）', () => {
    expect(rawPhotoUrl({ owner: 'o', repo: 'r', branch: 'main', path: 'photos/a.webp' })).toBe(
      'https://raw.githubusercontent.com/o/r/main/photos/a.webp',
    );
    expect(rawPhotoUrl({ owner: 'o', repo: 'r', branch: 'main', path: '' })).toBe('');
    expect(
      rawPhotoUrl({ owner: 'o', repo: 'r', branch: 'main', rawBase: 'https://cdn.example.com/', path: '/photos/a.webp' }),
    ).toBe('https://cdn.example.com/o/r/main/photos/a.webp');
  });
});

describe('勾选 / 排序（照片流顺序的两次操作）', () => {
  it('勾选：追加到末尾；再点一次取消；不原地修改入参', () => {
    const base = ['a.webp'];
    const added = togglePhoto(base, 'b.webp');
    expect(added).toEqual(['a.webp', 'b.webp']);
    expect(base).toEqual(['a.webp']);
    expect(togglePhoto(added, 'a.webp')).toEqual(['b.webp']);
    expect(togglePhoto(['a.webp'], 'a.webp')).toEqual([]);
    expect(togglePhoto(['a.webp'], '')).toEqual(['a.webp']);
  });

  it('重复勾选不会产生重复项', () => {
    expect(togglePhoto(['a.webp', 'b.webp'], 'photos/b.webp')).toEqual(['a.webp']);
  });

  it('移动：从前到后 / 从后到前 / 原地 / 越界夹紧 / 非法下标原样返回', () => {
    const list = ['a.webp', 'b.webp', 'c.webp', 'd.webp'];
    expect(movePhoto(list, 0, 2)).toEqual(['b.webp', 'c.webp', 'a.webp', 'd.webp']);
    expect(movePhoto(list, 3, 0)).toEqual(['d.webp', 'a.webp', 'b.webp', 'c.webp']);
    expect(movePhoto(list, 1, 1)).toEqual(list);
    expect(movePhoto(list, 0, 99)).toEqual(['b.webp', 'c.webp', 'd.webp', 'a.webp']);
    expect(movePhoto(list, -1, 0)).toEqual(list);
    expect(movePhoto(list, 0, Number.NaN)).toEqual(list);
    expect(movePhoto([], 0, 0)).toEqual([]);
    expect(list).toEqual(['a.webp', 'b.webp', 'c.webp', 'd.webp']);
  });

  it('按 ID 移动到指定下标（拖拽落点用）', () => {
    const list = ['a.webp', 'b.webp', 'c.webp'];
    expect(movePhotoToId(list, 'c.webp', 0)).toEqual(['c.webp', 'a.webp', 'b.webp']);
    expect(movePhotoToId(list, 'ghost.webp', 0)).toEqual(list);
  });
});

describe('sidecar 查询与追加', () => {
  it('hasPhoto / findPhoto 按 ID 匹配', () => {
    const sidecar = [{ file: 'photos/a.webp', thumb: 'photos/a.thumb.webp' }];
    expect(hasPhoto(sidecar, 'a.webp')).toBe(true);
    expect(hasPhoto(sidecar, 'a.thumb.webp')).toBe(false);
    expect(findPhoto(sidecar, 'photos/a.webp')?.file).toBe('photos/a.webp');
    expect(findPhoto(sidecar, 'ghost.webp')).toBeUndefined();
    expect(hasPhoto(null, 'a.webp')).toBe(false);
  });

  it('appendPhotoEntry：同 ID 替换、新 ID 追加、不改入参、拒绝无 file', () => {
    const sidecar = [{ file: 'photos/a.webp' }];
    const entry = { file: 'photos/b.webp', thumb: 'photos/b.thumb.webp' };
    const appended = appendPhotoEntry(sidecar, entry);
    expect(appended).toHaveLength(2);
    expect(sidecar).toHaveLength(1);

    const replaced = appendPhotoEntry(appended, { ...entry, width: 10 });
    expect(replaced).toHaveLength(2);
    expect(replaced[1]).toMatchObject({ width: 10 });

    expect(() => appendPhotoEntry(sidecar, {})).toThrow(/需要 entry.file/);
  });

  it('sidecar 文本 = 2 空格缩进 + 结尾换行（与仓库现有文件同形）', () => {
    const text = sidecarText([{ file: 'photos/a.webp' }]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  {\n    "file": "photos/a.webp"\n  }');
    expect(JSON.parse(text)).toHaveLength(1);
  });

  it('poolIds：按 sidecar 登记顺序取 ID', () => {
    expect(poolIds([{ file: 'photos/b.webp' }, { file: 'photos/a.webp' }])).toEqual(['b.webp', 'a.webp']);
    expect(poolIds(null)).toEqual([]);
  });
});

describe('直传条目（E6）', () => {
  it('exif 全空 + exifIncomplete 标记（池页与 EXIF 卡据此显示「EXIF 待补」）', () => {
    const entry = buildUploadEntry({ baseName: 'web-1', width: 2560, height: 1707, thumbWidth: 800, thumbHeight: 533 });
    expect(entry).toEqual({
      file: 'photos/web-1.webp',
      thumb: 'photos/web-1.thumb.webp',
      width: 2560,
      height: 1707,
      thumbWidth: 800,
      thumbHeight: 533,
      exif: {
        camera: null,
        lens: null,
        focalLength: null,
        aperture: null,
        shutter: null,
        iso: null,
        dateTaken: null,
        exifIncomplete: true,
      },
      exifIncomplete: true,
    });
    expect(isExifPending(entry)).toBe(true);
    expect(isExifPending({ exif: { exifIncomplete: true } })).toBe(true);
    expect(isExifPending({ exif: { camera: 'X-T5' } })).toBe(false);
  });

  it('宽高必须是正整数（来自 Canvas 产物的真值，不接受推算值）', () => {
    const base = { baseName: 'web-1', width: 2560, height: 1707, thumbWidth: 800, thumbHeight: 533 };
    expect(() => buildUploadEntry({ ...base, width: 0 })).toThrow(/width/);
    expect(() => buildUploadEntry({ ...base, height: Number.NaN })).toThrow(/height/);
    expect(() => buildUploadEntry({ ...base, thumbWidth: -1 })).toThrow(/thumbWidth/);
    expect(buildUploadEntry({ ...base, width: 12.6 }).width).toBe(13);
  });

  it('文件名基只收小写字母/数字/-/_，且不超过 80 字符', () => {
    expect(isValidBaseName('web-20261024-153012-a1b2')).toBe(true);
    expect(isValidBaseName('a_b-1')).toBe(true);
    for (const bad of ['', 'Web', '有中文', 'a b', 'a/b', '-a', 'x'.repeat(81)])
      expect(isValidBaseName(bad), bad).toBe(false);
    expect(() => buildUploadEntry({ baseName: 'Bad Name', width: 1, height: 1, thumbWidth: 1, thumbHeight: 1 })).toThrow(
      /文件名基不合法/,
    );
  });

  it('makeBaseName：时间戳 + 4 位随机，形状可预测', () => {
    const now = new Date(Date.UTC(2026, 9, 24, 15, 30, 12));
    expect(makeBaseName(now, () => 0.5)).toBe('web-20261024-153012-8000');
    expect(makeBaseName(now, () => 0)).toBe('web-20261024-153012-0000');
  });
});

describe('与仓库真实 sidecar 对齐（防止后台自造 ID 规则）', () => {
  it('每条 file 的末段就是可用 ID，且 thumb 恒为 <id>.thumb.webp', () => {
    expect(SIDECAR.length).toBeGreaterThan(0);
    for (const entry of SIDECAR) {
      const id = entryPhotoId(entry);
      expect(id.endsWith('.webp')).toBe(true);
      expect(id.includes('/'), `${id} 里不该有目录`).toBe(false);
      expect(entry.thumb).toBe(`photos/${thumbIdOf(id)}`);
      expect(isThumbId(id)).toBe(false);
    }
  });

  it('展示图与缩略图是两个不同 ID（不会互相命中）', () => {
    const first = entryPhotoId(SIDECAR[0]);
    expect(first).not.toBe(thumbIdOf(first));
    expect(hasPhoto(SIDECAR, thumbIdOf(first))).toBe(false);
  });
});

describe('新条目路径（E4 新建）', () => {
  it('系列按标识建目录，随笔按日期+标识建文件', () => {
    expect(newEntryPath('series', { slug: 'city-lights' })).toBe('src/content/series/city-lights/index.md');
    expect(newEntryPath('posts', { slug: 'evening-stroll', date: '2026-10-24' })).toBe(
      'src/content/posts/2026-10-24-evening-stroll.md',
    );
  });
});
