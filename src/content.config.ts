// =============================================================================
// Astro 7.3.4 Content Collections 配置（Astro 5+ 约定：文件在 src/content.config.ts）
//
// series / posts 两类内容单元与类型安全 schema。schema 见 src/content/schemas.ts
// （抽出以便 Vitest 直接对同一份定义做校验测试，非复制）。
// loader 用 glob()：内容与代码分离，新增系列/随笔只是加 .md 文件（边界①）。
// =============================================================================

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { postsSchema, seriesSchema } from './content/schemas';

/** 系列：src/content/series/<系列标识>/index.md（图片与 photos.meta.json 同放该子目录）。 */
const series = defineCollection({
  loader: glob({ base: './src/content/series', pattern: '*/index.md' }),
  schema: seriesSchema,
});

/** 随笔：src/content/posts/<日期-标题>.md（同名资源文件夹放图 + photos.meta.json）。 */
const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '*.md' }),
  schema: postsSchema,
});

export const collections = { series, posts };
