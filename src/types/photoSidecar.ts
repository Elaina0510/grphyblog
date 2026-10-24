// =============================================================================
// 照片元数据 sidecar 类型（design §2 字段 / §4 EXIF 口径）
//
// 这是「内容层 JSON」与「代码」之间的唯一契约：
//   - 照片导入脚本按此形状回填 src/content/pool/photos.meta.json；
//   - 灯箱（lightbox）/ 拍摄单组件按此形状读取展示。
//
// 池化口径（admin-v2.md A3/A4/A5，v0.1.1）——位置与文件名固定：
//   - 照片池目录：src/content/pool/photos/（展示版 + 缩略图同目录，全站唯一收纳处）
//   - 唯一元数据：src/content/pool/photos.meta.json（PhotoSidecar 数组，全局一份）
//   不再有「每条目一份 sidecar」：系列与随笔都从这一份全局元数据取照片，
//   条目侧只保存照片 ID 列表（frontmatter 的 photos[] / cover，ID = 池内完整文件名含 .webp）。
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
  /**
   * 「EXIF 待补」渲染标记（admin-v2.md E6）。
   *
   * 为什么在 exif 里也放一份：前台页面只把 `photo.exif` 交给 ExifCard（`exif={f.exif}`），
   * 条目级的 `PhotoEntry.exifIncomplete` 到不了组件；而 E 组的边界不允许改页面，
   * 故由后台直传写入时在 exif 内镜像一份，ExifCard 据此渲染朱砂「※EXIF 待补」角标。
   * 语义事实仍以 `PhotoEntry.exifIncomplete` 为准。
   */
  exifIncomplete?: boolean;
}

/**
 * 单张照片条目：展示版 + 缩略图 + 各自真实像素尺寸 + EXIF。
 * `file` / `thumb` 存「相对照片池目录 photos/ 所在层级」的路径（池化口径 A3）：
 *   photos/<basename>.webp / photos/<basename>.thumb.webp
 * 即 file/thumb 的路径前缀恒为 `photos/`，真实磁盘位置在
 * src/content/pool/ 之下（src/content/pool/photos/<basename>.webp）；
 * 查 contentImageMap 时以 `pool` 作 entryDir，键即 `pool/photos/<basename>.webp`。
 * 展示版长边 = DISPLAY_LONG_EDGE(2560)、缩略图长边 = THUMB_LONG_EDGE(800)，
 * 具体数值由 astro.config.mjs 单一出处提供，此处只记录相对路径。
 *
 * `width` / `height` 是**展示版**的真实像素宽高，`thumbWidth` / `thumbHeight` 是**缩略图**的。
 * 四者由导入脚本从 sharp 的输出 metadata 回填（即「写盘后真实尺寸」，不是按常量推算的期望值），
 * 因此原图小于目标长边（不放大）或被旋转纠正时也与磁盘上的产物完全一致。
 * 存在的意义：design §3.7 要求全站 `<img>` 显式声明宽高以防布局抖动，
 * 页面 / 图版 / 灯箱组件直接从全局池元数据取这四个数，不必在构建期再探一次图片尺寸。
 * 这四个字段是**必填**：由脚本回填的池内条目一定带齐（缺字段的旧条目应重跑脚本回填）。
 */
export interface PhotoEntry {
  /** 展示版相对路径（相对池目录、前缀恒为 photos/），如 "photos/night-01.webp" */
  file: string;
  /** 缩略图相对路径（同池目录口径），如 "photos/night-01.thumb.webp" */
  thumb: string;
  /** 展示版真实像素宽 */
  width: number;
  /** 展示版真实像素高 */
  height: number;
  /** 缩略图真实像素宽 */
  thumbWidth: number;
  /** 缩略图真实像素高 */
  thumbHeight: number;
  /** 该照片的 EXIF；允许缺失 */
  exif: Exif;
  /**
   * 浏览器直传产物：Canvas 重编码后 EXIF 全空（E6 既定取舍）。
   * 池页（/admin）与前台 EXIF 卡据此显示「EXIF 待补」；在意拍摄参数的图走本地
   * `npm run import -- --pool`（sharp + exifr 能读到真 EXIF）。
   * 渲染侧的镜像标记见上方 `Exif.exifIncomplete` 的说明。
   */
  exifIncomplete?: boolean;
}

/**
 * 池化 sidecar 文件本体：有序数组即池内照片流 / 灯箱的帧序列（顺序 = 池内登记顺序）。
 * src/content/pool/photos.meta.json 的顶层就是一个 PhotoSidecar 数组（全局唯一一份）。
 * 注意：前台照片流顺序以条目 frontmatter 的 photos[] 为准，本数组顺序仅作池内登记顺序。
 */
export type PhotoSidecar = PhotoEntry[];
