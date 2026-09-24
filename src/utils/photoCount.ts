// =============================================================================
// photoCount —— 「一个系列有几帧」的共享口径（home-page 落地，series-pages 复用）
//
// 为什么单独成模块：张数同时出现在首页系列卡 / 系列页章题 / 灯箱页码片，口径必须唯一。
// 边界①「内容与代码分离」：张数的事实源是内容夹里的 photos.meta.json，页面不得数缩略图。
//
// 口径（home-page.md 任务 4 / design §6）：
//   1. sidecar 优先——有 photos.meta.json（PhotoSidecar 数组）时，张数 = 数组长度；
//      空数组也算「有 sidecar」，据实返回 0，不告警（数据本身即事实）。
//   2. 缺 sidecar 兜底——回退统计该条目 photos/ 下的展示图 webp 数（排除 .thumb.webp），
//      并通过注入的 onWarn 回调发出一条含条目 id 的构建期告警，提示补跑 `npm run import`。
//
// 设计：纯计算、零 I/O、不 import Astro/Node。文件读取与告警落地（console.warn）由调用方
//      注入，便于在 Node 单测里直接跑纯计算部分、也便于构建期把告警接去任何 sink。
// =============================================================================

import type { PhotoSidecar } from '../types/photoSidecar';

/** sidecar 数组 → 张数。非数组（缺失 / 脏数据）一律记 0。这是「sidecar 优先」的正典读法。 */
export function countPhotosFromSidecar(sidecar: PhotoSidecar | null | undefined): number {
  return Array.isArray(sidecar) ? sidecar.length : 0;
}

/**
 * 兜底计数：从「一个条目 photos/ 下的展示图文件名/路径列表」里数出真实展示图张数。
 * 只认 `.webp`（图片规格常量 IMAGE_FORMAT），并显式排除缩略图 `.thumb.webp`。
 * 入参是「已经过 fs 读取、扁平化的字符串列表」——本函数不碰文件系统，保持纯。
 */
export function countDisplayWebp(files: readonly string[]): number {
  if (!Array.isArray(files)) return 0;
  return files.filter(
    (f) => typeof f === 'string' && f.toLowerCase().endsWith('.webp') && !f.toLowerCase().endsWith('.thumb.webp'),
  ).length;
}

/** resolveSeriesCount 的注入式入参：把「sidecar（可能缺）+ 兜底文件列表 + 告警」都交给调用方。 */
export interface SeriesCountInput {
  /** 该条目已解析的 photos.meta.json；缺失时传 null / undefined（触发兜底 + 告警）。 */
  sidecar: PhotoSidecar | null | undefined;
  /** 缺 sidecar 时用于兜底的展示图路径列表（含缩略图亦可，函数内部会排除 .thumb.webp）。 */
  files?: readonly string[];
  /** 条目 id：出现在告警文案里，让运维知道该给哪个系列补跑导入脚本。 */
  entryId: string;
  /** 告警回调（构建期接 console.warn）；缺省则静默兜底。 */
  onWarn?: (message: string) => void;
}

/**
 * 统一的系列张数解析：sidecar 优先、缺 sidecar 兜底并告警。
 * 纯函数——不发 console、不读盘；所有外部效应走注入的 onWarn。
 */
export function resolveSeriesCount(input: SeriesCountInput): number {
  const { sidecar, files = [], entryId, onWarn } = input;

  // 1) sidecar 优先：只要「是数组」（哪怕空）就据实返回长度，不告警。
  if (Array.isArray(sidecar)) {
    return sidecar.length;
  }

  // 2) 缺 sidecar：兜底按展示图计数，并回调一条含条目 id 的告警。
  const fallback = countDisplayWebp(files);
  onWarn?.(
    `[photoCount] 条目「${entryId}」缺少 photos.meta.json，已回退按展示图计数 = ${fallback} 帧；` +
      `请补跑 \`npm run import\` 生成 sidecar。`,
  );
  return fallback;
}

export default resolveSeriesCount;
