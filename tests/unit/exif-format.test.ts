import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// lightbox 模块 · 拍摄单渲染口径单测（src/utils/exifFormat.ts）
//
// 灯箱的页边 sheet 与图版右下角的 ExifCard 必须**逐字一致**（同一条 sidecar 两处同口径），
// 所以这里既钉住 DESIGN §7.3 那张表的每个字段格式，也拿 ExifCard 源码的字段顺序做交叉比对
// —— 谁改了顺序 / 改了后缀，这里就红（ExifCard 本体不动，是灯箱这边向它对齐）。
// =============================================================================

import {
  EXIF_FIELD_ORDER,
  EXIF_LABELS,
  exifLine,
  fmtDate,
  fmtShutter,
  formatExifItems,
  present,
  trimNum,
} from '../../src/utils/exifFormat';
import type { Exif } from '../../src/types/photoSidecar';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 种子数据里真实存在的一条（city-lights 第 1 帧，全字段）。 */
const FULL: Exif = {
  camera: 'FUJIFILM X-T5',
  lens: 'XF 56mm F1.2 R WR',
  focalLength: 56,
  aperture: 1.2,
  shutter: '1/125',
  iso: 800,
  dateTaken: '2026-09-20',
};

describe('formatExifItems · DESIGN §7.3 的字段格式', () => {
  it('全字段帧：顺序与值串都和文档表格一致', () => {
    expect(formatExifItems(FULL).map((i) => i.text)).toEqual([
      'FUJIFILM X-T5',
      'XF 56mm F1.2 R WR',
      '56mm',
      'f/1.2',
      '1/125s',
      'ISO800',
      '2026.09.20',
    ]);
    expect(formatExifItems(FULL).map((i) => i.key)).toEqual(EXIF_FIELD_ORDER);
    expect(formatExifItems(FULL).map((i) => i.label)).toEqual([
      '机型',
      '镜头',
      '焦距',
      '光圈',
      '快门',
      'ISO',
      '日期',
    ]);
  });

  it('缺字段整项不输出（city-lights 第 2 帧只有光圈与日期）', () => {
    const partial: Exif = {
      camera: null,
      lens: null,
      focalLength: null,
      aperture: 2,
      shutter: null,
      iso: null,
      dateTaken: '2026-09-20',
    };
    expect(formatExifItems(partial).map((i) => `${i.key}=${i.text}`)).toEqual([
      'aperture=f/2',
      'dateTaken=2026.09.20',
    ]);
  });

  it('空 exif / null / undefined → 空数组（调用方显示「该帧无 EXIF 记录」而不是造假）', () => {
    expect(formatExifItems({})).toEqual([]);
    expect(formatExifItems(null)).toEqual([]);
    expect(formatExifItems(undefined)).toEqual([]);
    expect(exifLine(undefined)).toBe('');
  });

  it('整行串（· 分隔）与 ExifCard 的参数行同形', () => {
    expect(exifLine({ aperture: 2.8, iso: 100 })).toBe('f/2.8 · ISO100');
  });
});

describe('单项格式化边界', () => {
  it('快门：分数串补 s、秒数数字 → Ns、小于 1 秒 → 1/Ns、非法值 → 空', () => {
    expect(fmtShutter('1/250')).toBe('1/250s');
    expect(fmtShutter('2s')).toBe('2s');
    expect(fmtShutter(2)).toBe('2s');
    expect(fmtShutter(0.008)).toBe('1/125s');
    expect(fmtShutter(0)).toBe('');
    expect(fmtShutter(-1)).toBe('');
    expect(fmtShutter('  ')).toBe('');
    expect(fmtShutter(Number.NaN)).toBe('');
  });

  it('日期：YYYY.MM.DD 印刷口径；读不懂就原样，不编造', () => {
    expect(fmtDate('2026-9-1')).toBe('2026.09.01');
    expect(fmtDate('2026/09/01')).toBe('2026.09.01');
    expect(fmtDate('尚未确定')).toBe('尚未确定');
    expect(fmtDate(new Date(Date.UTC(2026, 8, 20)))).toBe('2026.09.20');
    expect(fmtDate(new Date('无效日期'))).toBe('');
  });

  it('trimNum 去尾零（5 → 5，2.8 → 2.8，5.0 → 5）', () => {
    expect(trimNum(5)).toBe('5');
    expect(trimNum(5.0)).toBe('5');
    expect(trimNum(2.8)).toBe('2.8');
    expect(trimNum(1.333)).toBe('1.33');
  });

  it('present：null / undefined / 空串 / NaN 都算缺失', () => {
    expect(present(null)).toBe(false);
    expect(present(undefined)).toBe(false);
    expect(present('   ')).toBe(false);
    expect(present(Number.NaN)).toBe(false);
    expect(present(0)).toBe(true);
    expect(present('f/2')).toBe(true);
  });
});

describe('与 ExifCard 的口径不漂移（两处共用一条 sidecar）', () => {
  const card = readFileSync(resolve(ROOT, 'src/components/ExifCard.astro'), 'utf8');

  it('字段顺序表与 ExifCard 的 FORMATTERS 完全一致', () => {
    const keys = [...card.matchAll(/\['([A-Za-z]+)',\s*\(v\)/g)].map((m) => m[1]);
    expect(keys.length, 'ExifCard 的 FORMATTERS 解析不出来（结构变了要同步这里）').toBeGreaterThanOrEqual(
      7,
    );
    expect(keys).toEqual(EXIF_FIELD_ORDER as unknown as string[]);
  });

  it('标签措辞覆盖 design §4 的七项（机型/镜头/焦距/光圈/快门/ISO/日期）', () => {
    expect(Object.keys(EXIF_LABELS).sort()).toEqual([...EXIF_FIELD_ORDER].sort());
    expect(Object.values(EXIF_LABELS).join('')).toContain('焦距');
    expect(EXIF_LABELS.dateTaken).toBe('日期');
  });

  it('灯箱的 sheet 与图版说明签读的是同一份 sidecar（数据不另起来源）', () => {
    const sidecar = JSON.parse(
      readFileSync(resolve(ROOT, 'src/content/series/city-lights/photos.meta.json'), 'utf8'),
    ) as Array<{ exif: Exif }>;
    expect(formatExifItems(sidecar[0].exif).map((i) => i.text)).toEqual([
      'FUJIFILM X-T5',
      'XF 56mm F1.2 R WR',
      '56mm',
      'f/1.2',
      '1/125s',
      'ISO800',
      '2026.09.20',
    ]);
    expect(sidecar[1].exif.camera).toBeNull();
  });
});
