// =============================================================================
// exifFormat.ts —— EXIF 参数行的「渲染口径」纯函数（灯箱拍摄单用）
//
// 为什么要抽出来：ExifCard（图版右下角的说明签）与灯箱的拍摄单 sheet
// 必须**逐字一致**（同一条 sidecar，两处显示成同样的 `56mm · f/1.2 · 1/125s · ISO800 · 2026.09.20`），
// 而 ExifCard 的格式化写在它自己的 frontmatter 里、且根元素是 <figcaption>（必须活在 <figure> 内），
// 灯箱的 sheet 是页边抽屉、语义上不该再包一个 figcaption。
// 所以这里把 DESIGN §7.3 那张表复刻成可单测的纯函数，由 tests/unit/exif-format.test.ts
// 同时比对 ExifCard 源码的字段顺序 —— 谁漂移谁红（不改动 ExifCard 本体）。
//
// 口径（DESIGN §7.3 表，顺序即阅读顺序，缺字段整项不输出）：
//   camera 原样 | lens 原样不改写 | focalLength +mm | aperture f/去尾零 |
//   shutter 数字秒 → 1/Ns(<1s) 或 Ns、串则补 s | iso ISO前缀 | dateTaken YYYY.MM.DD
// =============================================================================

import type { Exif } from '../types/photoSidecar';

/** 一条可显示的 EXIF 参数。 */
export interface ExifItem {
  key: keyof Exif;
  /** 字段中文名（灯箱 sheet 的行标签；ExifCard 那侧只有参数行、不带标签）。 */
  label: string;
  /** 已按 §7.3 格式化好的值串，如 "f/1.2"。 */
  text: string;
}

/** 字段 → 中文标签（灯箱 sheet 用；措辞取自 design §4 的「机型/镜头/焦距/光圈/快门/ISO/日期」）。 */
export const EXIF_LABELS: Record<keyof Exif, string> = {
  camera: '机型',
  lens: '镜头',
  focalLength: '焦距',
  aperture: '光圈',
  shutter: '快门',
  iso: 'ISO',
  dateTaken: '日期',
};

/** 值是否真的存在：null / undefined / 空串 / NaN 都算缺失（与 ExifCard 同判定）。 */
export function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/** 去掉浮点尾零：5 → "5"，2.8 → "2.8"，5.0 → "5"。 */
export function trimNum(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** 快门：sidecar 可能是秒数数字，也可能是已格式化的分数串（"1/125"）。 */
export function fmtShutter(value: string | number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1) return `${trimNum(value)}s`;
    return `1/${Math.round(1 / value)}s`;
  }
  const raw = String(value).trim();
  if (!raw) return '';
  return /s$/i.test(raw) ? raw : `${raw}s`;
}

/** 日期：ISO 串或 Date → 印刷口径 YYYY.MM.DD；读不懂就原样显示，不编造。 */
export function fmtDate(value: string | Date): string {
  const iso =
    value instanceof Date
      ? Number.isNaN(value.getTime())
        ? ''
        : value.toISOString().slice(0, 10)
      : String(value).trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${y}.${mo.padStart(2, '0')}.${d.padStart(2, '0')}`;
}

/** 出字段值的唯一口径表（顺序 = DESIGN §7.3 的 EXIF 阅读顺序）。 */
const FORMATTERS: Array<[keyof Exif, (raw: never) => string]> = [
  ['camera', (v) => String(v)],
  ['lens', (v) => String(v)],
  ['focalLength', (v) => `${trimNum(Number(v))}mm`],
  ['aperture', (v) => `f/${trimNum(Number(v))}`],
  ['shutter', (v) => fmtShutter(v as string | number)],
  ['iso', (v) => `ISO${trimNum(Number(v))}`],
  ['dateTaken', (v) => fmtDate(v as string | Date)],
];

/**
 * sidecar 的 exif 对象 → 可渲染的参数行（缺字段整项不输出）。
 * 空 exif / null / undefined → 空数组，调用方据此显示「无 EXIF 记录」。
 */
export function formatExifItems(exif?: Exif | null): ExifItem[] {
  if (!exif) return [];
  const items: ExifItem[] = [];
  for (const [key, format] of FORMATTERS) {
    const raw = exif[key];
    if (!present(raw)) continue;
    const value = format(raw as never);
    if (!value) continue;
    items.push({ key, label: EXIF_LABELS[key], text: value });
  }
  return items;
}

/** 参数行整串（` · ` 连接），与 ExifCard 的视觉口径一致，给需要单行的场合用。 */
export function exifLine(exif?: Exif | null): string {
  return formatExifItems(exif)
    .map((item) => item.text)
    .join(' · ');
}

/** 字段顺序（单测拿它和 ExifCard 源码比对，防两处口径漂移）。 */
export const EXIF_FIELD_ORDER: Array<keyof Exif> = FORMATTERS.map(([key]) => key);
