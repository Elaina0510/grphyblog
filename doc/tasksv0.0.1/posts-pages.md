# Tasks · 随笔页（posts-pages）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §5 ｜ 依赖：content-model、visual-system
> 目标：随笔列表 + 详情，时间倒序、文字为主插图为辅。

## 最小任务清单

- [ ] 1. `src/pages/posts/index.astro`：列表按日期倒序（排除 draft），行式排版延续目次风格，与系列列表在书脊导航中并列
- [ ] 2. `src/pages/posts/[slug].astro` + `getStaticPaths`：slug 取自 `<日期-标题>.md` 文件名
- [ ] 3. 详情页：标题 + 日期 + 正文（Prose 样式：思源黑体 16.5px/1.9，zine 节奏留白）
- [ ] 4. 插图渲染：正文引用同名资源文件夹图片一律走 `imageUrl`，图版组件包裹，挂 `data-lightbox` 数据集；插图由 `npm run import -- --post <日期-标题>` 入库并带 sidecar（2026-09-24 补拍板），点击开灯箱、可显示拍摄单
- [ ] 5. 验证：种子随笔正常渲染；draft 随笔 404；列表倒序正确

## 验收标准

- [ ] 新建随笔 = 丢一个 md + 资源文件夹，零代码改动（边界①）
- [ ] 长文页面移动端可读（无横向溢出、图文间距符合 token 节奏）
