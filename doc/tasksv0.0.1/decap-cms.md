# Tasks · Decap 后台（decap-cms）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §3、§4 ｜ 依赖：content-model（schema 对齐）、deployment（线上 OAuth 回调需要真实域名；本地可先行大半）
> 目标：`/admin` 网页后台——仅文字操作：新建系列条目、写手记/正文、调排序、选已有封面、草稿开关；全程无照片上传通道。

## 最小任务清单

- [ ] 1. `public/admin/index.html`：引入 Decap CMS 脚本（锁定当前版本 URL，不用 latest）+ 防搜索引擎收录 meta
- [ ] 2. `public/admin/config.yml` backend：GitHub backend，指向本站仓库与主分支；`site_url`/`display_url` 用 Pages 域名
- [ ] 3. 产出 `doc/github-oauth-setup.md`：OAuth App 逐步注册指引（用户网页点击可完成）；client_id 填入 config.yml；不引入 Netlify 等第三方代理
- [ ] 4. series 编辑器（folders 类型）：路径映射 `src/content/series/<name>/index.md`；字段=title/date/tags/order/draft + 手记正文编辑器 + cover 图字段
- [ ] 5. posts 编辑器（files 类型）：文件名模式 `<日期>-<标题>.md`；字段与 content-model schema 一一对应
- [ ] 6. 照片禁上传：cover 字段配 `media_library` 只从已入库照片选取；全局关闭后台文件上传入口——以 Decap 当前版能力为准，若无法完全关闭，加构建期检查兜底（发现新增非脚本来源图片文件即报警）
- [ ] 7. draft 开关 = 发布/撤下按钮；order 数字 = 排序调整；验证改后自动 commit 到仓库
- [ ] 8. Editor Preview 简易模板：CMS 运行时无法 import Astro 的 TS 工具函数，改为在 config.yml preview 中以 `public_folder` 映射出与 `imageUrl` 相同的基准路径；两处文件头注释互指，约定"改路径规则必须同步另一处"，验收时人工比对预览图与线上图一致
- [ ] 9. 本地验证：本地 git gateway 代理登录，改一条文字 → 确认生成本地 commit → reset 丢弃
- [ ] 10. 线上验证（依赖 deployment 完成）：`https://<站点>/admin/` OAuth 登录 → 改标题 → GitHub 看到机器人 commit → 自动重新构建上线
- [ ] 11. 风险备案落地：config.yml 顶部注释注明"若 Decap 停维迁移 Sveltia，影响面仅此目录"（§3 备案）

## 验收标准

- [ ] 里程碑 3 口径：网页后台改文字/调排序/选已有封面 → 自动发布，全程传不了也传不进新图片
- [ ] 只有持 OAuth 授权且对仓库有写权限的 GitHub 账号能提交（仓库 public，天然仅站长可用）

## 设计约束（勿偏离）

- 后台仅文字操作（§4）；sidecar 与照片文件在后台一律只读展示或不出现
