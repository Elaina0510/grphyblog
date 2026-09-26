# Tasks · 性能与验收（performance-acceptance）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §6、§7 里程碑 5 ｜ 依赖：全部模块（末位执行）
> 目标：用真实数据过一遍性能预算与完整发布流程，手机+电脑双端验收；固化仓库体积监控口径。

## 执行状态（2026-09-26）

**§6 图片体积预算修订（2026-09-26 拍板：保画质、放宽预算）**
- 首轮 75 张真机原图导入到 `street-notes` 后，31/75 张展示图超原 800KB 阈值（p95≈1.4MB、max≈1.7MB），缩略图 2/75 超 80KB（max≈147KB）。
- 两个方向：①降 quality 压回旧预算（损展示清晰度）；②放宽预算保画质。用户选 **②**。
- 落地：`DISPLAY_QUALITY`/`THUMB_QUALITY` **保持 82/64 不动**（不重导入），只把阈值改到 **展示 ≤2MB / 缩略 ≤160KB**，同步 `SIZE_BUDGET`、`audit-size.mjs`、`astro.config` 注释、设计文档 §6、PRODUCT、任务文档。代价：仓库增长更快（~1GB→R2 迁移线更早触及）、系列详情页传输更重（首页/列表仍只加载小缩略图，首屏不受影响）。
- 该系列仍为 draft、未 push；导入未碰 `raw/`、未跑 git。

**种子清理决策（2026-09-26 拍板：轻量隐去→实为"保留 + 只 noindex 演示页"）**
- `/visual-demo/`：加 `robots: noindex,nofollow`（不在导航、不在任何链接/sitemap，仅直接 URL 可达；路由保留给 visual-system 的 ~15 条 e2e）。
- `wip-empty`（0 帧空册）与 `alley-light`（纯文字随笔）：**保留已发布**。它们是 6 条测试断言的"优雅降级"活证据（空系列仍入列显示 0 帧 / 纯文字随笔不伪造图版灯箱）；draft 或删除会弄坏这些测试并把线上削到只剩 1 系列 + 1 随笔。二者是测试桩，非缺陷；真实内容灌入后首页"最新"会自然被顶替。

**本地已证（主 Agent 跑完）**

- [x] 1. 体积抽检脚本：新增 `scripts/audit-size.mjs` + `npm run audit:size`。§6 放宽后阈值 展示 ≤2MB / 缩略 ≤160KB；含 `street-notes` 75 张真图后，最大展示图 ≈1.7MB、最大缩略图 ≈147KB，全部在预算内。
- [x] 2. 图片属性审计：`npm run audit:size -- --html` 扫描 dist 全部 HTML，16 个 `<img>` 全部有显式 width/height + loading 提示，0 违规。
- [x] 9. 仓库体积基线：写入 `doc/repo-size-log.md`（工作树≈12MB / `.git`≈9.4MB / dist≈3MB；~1GB 触发线 → R2 迁移〔预案A〕/ 孤儿分支重建〔预案B〕）。

**部分证（逻辑已测，运行时待真实数据）**

- [x] 3. 分批渲染：判定+批次算术由 `tests/unit/paginate-flow.test.ts` 覆盖（>30 触发、首屏 30、每批 20）。**运行时 IO 追加已用真实数据验证**：临时把 `street-notes`（75 帧）设为已发布、Playwright 滚轮实测 → 首屏 30 → 逐批追加至 74/74 全部现出，`opacity`/`clip-path` 正常揭开、`naturalWidth` 0 破损（无白屏）。**此过程暴露并修复了两个真实运行时缺陷（见下）。**
- [x] 4. Lighthouse（移动端模拟）：**达标**。当前版 Lighthouse 无头跑线上两页 → 首页 Performance **93**、系列详情页 **100**（TBT 0–62ms、CLS 0、LCP≈1.2s、字体已子集化最大 21KB）。用户 PageSpeed Insights（服务器端当前版 Lighthouse）复核：系列页 **100**、首页 **90**，两页均 ≥90。（早前 Chrome DevTools 里量到系列 79 系 DevTools 内置 Lighthouse 版本偏旧 + 首次冷加载节流的偶发低分，当前版 Lighthouse 与 PSI 均不可复现。）

**已由门禁 D 顺带证明**

- [x] 6. 纯文字流程演练 B：门禁 D 的 commit `05193e4`（Sveltia 令牌登录→改文字→自动 commit→Pages 重建）即本项。

**真实数据回放暴露并已修复的运行时缺陷（2026-09-26，种子全 <30 时永不触发，故 10 个模块的既有测试都测不到）**

1. 系列页分批 CSS 命中不到 → 分批形同虚设：`src/pages/series/[id].astro` 的 `.plate[data-flow-hidden]{display:none}` 未包 `:global`。`.plate` 由子组件 `PhotoPlate` 渲染、自带 Astro 作用域，页面作用域选择器命不中 → 隐藏属性加了但 `display` 仍是 block，74 张图版全部常驻占位（等价于没分批）。修复：改成 `:global(.plate[data-flow-hidden])`。随笔页本就写了 `:global`，只有系列页漏了。
2. 高大 `.rise` 容器被比例阈值永久藏死 + 连累分批：入场动效 `Base.astro` 的观察器用 `threshold: 0.12`，而分批后的 `.flow-grid`（含 `.rise`）高度可达视口的十余倍 → 12% 永远进不满视口 → 永不加 `is-in` → 整块停在 `opacity:0` + `clip-path:inset(0 0 12%)`。真实用户看即"照片流整块不可见"；且祖先 `clip-path` 会把子图版的 IntersectionObserver 交集裁成空（`ratio:0`）→ 追加批次永不触发。修复三处：a) `threshold:0.12 → 0`（首像素进视口即揭开，根治高大容器）；b) 分批脚本不再观察文档末尾的空 `sentinel` div（零面积/末位不判相交），改为观察"当前最后一张可见图版"、揭示后重新指向；c) 移除对 sentinel 的依赖后首屏回到干净的 30 张。

验证：`npm run build` + `vitest run`（472 通过）+ `playwright test`（86 通过，含 rise 揭开用例）+ `audit:size -- --html` 全绿；street-notes 临时发布下 Playwright 滚轮实测 30→74 追加成立。**验证后已把 street-notes 复位为 draft**，等用户改名 + `/admin` 发布。

**需你本人（真实浏览器 / 真机 / 真实照片，AI 无法代跑）**

- [ ] 5. 照片流程演练 A：真拍/取一批 >30 张图 → 丢 `raw/` → `npm run import -- --series <标识>` → 本地预览 → `/admin` 去掉 draft → push → 线上可见（顺带触发任务 3 的分批 IO）。
- [ ] 7. 手机端真机：灯箱手势切帧、View Transition 形变、双列缩略图、系统"减弱动效"开关各过一遍。
- [ ] 8. 可访问性：键盘-only 走全站（Tab/Enter/Esc 开关灯箱）、屏幕阅读器读帧号/EXIF、纸白底墨字对比度目测。

## 验收标准

- [x] §6 可本地量化的预算项通过（图片体积、显式宽高+懒加载、传输体积、CLS）。
- [x] §6 Lighthouse 官方 ≥90：首页 90–93 / 系列详情页 100（当前版 Lighthouse + PageSpeed Insights 双测）。
- [ ] 用户本人独立完成演练 A + B（B 已过；A 待做）。
