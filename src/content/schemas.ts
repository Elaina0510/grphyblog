// =============================================================================
// Content Collections 的 zod schema（design §2 字段，契约 (e)：STRICT 校验）
//
// 单独成模块的原因：
//   1) content.config.ts 只能被 Astro 构建（依赖 astro:content 虚拟模块），
//      Vitest 里 import 不到，故把可测的 schema 抽到这里，用 astro/zod（真实 zod 实例）。
//   2) 边界④「新内容类型 = 新 schema，不动旧结构」——新增 collection 就是在此追加导出。
//
// .strict()：出现任何未声明字段（含写错的字段名）即校验报错，是 §4.2 的硬性测试点。
// =============================================================================

import { z } from 'astro/zod';

/** 系列 frontmatter：标题 / 日期 / 封面 / 标签 / 排序权重 / 草稿。 */
export const seriesSchema = z
  .object({
    title: z.string(),
    // 允许 "2026-09-20" / Date / ISO 串，构建期一律归一成 Date。
    date: z.coerce.date(),
    // 存「相对该内容条目」的展示图路径（契约 (a)），如 "photos/night-01.webp"。
    cover: z.string(),
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
    cover: z.string(),
    tags: z.array(z.string()),
    draft: z.boolean().default(false),
  })
  .strict();

export type SeriesData = z.infer<typeof seriesSchema>;
export type PostsData = z.infer<typeof postsSchema>;
