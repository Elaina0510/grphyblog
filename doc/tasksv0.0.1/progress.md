# 任务总进度 · v0.0.1

> 来源：`doc/designv0.0.1.md`（2026-09-23 定稿 + 视觉设计 §10）
> 模块划分：按功能层 12 个，每模块一份任务清单 `<module>.md`，勾选规则见文末。
> 更新时间：2026-09-24（审查修订后；8 项发现已落改，随笔入库方式已拍板）

## 模块清单（按推荐执行顺序）

| # | 模块 | 任务文件 | 依赖 | 对应里程碑 | 状态 |
|---|---|---|---|---|---|
| 1 | 项目骨架 | [project-scaffold.md](project-scaffold.md) | — | 1 | [x] |
| 2 | 内容模型 | [content-model.md](content-model.md) | 1 | 1 | [x] |
| 3 | 照片导入脚本 | [import-photos.md](import-photos.md) | 2 | 1 | [x] |
| 4 | 视觉系统 | [visual-system.md](visual-system.md) | 1 | 4 | [x] |
| 5 | 首页 | [home-page.md](home-page.md) | 2,4 | 4 | [x] |
| 6 | 系列页 | [series-pages.md](series-pages.md) | 2,3,4 | 4 | [x] |
| 7 | 随笔页 | [posts-pages.md](posts-pages.md) | 2,4 | 4 | [x] |
| 8 | 关于页与 404 | [about-404.md](about-404.md) | 4 | 4 | [x] |
| 9 | 灯箱 | [lightbox.md](lightbox.md) | 2,4,6 | 4/5 | [x] |
| 10 | 部署上线 | [deployment.md](deployment.md) | 1–8 可构建 | 2 | [x] |
| 11 | 内容后台（Sveltia，原 Decap） | [decap-cms.md](decap-cms.md) | 2,10 | 3 | [ ] |
| 12 | 性能与验收 | [performance-acceptance.md](performance-acceptance.md) | 全部 | 5 | [ ] |

**关键路径**：1→2→3（照片通道）与 1→4→5/6/7/8（页面通道）可并行；10 需页面可构建；11 的线上验证需 10 的域名；12 收尾。

## 里程碑映射

- [x] 里程碑 1 骨架+导入跑通 = 模块 1,2,3
- [x] 里程碑 2 首次上线 = 模块 10（前 8 模块可构建为前置）
- [ ] 里程碑 3 后台文字闭环 = 模块 11
- [x] 里程碑 4 视觉+灯箱（首页视觉稿已完成，剩实施与打磨）= 模块 4,5,6,7,8,9
- [ ] 里程碑 5 双端验收 = 模块 12

## 已知缺口 / 风险备注

- ⚠️ 根目录 `DESIGN.md` 缺失（§10 产物索引声明应有）；`.impeccable/design.json` 在。visual-system 任务 1 已安排重建。
- ⚠️ 当前工作区尚未 `git init`（project-scaffold 任务 8 处理）。
- ✅ 已拍板（2026-09-24）：随笔插图与系列同走导入脚本（`--post` 模式，含 sidecar），解决 §4"脚本只写系列"与 §5"任意照片进灯箱"的矛盾；已注记到 designv0.0.1.md §4，import-photos 模块新增任务 8/13。
- `raw/` 实测 5 张 jpg，与 import-photos 验证任务一致；`thumbs/` 已存在。种子内容改用手工压缩占位图（content-model 任务 7），正式产物由脚本回填。
- ✅ 模块 11 引擎变更（2026-09-25 实施记录）：原定 Decap 3.16，实跑**证伪**了「GitHub 直连 OAuth 免后端」——
  Decap 3.x 的 GitHub 后端 `authComponent()` 无条件渲染 Netlify 代理登录页（`api.netlify.com/auth`，
  `auth_type`/`client_id` 被整个忽略），本站托管 Cloudflare Pages → 代理回 404（读 CDN bundle +
  无头浏览器点击双重复现）。经用户拍板改用 **Sveltia CMS**（`@sveltia/cms@0.221.0`，CDN，读同一份
  config.yml / 同一套内容仓库），登录=**粘贴 GitHub 访问令牌**（`auth_methods: [token]`，禁掉了必挂的 OAuth 入口），
  零代理零自建服务器。影响面仅 `public/admin/` + 本模块单测/文档；内容模型与构建不动。
- ✅ 模块 11 任务 6「禁上传」三层（Sveltia 口径，2026-09-25）：
  ① cover 字段 `widget: string`（不渲染上传/拖拽区），只能填相对本条目的 `photos/xxx.webp`；
  ② `media_folder: public/uploads`（Sveltia 要有媒体落点才起得来）+ 单测 `auth_methods:[token]` 钉死无 OAuth；
  ③ 构建期兜底 `scripts/check-image-sources.mjs`（`npm run check-images`，挂在 `prebuild`）R5：
  `public/` 下一出现图片即构建失败 → 后台即便被绕过也传不进生产。
  剩余不可本地证明项（后台界面别的上传入口、真实登录/commit）→ 归任务 10 线上人工验收（需用户令牌）。
- ⚠️ HEIC 输入不进 v1（sharp 默认二进制不支持，import-photos 任务 1 已注明）；如需再评估编译依赖。
- ✅ 已拍板（2026-09-24 编排）：照片落位约定统一到 content-model 已实现并已测的口径——展示图 `src/content/<集合>/<条目>/photos/<base>.webp`、缩略图同目录 `photos/<base>.thumb.webp`（非 import-photos.md 任务7 字面的 `images/`+`thumbnails/` 双目录）。原因：避免返工已验证的 contentImages/sidecar/种子内容，保持照片通道单一口径；此偏离可逆，若用户坚持双目录命名再统一回改。
- ✅ 已拍板（2026-09-24 编排）：home-page 任务5 与 series-pages 任务2 对「系列张数共享工具函数」存在依赖倒挂（首页要用、定义却在系列页模块）。改由 home-page 先落地为 `src/utils/photoCount.ts`（纯函数、I/O 注入、sidecar 优先→缺 sidecar 兜底计数并构建期告警），series-pages 模块直接复用、不得重复实现。

## 勾选规则

- 模块 md 内：单个子任务完成并自测通过即勾 `[x]`；验收标准区块全部满足后，回本表勾对应模块。
- 本表 `[x]` = 该模块任务清单 + 验收标准全部通过；任一设计偏离须先改 `doc/designv0.0.1.md` 或在此记录偏差原因。
