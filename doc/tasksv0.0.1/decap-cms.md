# Tasks · 内容后台（decap-cms → 实际落地为 Sveltia）

> 版本 v0.0.2 ｜ 来源：designv0.0.1.md §3、§4 ｜ 依赖：content-model（schema 对齐）、deployment（线上登录需真实域名；本地可先行大半）
> 目标：`/admin` 网页后台——仅文字操作：新建系列条目、写手记/正文、调排序、选已有封面、草稿开关；全程无照片上传通道。
>
> **引擎变更记录（实测后）**：原计划 Decap。实跑发现 Decap 3.x 的 GitHub 后端**只走 Netlify OAuth 代理**
> （`api.netlify.com/auth`），本站在 Cloudflare Pages → 代理回 404，「Login with GitHub」必然 Not Found
> （`auth_type: github` + `client_id` 被整个忽略——已读 CDN bundle 源码 + 无头浏览器点击复现）。
> 经用户确认，改用 **Sveltia CMS**（`@sveltia/cms`，Decap 的现役继任者，读同一份 config.yml / 同一套内容仓库），
> 登录走**粘贴 GitHub 访问令牌**（`auth_methods: [token]`，无第三方代理、无自建服务器）。
> 影响面仍**仅 `public/admin/` 一目录**（+ 本模块单测/文档），内容模型与 Astro 构建不动。

## 最小任务清单

- [x] 1. `public/admin/index.html`：引入 CMS 脚本（锁定 `@sveltia/cms@0.221.0`，不用 latest、不加 `type="module"`、无独立 CSS）+ 防收录 meta
- [x] 2. `public/admin/config.yml` backend：GitHub backend 指向本站仓库与主分支；`site_url`/`display_url` 用 Pages 域名；`auth_methods: [token]`
- [x] 3. 产出 `doc/admin-login-setup.md`：访问令牌生成 + 登录 + 验收逐步指引（取代旧 `doc/github-oauth-setup.md`，后者已删除；不再引入 Netlify 代理）
- [x] 4. series 编辑器（nested collection）：路径映射 `src/content/series/<name>/index.md`（`meta.path.index_file` + `nested.depth`）；字段=title/date/tags/order/draft + cover 文本字段 + 手记正文
- [x] 5. posts 编辑器（folder 类型，平铺）：文件名模式 `<日期>-<标题>.md`；字段与 content-model schema 一一对应
- [x] 6. 照片禁上传：cover 用 `widget: string`（无上传/拖拽控件）+ 构建期兜底 `npm run check-images`（media_folder 落 public/uploads，出现图片即构建失败）
- [x] 7. draft 开关 = 发布/撤下；order 数字 = 排序；改后自动 commit（本地由单测保证字段形状，线上 commit 见任务 10）
- [x] 8. 预览基准：Sveltia 自带编辑器预览，URL base 口径靠 config.yml 的 `public_folder`；`imageUrl.ts` 与 config.yml 头部互指注释仍在（旧 index.html 的 resolvePreviewUrl 镜像随引擎退役）
- [ ] 9. 本地验证（可选）：Sveltia「使用本地仓库」入口（浏览器文件系统 API）试改一条文字
- [ ] 10. **线上验证（门禁 D，需用户令牌）**：`https://<站点>/admin/` 用访问令牌登录 → 改标题 → GitHub 出现 commit → 自动重建上线；逐项过「能改不能传图」验收表
- [x] 11. 风险备案落地：config.yml/index.html 顶部注释记录「为什么换 Sveltia」与影响面仅 `public/admin/`

## 验收标准

- 单测（本模块，`tests/unit/decap-cms.test.ts`）+ `npm run build` 全绿 = 本地部分达成（已完成）。
- 任务 10 线上清单全绿 = 模块 11 / 里程碑 3 达成（待用户令牌登录）。
