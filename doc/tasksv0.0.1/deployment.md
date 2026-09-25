# Tasks · 部署上线（deployment）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §3、§8 ｜ 依赖：project-scaffold～about-404 全部页面可构建（里程碑 2）
> 目标：GitHub 仓库 → Cloudflare Pages 自动构建链跑通，push 即上线，revert 即回滚。

## 最小任务清单

- [x] 1. 产出 `doc/account-setup.md`：GitHub 建仓（**public**）+ Cloudflare Pages 连接步骤（用户网页点击可完成的粒度，含免费档说明）
- [x] 2. 推送主分支到 GitHub；确认 `.gitignore` 生效（raw/、thumbs/ 不在远端）｜ 2026-09-24 经用户授权后代跑 `git remote add` + `git push -u origin main`；推后 `git ls-tree origin/main` 复核：远端 160 文件、**无 raw/thumbs**，HEAD 与 origin/main 一致
- [x] 3. Cloudflare Pages 配置：构建命令 `npm run build`、输出目录 `dist`、Node 版本与 `engines` 一致（环境变量形式）｜ 本地已建 `.nvmrc`=`24` 并测对齐；Pages 项目 env `NODE_VERSION=24` 属云端填写（在 account-setup.md §4 已给出）
- [x] 4. 首次构建排错：云端构建通过，`*.pages.dev` 可访问全部 6 类页面 ｜ 用户部署 `grphyblog.pages.dev` 后主 Agent WebFetch 抽验：首页/系列列表/随笔列表/关于均正常渲染、不存在路径返回 404、draft 系列未出现在列表
- [x] 5. 推送链路验证：改一个标点 → push → 自动重新构建 → 线上生效（1~2 分钟内）｜ 用户在 GitHub 网页编辑随笔正文提交后，Pages 自动重构建、线上刷新可见改动 = 发布链路通
- [x] 6. 回滚演练：GitHub revert 一次提交 → 自动构建恢复旧版 ｜ 用户以「再编辑一次改回原状」的等效路径在线上确认恢复；标准 Revert 按钮路径已写入 `account-setup.md §6` 备用
- [x] 7. 404 路由确认：访问不存在路径返回 404 页面（Pages 对 `dist/404.html` 的识别）｜ 本地：`dist/404.html` 存在 + `about-404.spec.ts` preview 覆盖同构 404；**线上已确认**：部署 `grphyblog.pages.dev` 后访问不存在路径返回 HTTP 404
- [x] 8. README 补"部署与回滚"章节：上述链路的白话操作卡

## 验收标准

- [x] 用户全程只用 git push / GitHub 网页 revert，不登 Cloudflare 控制台也能完成日常发布与回滚 ｜ 已验证：网页编辑提交→Pages 自动重构建上线，恢复同理
- [x] 域名策略：v1 用 `*.pages.dev` 免费子域，自定义域名仅留 TODO 不做 ｜ 现用 `grphyblog.pages.dev`；自定义域名 TODO 见 `account-setup.md §9`
