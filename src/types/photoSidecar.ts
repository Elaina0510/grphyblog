// =============================================================================
// 照片元数据 sidecar 类型（design §2 字段 / §4 EXIF 口径）
//
// 这是「内容层 JSON」与「代码」之间的唯一契约：
//   - scripts/import-photos.mjs 读取 EXIF 后按此形状生成 photos.meta.json；
//   - 灯箱（lightbox）/ 拍摄单组件按此形状读取展示。
//
// 约定文件名固定为 `photos.meta.json`，位置（design §4 + 任务契约 (a)）：
//   - 系列：src/content/series/<系列标识>/photos.meta.json
//   - 随笔：src/content/posts/<日期-标题>/photos.meta.json（随笔与系列同通道）
//
// 本文件刻意保持「纯类型、零运行时依赖」（不 import astro/zod 等），
// 以便在 Node 单测与 Astro 构建两端都能直接 import。
// =============================================================================

/**
 * 单张照片的 EXIF 说明签数据。
 * 所有字段允许缺失（`?`）或为 `null`：脚本读不到某项 EXIF 时留空，
 * 前端渲染时对应「缺字段容错留空」，不得因缺字段而报错。
 */
export interface Exif {
  /** 机型，如 "FUJIFILM X-T5" */
  camera?: string | null;
  /** 镜头，如 "XF 56mm F1.2 R WR" */
  lens?: string | null;
  /** 焦距（mm，等效或真实由脚本决定，全站口径一致即可） */
  focalLength?: number | null;
  /** 光圈 f 值，如 1.2 */
  aperture?: number | null;
  /** 快门：秒数字或已格式化的分数串（如 "1/250"）皆可 */
  shutter?: string | number | null;
  /** ISO 感光度 */
  iso?: number | null;
  /** 拍摄日期，ISO 字符串（如 "2026-09-20"）；脚本原样透传，前端只读展示 */
  dateTaken?: string | null;
}

/**
 * 单张照片条目：展示版 + 缩略图 + EXIF。
 * `file` / `thumb` 存「相对该内容条目资源夹」的路径（契约 (a)）：
 *   photos/<basename>.webp / photos/<basename>.thumb.webp
 * 展示版长边 = DISPLAY_LONG_EDGE(2560)、缩略图长边 = THUMB_LONG_EDGE(800)，
 * 具体数值由 astro.config.mjs 单一出处提供，此处只记录相对路径。
 */
export interface PhotoEntry {
  /** 展示版相对路径，如 "photos/night-01.webp" */
  file: string;
  /** 缩略图相对路径，如 "photos/night-01.thumb.webp" */
  thumb: string;
  /** 该照片的 EXIF；允许缺失 */
  exif: Exif;
}

/**
 * sidecar 文件本体：有序数组即照片流 / 灯箱的帧序列（顺序 = 展示顺序）。
 * photos.meta.json 的顶层就是一个 PhotoSidecar 数组。
 */
export type PhotoSidecar = PhotoEntry[];
