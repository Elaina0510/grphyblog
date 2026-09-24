# Tasks · 视觉系统（visual-system）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §10、`doc/preview/home.html`、`.impeccable/design.json` ｜ 依赖：project-scaffold
> 目标：把已定稿的"摄影 zine · 自印书"视觉系统落成 token + 版式骨架 + 三件套组件，后续页面只组装不改样式源。

> ⚠️ 前置缺口：§10 产物索引声明的根目录 `DESIGN.md` 当前不存在（`.impeccable/design.json` 在）。以 design.json + §10 + `home.html` 视觉稿为事实源，先补齐 DESIGN.md。

## 最小任务清单

- [x] 1. 依 `.impeccable/design.json` + §10 + `doc/preview/home.html` 重建根目录 `DESIGN.md`（token 表 + 八节），作为后续所有页面/组件唯一规范
- [x] 2. `src/styles/global.css`：CSS 自定义属性 token——纸白 `#F2F1EC`、墨 `#26241F`、朱砂 `#A03B28`（面积 ≤5%，仅"盖章级"强调）、夜底 `#191816`
- [x] 3. 字体接入：思源宋体（书名/章题 900）、思源黑体（正文 16.5px/行高 1.9）、Courier Prime（页码/EXIF/微标签）；中文字体子集化或分片加载以守 §6 性能预算
- [x] 4. 版式骨架：左缘 76px 固定书脊（含书脊导航组件）+ 1280 容器；竖排工具类（书脊导航、章题、开场书名用）
- [x] 5. 全局节奏：章间留白 `clamp(72px,12vh,128px)`；唯一缓动曲线 `cubic-bezier(.16,1,.3,1)`；入场 rise 统一编排
- [x] 6. 降级：`prefers-reduced-motion` 下全部动效直出
- [x] 7. 组件·图版：落纸投影 + zoom-in；显式宽高占位防抖动 + 懒加载（对齐 §6/§10 性能对齐条）
- [x] 8. 组件·页码片：帧号显示，Courier Prime
- [x] 9. 组件·拍摄单：EXIF 说明签（示例值以朱砂 ※ 标注样式）
- [x] 10. 站点标识组件：**柚**（中文）/ **Justyou**（拉丁）并用，用于书脊/开场
- [x] 11. 验证：做一个临时演示页摆三件套 + 书脊 + 跨页比例 1/3 文字 · 2/3 图版，与 `home.html` 视觉稿并排比对通过

## 验收标准

- [x] 样式值只存在于 styles 目录（设计变量集中一处，§3）；组件层无硬编码色值/字号
- [x] 手机（375px）与桌面（1280）两档下三件套与书脊无错位

## 设计约束（勿偏离）

- 照片承担全部色彩，UI 层不得增加新色相
- 视觉稿实现语言用 Astro 原生组件（无前端框架依赖，与 §3 技术栈一致）
