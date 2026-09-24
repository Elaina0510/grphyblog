# Tasks · 项目骨架（project-scaffold）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §3、§4 ｜ 依赖：无（首个模块）
> 目标：搭起 Astro 静态站骨架，目录与配置与设计 §3 完全一致，空站可跑通 dev/build。

## 最小任务清单

- [x] 1. 用 Node LTS 初始化 Astro（最新稳定大版本，minimal 模板，不引入任何前端框架）
- [x] 2. 按 §3 建目录：`src/content/series/`、`src/content/posts/`、`src/components/`、`src/layouts/`、`src/styles/`
- [x] 3. 建 `scripts/`、`public/admin/`（占位空目录 + .gitkeep）
- [x] 4. 写 `.gitignore`：排除 `raw/`、`thumbs/`、`node_modules/`、`dist/`、`.astro/`
- [x] 5. `astro.config.mjs` 集中图片优化参数（展示版长边 2560、缩略图长边 800、格式 WebP），落实边界②"改清晰度只改一处"
- [x] 6. `package.json` 登记脚本：`dev`、`build`、`preview`；预留 `import`（指向 scripts/import-photos.mjs，脚本本体在 import-photos 模块实现）
- [x] 7. 在 `package.json` 写 `engines.node` 锁定 LTS 主版本；README 记录本地环境要求（Node LTS 安装步骤面向"会装软件不写代码"的用户）
- [x] 8. `git init` + 首次提交（提交前确认 `raw/`、`thumbs/` 已被忽略）
- [x] 9. 验证：`npm run dev` 打开空白首页正常、`npm run build` 零报错

## 验收标准

- [x] dev/build 两条命令全部通过，无框架依赖残留
- [x] 目录树与 §3 图一致；图片参数只存在于 `astro.config.mjs` 一处

## 设计约束（勿偏离）

- 纯静态输出（SSR 关闭）；不引入 React/Vue/Svelte
- 原图与缩略图暂存目录不进 Git（§4 原图策略）
