# 任务总进度 · v0.0.1

> 来源：`doc/designv0.0.1.md`（2026-09-23 定稿 + 视觉设计 §10）
> 模块划分：按功能层 12 个，每模块一份任务清单 `<module>.md`，勾选规则见文末。
> 更新时间：2026-09-24（审查修订后；8 项发现已落改，随笔入库方式已拍板）

## 模块清单（按推荐执行顺序）

| # | 模块 | 任务文件 | 依赖 | 对应里程碑 | 状态 |
|---|---|---|---|---|---|
| 1 | 项目骨架 | [project-scaffold.md](project-scaffold.md) | — | 1 | [x] |
| 2 | 内容模型 | [content-model.md](content-model.md) | 1 | 1 | [ ] |
| 3 | 照片导入脚本 | [import-photos.md](import-photos.md) | 2 | 1 | [ ] |
| 4 | 视觉系统 | [visual-system.md](visual-system.md) | 1 | 4 | [ ] |
| 5 | 首页 | [home-page.md](home-page.md) | 2,4 | 4 | [ ] |
| 6 | 系列页 | [series-pages.md](series-pages.md) | 2,3,4 | 4 | [ ] |
| 7 | 随笔页 | [posts-pages.md](posts-pages.md) | 2,4 | 4 | [ ] |
| 8 | 关于页与 404 | [about-404.md](about-404.md) | 4 | 4 | [ ] |
| 9 | 灯箱 | [lightbox.md](lightbox.md) | 2,4,6 | 4/5 | [ ] |
| 10 | 部署上线 | [deployment.md](deployment.md) | 1–8 可构建 | 2 | [ ] |
| 11 | Decap 后台 | [decap-cms.md](decap-cms.md) | 2,10 | 3 | [ ] |
| 12 | 性能与验收 | [performance-acceptance.md](performance-acceptance.md) | 全部 | 5 | [ ] |

**关键路径**：1→2→3（照片通道）与 1→4→5/6/7/8（页面通道）可并行；10 需页面可构建；11 的线上验证需 10 的域名；12 收尾。

## 里程碑映射

- [ ] 里程碑 1 骨架+导入跑通 = 模块 1,2,3
- [ ] 里程碑 2 首次上线 = 模块 10（前 8 模块可构建为前置）
- [ ] 里程碑 3 后台文字闭环 = 模块 11
- [ ] 里程碑 4 视觉+灯箱（首页视觉稿已完成，剩实施与打磨）= 模块 4,5,6,7,8,9
- [ ] 里程碑 5 双端验收 = 模块 12

## 已知缺口 / 风险备注

- ⚠️ 根目录 `DESIGN.md` 缺失（§10 产物索引声明应有）；`.impeccable/design.json` 在。visual-system 任务 1 已安排重建。
- ⚠️ 当前工作区尚未 `git init`（project-scaffold 任务 8 处理）。
- ✅ 已拍板（2026-09-24）：随笔插图与系列同走导入脚本（`--post` 模式，含 sidecar），解决 §4"脚本只写系列"与 §5"任意照片进灯箱"的矛盾；已注记到 designv0.0.1.md §4，import-photos 模块新增任务 8/13。
- `raw/` 实测 5 张 jpg，与 import-photos 验证任务一致；`thumbs/` 已存在。种子内容改用手工压缩占位图（content-model 任务 7），正式产物由脚本回填。
- ⚠️ 模块 11 任务 6：Decap"全局禁止上传"以版本实际能力为准，兜底加构建期检查——实施时若发现配置不可达，先回来更新本清单再动手。
- ⚠️ HEIC 输入不进 v1（sharp 默认二进制不支持，import-photos 任务 1 已注明）；如需再评估编译依赖。

## 勾选规则

- 模块 md 内：单个子任务完成并自测通过即勾 `[x]`；验收标准区块全部满足后，回本表勾对应模块。
- 本表 `[x]` = 该模块任务清单 + 验收标准全部通过；任一设计偏离须先改 `doc/designv0.0.1.md` 或在此记录偏差原因。
