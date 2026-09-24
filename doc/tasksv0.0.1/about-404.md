# Tasks · 关于页与 404（about-404）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §5、§10 ｜ 依赖：content-model、visual-system
> 目标：关于页（版权页 colophon 形态）+ 404 引导页，站点级配置落地。

## 最小任务清单

- [x] 1. 建 `src/data/site.json`（若 home-page 未先建则此处建）：站点名/标识（柚 · Justyou）、简介文案、社交/联系链接列表、精选图引用
- [x] 2. `src/pages/about.astro`：按 §10"版权页（colophon）"排版——书名/作者/出版信息式结构，展示简介 + 社交链接（Courier Prime 微标签）
- [x] 3. `src/pages/404.astro`：zine 风格"此页缺失"引导 + 回首页链接（静态页，构建输出自动生效，验证 Cloudflare Pages 下可命中）
- [x] 4. 书脊导航接线：首页/系列/随笔/关于 四项在 Base 布局统一渲染
- [x] 5. 验证：改 `site.json` 文案 → 重建即生效；访问不存在路径出 404 页且可回首页

## 验收标准

- [x] 关于页与 404 完全复用 visual-system token，无新增样式源
