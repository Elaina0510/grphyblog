# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro 5+（Content Collections + 类型安全 schema）· sharp · exifr · Sveltia CMS（仅文字操作）· Cloudflare Pages · Node LTS。纯静态输出，无前端框架依赖。技术栈已在 doc/designv0.0.1.md 拍板，非开放决策。

## Users

- **站长本人（摄影师）**：高频发布（两年内上千张），在浏览器完成全部文字管理，照片发布只走"丢文件进 raw/ + 一条本地命令"。
- **访客**：朋友、熟人与偶然读者；以手机浏览为主，看图体验优先。不追求流量，无转化目标。

## Product Purpose

个人摄影作品陈列——照片为主角，自己记录与分享。成功标准：文字与页面管理全程在浏览器完成；照片发布只需本地一条命令；手机上看图流畅；仓库与构建长期可持续。

## Positioning

系列化的个人影像档案：照片一律本地脚本压缩入库（展示版 + 缩略图 + EXIF sidecar），原图永不上传；网页后台只碰文字。结构稳定、功能以"新增 collection"方式扩展，预留 imageUrl → R2 图床的整体迁移出口。

## Operating Context

相机导出 → `raw/` → `npm run import -- --series <标识>`（压缩 + 缩略图 + EXIF sidecar）→ 本地预览 → `git push` → Cloudflare Pages 自动上线。文字修订在 `/admin`（Sveltia CMS，粘贴 GitHub 访问令牌登录）。原图仅存本地，备份由用户自行负责。回滚 = GitHub revert 一次提交。

## Capabilities and Constraints

- 性能预算：首页/系列页 Lighthouse Performance ≥ 90（移动端模拟）；缩略图 ≤ 80KB、展示图 ≤ 800KB；全部懒加载 + 显式宽高；单页 > 30 张分批渲染（IntersectionObserver）。
- 内容模型：系列 = `src/content/series/<标识>/index.md` + 照片；随笔 = `src/content/posts/<日期-标题>.md`；frontmatter 含标题/日期/封面/标签/排序权重/草稿标记。
- CMS 约束：后台禁止上传文件；封面只能从已入库照片中选取；EXIF sidecar 由脚本维护、不经人工编辑。
- v1 页面：首页（精选区 + 最新）、系列列表/详情、随笔列表/详情、关于、404。
- v1 明确不做：标签页、站内搜索、RSS、编号分页、评论区、多语言、付费页、原图下载、防盗水印。
- 仓库体积触发线：工作树或 `.git` 超 ~1GB 时执行 R2 迁移或孤儿分支重建。

## Brand Commitments

- 站名/个人标识：**Justyou**（英文）/ **柚**（中文），两者并存使用，具体搭配由视觉设计决定。
- 站点语言：**中文为主 + 英文点缀**（界面词中文，标题/标签/细节可配英文小字）。
- 视觉素材来源即站长自己的摄影作品（见 Evidence）。

## Evidence on Hand

- 5 张真实原图：`raw/P1230857.jpg` 等（EXIF 实机：**Panasonic DMC-GX85**，M43 画幅，后期经 Adobe Photoshop；拍摄于 2026-09-17，广东顺德大良/逢简街拍纪实——红灯笼、骑楼招牌、市集伞面，暖调胶片感。1 张竖幅 3448×4592，4 张横幅 ~4592×3448）。
- 无客户、无流量数据、无第三方背书——**不得虚构任何此类内容**。
- 视觉稿阶段如需更多占位照片，只能复用这 5 张或明确标注为待替换素材。

## Product Principles

1. 照片是主角，界面退到其后；一切 chrome 为看图服务。
2. 单一照片通道：所有入库照片出自本地脚本，规格与元数据天然一致。
3. 结构与数据模型稳定，新功能只加不改。
4. 性能预算是硬约束，不是愿望（移动端优先）。
5. 高频发布下仓库可持续：体积有触发线、迁移有出口。

## Accessibility & Inclusion

移动端为主的使用场景要求触控目标与手势切图可靠；图片全部带显式宽高防布局抖动；未提出正式 WCAG 合规要求，按常规对比度与语义化标准执行。

## Open Decisions

- 视觉世界/配色/字体/版式：本次设计阶段决策中。
- 域名：v1 用 `*.pages.dev`，自定义域名后补。
