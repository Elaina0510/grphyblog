# Tasks · 照片导入脚本（import-photos）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §3、§4（含 2026-09-24 随笔入库补拍板） ｜ 依赖：content-model（sidecar 类型、目录约定）
> 目标：实现 `npm run import`，把 `raw/` 原图批量加工为展示图+缩略图+EXIF sidecar，写入指定系列或随笔资源夹；全站照片一律出自本脚本。

## 最小任务清单

- [x] 1. 建 `scripts/import-photos.mjs` 骨架：扫描 `raw/` 中所有图片（v1 支持 jpg/png；HEIC 需 libvips-heif 编译支持，sharp 默认预构建二进制不含，列为试验项不进 v1 承诺）
- [x] 2. 增量识别：对比目标内容目录已有产物，只处理 `raw/` 中的"新图"，重复运行幂等（跳过已导入）
- [x] 3. 依赖 sharp：压展示版（长边 2560 WebP，目标约 300–600KB，质量参数放 `astro.config.mjs` 或脚本常量集中处）
- [x] 4. 依赖 sharp：压缩略图（长边 800 WebP，≤60KB），中间产物写 `thumbs/`
- [x] 5. 依赖 exifr：读 EXIF（机型/镜头/焦距/光圈/快门/ISO/日期），缺失字段容错留空
- [x] 6. 写 sidecar：目标文件夹内 `photos.meta.json`（名称由 content-model 任务 6 锁定），逐张记录文件名↔EXIF↔宽高↔产物路径；脚本生成与维护，人工不编辑
- [x] 7. 系列模式产物落位：展示图 → `src/content/series/<标识>/images/`、缩略图 → `.../thumbnails/`（路径经 imageUrl 约定）
- [x] 8. 随笔模式（补拍板）：`--post <日期-标题>` → 产物与 sidecar 写入同名资源文件夹 `src/content/posts/<日期-标题>/`；对应 `.md` 不存在则生成 frontmatter 骨架（`draft: true`）
- [x] 9. CLI：`npm run import -- --series <标识>` 或 `--post <日期-标题>`；两参数皆缺省时交互式询问目标类型与标识
- [x] 10. 系列不存在则当场新建：建目录 + 生成 `index.md`（frontmatter `draft: true`）
- [x] 11. 原图留在 `raw/` 原地不动、不移不删；脚本结束打印导入清单（新增 N 张、跳过 M 张、目标条目）
- [x] 12. `package.json` 登记 `import` 脚本（scaffold 已留占位）
- [x] 13. 验证：用用户现有 5 张图跑通 `raw → 压缩 → sidecar → 本地预览`；再次运行同一批图确认全部跳过；另跑 1 张进随笔模式验证落位
- [x] 14. README 增加"发布流程"章节：丢图进 raw/ → `npm run import` → 本地预览 → 去 draft → `git push`

## 验收标准

- [x] 一条命令完成全流程，无需人工干预参数（除非交互选目标）
- [x] 展示图 ≤800KB、缩略图 ≤80KB（对齐 §6 预算）
- [x] 原图不进 Git（`.gitignore` 已排除，脚本不做提交动作）
- [x] 全站入库照片（含随笔）都有 sidecar——"所有照片都出自脚本"对灯箱成立

## 设计约束（勿偏离）

- 照片一律本地脚本压缩入库，原图不上传，`/admin` 不经手照片（§状态说明、§4）
- sidecar 只供灯箱展示读取，不经后台人工编辑
