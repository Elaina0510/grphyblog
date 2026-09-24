# Tasks · 内容模型（content-model）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §2、§3 ｜ 依赖：project-scaffold
> 目标：用 Content Collections 定义 series / posts 两类内容单元与类型安全 schema，落实 `imageUrl` 单一出口。

## 最小任务清单

- [x] 1. 建 `src/content.config.ts`：定义 `series` collection（schema 见任务 2）与 `posts` collection（schema 见任务 3）
- [x] 2. series frontmatter 字段：`title`、`date`、`cover`、`tags`（数组，如 城市/风光/人像）、`order`（排序权重，数字）、`draft`（布尔，默认 false）
- [x] 3. posts frontmatter 字段：`title`、`date`、`cover`、`tags`、`draft`
- [x] 4. 约定 loader：series 用 `src/content/series/<系列标识>/index.md`（glob 到子目录）；posts 用 `src/content/posts/<日期-标题>.md`
- [x] 5. 写 `src/utils/imageUrl.ts`：所有图片 URL 唯一生成函数，本地/未来 R2 只改这一个文件（边界③）
- [x] 6. 定义照片元数据 sidecar 的 TS 类型（机型/镜头/焦距/光圈/快门/ISO/日期），文件名锁定为 `photos.meta.json`：系列放 `src/content/series/<标识>/`，随笔放同名资源文件夹 `src/content/posts/<日期-标题>/`（2026-09-24 补拍板：随笔与系列同通道）；供 import-photos 与灯箱共用
- [x] 7. 造种子内容：1 个示例系列 + 1 篇示例随笔，均非草稿。图片先用任意工具手工压 1–2 张占位（长边 2560 WebP 同规格）+ 手写最小 `photos.meta.json`；正式 5 张图待 import-photos 模块验证时用脚本回填替换
- [x] 8. 验证：`npm run build` 通过；在任意 .astro 里 `getCollection('series')` 有类型提示，写错字段名会报类型错误

## 验收标准

- [x] 两类 schema 字段与 §2 完全一致，扩展遵循"新 collection 不动旧结构"原则（边界④）
- [x] 全站图片引用只经 `imageUrl`，无手写相对路径

## 设计约束（勿偏离）

- 正文可选写拍摄手记，也可以只有照片（body 允许为空）
- 草稿条目不得出现在公开页面的 collection 查询结果里（查询处统一过滤）
