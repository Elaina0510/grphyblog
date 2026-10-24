// =============================================================================
// Content Collections 的 zod schema（design §2 字段，契约 (e)：STRICT 校验）
//
// 单独成模块的原因：
//   1) content.config.ts 只能被 Astro 构建（依赖 astro:content 虚拟模块），
//      Vitest 里 import 不到，故把可测的 schema 抽到这里，用 astro/zod（真实 zod 实例）。
//   2) 边界④「新内容类型 = 新 schema，不动旧结构」——新增 collection 就是在此追加导出。
//
// .strict()：出现任何未声明字段（含写错的字段名）即校验报错，是 §4.2 的硬性测试点。
//
// -----------------------------------------------------------------------------
// 照片池化口径（admin-v2.md A3/A4/A5，v0.1.1）
//
//   照片唯一位置：src/content/pool/photos/（展示图 + 缩略图同目录）
//   唯一元数据  ：src/content/pool/photos.meta.json（PhotoEntry 数组，全局一份）
//
//   photos —— 照片 ID 列表，**顺序 = 前台照片流顺序**（前台按此数组顺序渲染，
//             不再按 sidecar 顺序）。照片 ID = 池内**完整文件名（含 .webp 扩展名）**，
//             如 "night-01.webp"，不是相对路径、也不是去掉扩展名的裸名。
//             「ID 必须真实存在于池中」不在 schema 层校验（zod 读不到磁盘），
//             由构建期检查 R6（admin-v2.md C4）拦截。
//             `.default([])`：迁移前的老条目还没有 photos 键，缺省视为「没有照片」，
//             保证门禁 1 阶段 `npm run build` 仍绿；B2c 回填 frontmatter 后即显式存在。
//
//   cover —— 封面 = 照片 ID（与 photos 元素同口径）。**仍是必填键**，但值允许空串：
//             空串 = 本条目不指定封面，走 A5 三级回退
//             cover（非空）→ photos[0] → 两者皆空则整块封面区不渲染（不留占位死链）。
// =============================================================================

import { z } from 'astro/zod';

/** 系列 frontmatter：标题 / 日期 / 封面 / 照片列表 / 标签 / 排序权重 / 草稿。 */
export const seriesSchema = z
  .object({
    title: z.string(),
    // 允许 "2026-09-20" / Date / ISO 串，构建期一律归一成 Date。
    date: z.coerce.date(),
    // 封面照片 ID（池内完整文件名，如 "night-01.webp"）；空串合法 → 前台退回 photos[0]。
    cover: z.string(),
    // 照片 ID 列表（池内完整文件名，如 "night-01.webp"），顺序 = 前台照片流顺序。
    photos: z.array(z.string()).default([]),
    tags: z.array(z.string()),
    order: z.number(),
    draft: z.boolean().default(false),
  })
  .strict();

/** 随笔 frontmatter：同系列但无 order（时间倒序即可）。 */
export const postsSchema = z
  .object({
    title: z.string(),
    date: z.coerce.date(),
    // 封面照片 ID（池内完整文件名）；空串合法 → 前台退回 photos[0]。
    cover: z.string(),
    // 照片 ID 列表，顺序 = 前台照片流顺序（正文插图另走 `![说明](photo:照片ID)` 语法）。
    photos: z.array(z.string()).default([]),
    tags: z.array(z.string()),
    draft: z.boolean().default(false),
  })
  .strict();

export type SeriesData = z.infer<typeof seriesSchema>;
export type PostsData = z.infer<typeof postsSchema>;
