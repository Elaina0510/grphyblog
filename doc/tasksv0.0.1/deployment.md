# Tasks · 部署上线（deployment）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §3、§8 ｜ 依赖：project-scaffold～about-404 全部页面可构建（里程碑 2）
> 目标：GitHub 仓库 → Cloudflare Pages 自动构建链跑通，push 即上线，revert 即回滚。

## 最小任务清单

- [ ] 1. 产出 `doc/account-setup.md`：GitHub 建仓（**public**）+ Cloudflare Pages 连接步骤（用户网页点击可完成的粒度，含免费档说明）
- [ ] 2. 推送主分支到 GitHub；确认 `.gitignore` 生效（raw/、thumbs/ 不在远端）
- [ ] 3. Cloudflare Pages 配置：构建命令 `npm run build`、输出目录 `dist`、Node 版本与 `engines` 一致（环境变量形式）
- [ ] 4. 首次构建排错：云端构建通过，`*.pages.dev` 可访问全部 6 类页面
- [ ] 5. 推送链路验证：改一个标点 → push → 自动重新构建 → 线上生效（1~2 分钟内）
- [ ] 6. 回滚演练：GitHub revert 一次提交 → 自动构建恢复旧版
- [ ] 7. 404 路由确认：访问不存在路径返回 404 页面（Pages 对 `dist/404.html` 的识别）
- [ ] 8. README 补"部署与回滚"章节：上述链路的白话操作卡

## 验收标准

- [ ] 用户全程只用 git push / GitHub 网页 revert，不登 Cloudflare 控制台也能完成日常发布与回滚
- [ ] 域名策略：v1 用 `*.pages.dev` 免费子域，自定义域名仅留 TODO 不做
