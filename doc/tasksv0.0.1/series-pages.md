# Tasks · 系列页（series-pages）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §5、§10 ｜ 依赖：content-model、import-photos（照片与 sidecar 数据源）、visual-system
> 目标：系列列表（目次点线行）+ 系列详情（章节题行 → 满版跨页 → 对置手记 → 照片流），全部静态生成。

## 最小任务清单

- [ ] 1. `src/pages/series/index.astro`：系列列表按 §10"目次点线行"排版（封面+标题+日期+张数），排除 draft、按 `order` 排序
- [ ] 2. 系列张数来源：优先读该系列 sidecar（`photos.meta.json`，名称由 content-model 锁定）条目数；sidecar 缺失时构建期数 `images/` 文件数兜底并打印警告。抽成共享工具函数，首页卡片同用它（避免运行时逻辑）
- [ ] 3. `src/pages/series/[id].astro` + `getStaticPaths`：遍历 series collection 输出 `/series/<标识>/`
- [ ] 4. 详情页结构：章节题行（竖排）→ 封面满版跨页 → 拍摄手记（左右对置排版）→ 照片流
- [ ] 5. 照片流渲染：按 sidecar 顺序输出图版组件 + 页码片（帧号）；手记为空时结构自动省略
- [ ] 6. 灯箱接线准备：每张图版挂 `data-lightbox` 数据集（系列帧列表 + sidecar 元数据引用），交互本体在 lightbox 模块
- [ ] 7. 长列表分批：单系列照片 > 30 张时 IntersectionObserver 追加渲染（§6）
- [ ] 8. 移动端：缩略图/图版双列起步，手记对置退化为单列上下排
- [ ] 9. 验证：用种子系列走完 列表 → 详情 → 手记为空/非空 两种排版；draft 系列 404

## 验收标准

- [ ] 新增一个系列只需 `npm run import` + 后台写字，不改任何代码（边界①）
- [ ] 详情页图片全部显式宽高，无布局抖动
