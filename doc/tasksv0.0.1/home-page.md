# Tasks · 首页（home-page）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §5、§10、`doc/preview/home.html` ｜ 依赖：content-model、visual-system
> 目标：按视觉稿把首页静态化——翻"跨页"而非扫网格：开场跨页 + 精选区（手动挑图）+ 最新系列/随笔。

## 最小任务清单

- [ ] 1. 建 `src/layouts/Base.astro`：书脊 + 容器 + 全局 head（字体/OG/favicon）骨架，供所有页面复用
- [ ] 2. `src/pages/index.astro` 开场跨页：1/3 文字 · 2/3 图版（对照 `home.html`，中文竖排书名 + 柚/Justyou 标识）
- [ ] 3. 精选区数据源：站点级配置 `src/data/site.json` 的 `featured` 字段（与 about-404 模块共用同一文件），手动填"系列标识 + 照片文件名"挑入口图
- [ ] 4. 精选区渲染：入口图用图版组件 + 页码片，点击进对应系列详情（灯箱接线在 lightbox 模块）
- [ ] 5. 最新系列区：`getCollection('series')` 排除 draft、按 `order`/日期取前 N，卡片=封面+标题+日期+张数（张数复用 series-pages 任务 2 的共享工具函数）
- [ ] 6. 最新随笔区：`getCollection('posts')` 排除 draft、时间倒序取前 N
- [ ] 7. 移动端降级：跨页在窄屏退化为单列/上下堆叠（守 §10 结构）
- [ ] 8. 验证：本地预览与视觉稿逐屏比对；精选图改动 JSON 即生效、不碰代码（边界①）

## 验收标准

- [ ] 首页静态生成，Lighthouse 移动端表现留待 performance-acceptance 复测（≥90）
- [ ] 页面所有图片显式宽高 + 懒加载

## 设计约束（勿偏离）

- v1 首页无分页、无标签页、无搜索入口（§5 暂不做）
- 朱砂仅盖章级语义，禁止大面积使用
