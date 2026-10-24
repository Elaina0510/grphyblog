import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PhotoEntry } from '../../src/types/photoSidecar';

// =============================================================================
// 照片池化 · 内容模型（admin-v2.md A 组 A1 / A2）
//
// A1 展示版 + 缩略图统一落 src/content/pool/photos/（空目录以 .gitkeep 占位）
// A2 唯一元数据 src/content/pool/photos.meta.json，顶层是 PhotoEntry 数组
//
// 本文件只守「位置与形状」两件事：迁移脚本（B 组 --migrate）才负责把 5 份
// 旧 sidecar 合并成真数据，所以这里的元素级断言必须能容忍**空数组**，
// 同时在 B 组填数后仍然有效——用形状校验函数 + 夹具自证，避免空断言。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A1：照片池的唯一位置（展示版 <base>.webp + 缩略图 <base>.thumb.webp 同放此处）。 */
const POOL_PHOTOS_DIR = 'src/content/pool/photos';

/** A2：全局 sidecar 的唯一位置。 */
const POOL_SIDECAR = 'src/content/pool/photos.meta.json';

/** PhotoEntry 的七个必填键（与 src/types/photoSidecar.ts 同口径）。 */
const PHOTO_ENTRY_KEYS = [
  'file',
  'thumb',
  'width',
  'height',
  'thumbWidth',
  'thumbHeight',
  'exif',
] as const;

/** 数字型字段（真值由导入脚本从 sharp 输出 metadata 回填，不是按常量推算）。 */
const NUMERIC_KEYS = ['width', 'height', 'thumbWidth', 'thumbHeight'] as const;

/** 读全局 sidecar 的原始文本（存在性由上面的用例单独守，这里不做兜底）。 */
function readPoolSidecarText(): string {
  return readFileSync(resolve(ROOT, POOL_SIDECAR), 'utf8');
}

/**
 * 单条记录的形状问题清单（空数组 = 合规）。
 * 抽成纯函数是为了让「空数组时被跳过的断言」本身也有夹具用例，
 * 否则 B 组填数前这段逻辑永远没被执行过。
 */
function shapeProblems(entry: unknown): string[] {
  const problems: string[] = [];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['不是对象'];
  }
  const record = entry as Record<string, unknown>;
  for (const key of PHOTO_ENTRY_KEYS) {
    if (!(key in record)) problems.push(`缺字段 ${key}`);
  }
  for (const key of ['file', 'thumb'] as const) {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      problems.push(`${key} 必须是非空字符串`);
    }
  }
  for (const key of NUMERIC_KEYS) {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      problems.push(`${key} 必须是有限数字`);
    }
  }
  const { exif } = record;
  if (exif !== undefined && (exif === null || typeof exif !== 'object' || Array.isArray(exif))) {
    problems.push('exif 必须是对象（允许空对象）');
  }
  return problems;
}

/** 一份合法的 PhotoEntry 夹具（字段名/类型都与契约一致，仅供形状断言自证用）。 */
const VALID_ENTRY: PhotoEntry = {
  file: 'photos/night-01.webp',
  thumb: 'photos/night-01.thumb.webp',
  width: 2560,
  height: 1707,
  thumbWidth: 800,
  thumbHeight: 533,
  exif: { camera: 'FUJIFILM X-T5', aperture: 1.2, iso: 125 },
};

describe('照片池化 · A1 池目录 src/content/pool/photos/', () => {
  it('目录存在且确实是目录', () => {
    const abs = resolve(ROOT, POOL_PHOTOS_DIR);
    expect(existsSync(abs), `缺少池目录 ${POOL_PHOTOS_DIR} -> ${abs}`).toBe(true);
    expect(statSync(abs).isDirectory()).toBe(true);
  });

  it('空目录以 .gitkeep 占位，保证能被 Git 跟踪', () => {
    expect(existsSync(resolve(ROOT, POOL_PHOTOS_DIR, '.gitkeep'))).toBe(true);
  });

  it('池目录位于 src/content 之内（唯一位置口径，不是 src/assets 或 public/）', () => {
    expect(POOL_PHOTOS_DIR.startsWith('src/content/')).toBe(true);
    expect(existsSync(resolve(ROOT, POOL_PHOTOS_DIR, '..', 'photos.meta.json'))).toBe(true);
  });
});

describe('照片池化 · A2 全局 sidecar src/content/pool/photos.meta.json', () => {
  it('文件存在', () => {
    expect(existsSync(resolve(ROOT, POOL_SIDECAR)), `缺少全局 sidecar ${POOL_SIDECAR}`).toBe(true);
  });

  it('是合法 JSON（能被 JSON.parse）', () => {
    expect(() => JSON.parse(readPoolSidecarText())).not.toThrow();
  });

  it('顶层是数组（空数组合法：A 组只立位置与形状，真数据由 B 组 --migrate 合并）', () => {
    const parsed: unknown = JSON.parse(readPoolSidecarText());
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('元素逐条满足 PhotoEntry 形状（空数组时自然跳过，B 组填数后同一断言生效）', () => {
    const entries = JSON.parse(readPoolSidecarText()) as unknown[];
    for (const [index, entry] of entries.entries()) {
      expect(shapeProblems(entry), `${POOL_SIDECAR}[${index}] 形状不合契约`).toEqual([]);
    }
  });

  it('迁移期兼容：空数组（A 组现状）与非空数组（B 组合并后）都是合法 sidecar', () => {
    // 现状：空数组 → 能解析、是数组、元素级断言自然跳过。
    const empty = JSON.parse(readPoolSidecarText());
    expect(Array.isArray(empty)).toBe(true);

    // B 组填数后：整份重新序列化再解析，元素仍须过形状断言。
    const filled = JSON.parse(JSON.stringify([VALID_ENTRY])) as unknown[];
    expect(Array.isArray(filled)).toBe(true);
    expect(filled.map(shapeProblems)).toEqual([[]]);
  });
});

describe('照片池化 · A2 形状断层守卫（夹具自证，不依赖 B 组是否已填数）', () => {
  it('合法 PhotoEntry 无问题（七键齐全、类型正确）', () => {
    expect(shapeProblems(VALID_ENTRY)).toEqual([]);
  });

  it('exif 为空对象也算合规（缺 EXIF 的浏览器直传件走这条）', () => {
    expect(shapeProblems({ ...VALID_ENTRY, exif: {} })).toEqual([]);
  });

  it('缺宽高四项之一 → 报缺字段（宽高必须由脚本回填真值）', () => {
    const rest: Record<string, unknown> = { ...VALID_ENTRY };
    delete rest.thumbHeight;
    expect(shapeProblems(rest)).toEqual(['缺字段 thumbHeight']);
  });

  it('file 写成空串 → 报类型错误', () => {
    expect(shapeProblems({ ...VALID_ENTRY, file: '' })).toEqual(['file 必须是非空字符串']);
  });

  it('宽高写成字符串 → 报类型错误', () => {
    expect(shapeProblems({ ...VALID_ENTRY, width: '2560' })).toEqual(['width 必须是有限数字']);
  });

  it('exif 写成数组 / null → 报类型错误', () => {
    expect(shapeProblems({ ...VALID_ENTRY, exif: [] })).toEqual(['exif 必须是对象（允许空对象）']);
    expect(shapeProblems({ ...VALID_ENTRY, exif: null })).toEqual(['exif 必须是对象（允许空对象）']);
  });

  it('记录本身不是对象 → 报错（数组里塞 null 的情形）', () => {
    expect(shapeProblems(null)).toEqual(['不是对象']);
  });
});
