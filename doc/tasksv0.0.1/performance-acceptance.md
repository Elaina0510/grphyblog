# Tasks · 性能与验收（performance-acceptance）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §6、§7 里程碑 5 ｜ 依赖：全部模块（末位执行）
> 目标：用真实数据过一遍性能预算与完整发布流程，手机+电脑双端验收；固化仓库体积监控口径。

## 执行状态（2026-09-26）

**本地已证（主 Agent 跑完）**

- [x] 1. 体积抽检脚本：新增 `scripts/audit-size.mjs` + `npm run audit:size`。现状全部在预算内（最大展示图 683KB<800KB、缩略图 64.7KB<80KB）。
- [x] 2. 图片属性审计：`npm run audit:size -- --html` 扫描 dist 全部 HTML，16 个 `<img>` 全部有显式 width/height + loading 提示，0 违规。
- [x] 9. 仓库体积基线：写入 `doc/repo-size-log.md`（工作树≈12MB / `.git`≈9.4MB / dist≈3MB；~1GB 触发线 → R2 迁移〔预案A〕/ 孤儿分支重建〔预案B〕）。

**部分证（逻辑已测，运行时待真实数据）**

- [~] 3. 分批渲染：判定+批次算术由 `tests/unit/paginate-flow.test.ts` 覆盖（>30 触发、首屏 30、每批 20）。**运行时 IO 追加**当前种子全 <30 帧，未触发；需真实 >30 张系列（与任务 5 一并做）。
- [~] 4. Lighthouse（移动端模拟）：本地无 lighthouse 包且 npm 代理被阻断，改用 Playwright 移动模拟 + 4G 节流实测 Core Web Vitals 作代理指标——首页/系列/随笔/关于：**CLS 0、LCP 0.6–1.4s、单页传输 38–91KB**，字体已子集化（最大 21KB，非 1.44MB 全量）。**官方 Performance 分值 ≥90 需在你自己的 Chrome 里跑**（见下）。

**已由门禁 D 顺带证明**

- [x] 6. 纯文字流程演练 B：门禁 D 的 commit `05193e4`（Sveltia 令牌登录→改文字→自动 commit→Pages 重建）即本项。

**需你本人（真实浏览器 / 真机 / 真实照片，AI 无法代跑）**

- [ ] 4b. Lighthouse 官方分：Chrome DevTools → Lighthouse → 勾选 Mobile、Performance，跑首页 `/` 与 `/series/city-lights/`，两项 Performance ≥90。
- [ ] 5. 照片流程演练 A：真拍/取一批 >30 张图 → 丢 `raw/` → `npm run import -- --series <标识>` → 本地预览 → `/admin` 去掉 draft → push → 线上可见（顺带触发任务 3 的分批 IO）。
- [ ] 7. 手机端真机：灯箱手势切帧、View Transition 形变、双列缩略图、系统"减弱动效"开关各过一遍。
- [ ] 8. 可访问性：键盘-only 走全站（Tab/Enter/Esc 开关灯箱）、屏幕阅读器读帧号/EXIF、纸白底墨字对比度目测。

## 验收标准

- [x] §6 可本地量化的预算项通过（图片体积、显式宽高+懒加载、传输体积、CLS）。
- [ ] §6 Lighthouse 官方 ≥90（待你本机跑）。
- [ ] 用户本人独立完成演练 A + B（B 已过；A 待做）。
