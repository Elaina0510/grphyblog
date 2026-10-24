# Tasks · 内容后台 v2（自建单页，取代 Sveltia CMS）

> 版本 v0.1.1 ｜ 来源：grphyblog 照片池化改造决策 ｜ 依赖：content-model（schema 扩展）、import-photos（--pool 模式）
> 目标：`/admin` 一个自建单页后台，覆盖「照片池 / 系列 / 随笔」三个板块，
> 含**带缩略图的照片勾选网格**、拖拽排序、富文本 markdown 编辑、浏览器直传 + 本地 import 双上传通道。
>
> **为什么换掉 Sveltia**：Sveltia 的 relation widget 选项结构只有 `{label, value, searchValue}`，
> 无缩略图；relation 也引用不到 asset collection（MF() 只查 collections/_singletons 两张表）。
> 后台要的核心交互（勾选时看缩略图）在通用 CMS 框架内无法实现，故自建。
> Sveltia 时代对照片"不能从后台进来"的三层防线随之解除——改为：**上传通道明确化 + 构建期校验重写**。

## 现状盘点（2026-10-24 实测，改造前的事实基线）

| 项 | 实测值 |
|:--|:--|
| 系列条目 | 4 个：`city-lights`(2图) / `daily-frames`(5图) / `street-notes`(75图) / `wip-empty`(0图) |
| 随笔条目 | 3 个：`2026-07-02-alley-light`(0图) / `2026-08-10-foggy-morning`(1图) / `2026-09-21-morning-fog`(1图) |
| 照片总数 | 84 张（展示版 84 + 缩略图 84 = 168 个文件） |
| sidecar 份数 | 5 份（有图的条目各一份） |
| **cover 指向不存在图片的条目** | **2 个**：`wip-empty` 与 `2026-07-02-alley-light`，cover 均为 `photos/tbd.webp` |
| frontmatter 行尾 | 现有 md 为 **CRLF**（`\r\n`），改写时须保持或统一归一 |
| 其他引用相对路径的地方 | `src/data/site.json` 的 `featured.photos[]`，形如 `{collection, id, file}`，共 3 条 |

## 已知坑（改造必须逐条处理，漏一个就红）

- **K1 坏 cover**：上表那 2 个条目的 cover 是占位串，池化后 `cover` 改为照片 ID，这俩条目没有合法封面。**已定（A5）**：`cover: string` 允许空串，前台空则退回 `photos[0]`；`wip-empty` 这种 photos 也为空的条目，前台整块封面区不渲染（后台可先给池里某张图顶上）。
- **K2 正文插图语法**：`2026-09-21-morning-fog.md` 正文写着 `![...](2026-09-21-morning-fog/photos/dawn-01.webp)`。`postIllustrations.ts`（353 行 + 20 个单测）整套机制建立在"从渲染 HTML 里解析相对路径 → 问 sidecar"上，不是改个路径能了事。
- **K3 site.json 的 featured**：首页精选区按 `{collection, id, file}` 三元组解析照片，池化后三元组失效，必须同步改（D 组原稿漏了这项）。
- **K4 photoCount 兜底变死代码**：池化后照片只有一份全局 sidecar，"缺 sidecar 就数 photos/ 下的 webp"的兜底路径不再存在；`resolveSeriesCount` 的 `files` 入参与告警分支要删或改。
- **K5 check-image-sources 会误伤 JSON**：它 `walkFiles` 全扫 `src/content`，新目录 `pool/` 下要放 `photos.meta.json`。R1 改写时须确认只拦图片扩展名、不拦 JSON。
- **K6 原图文件不动**：迁移只搬 webp 产物，`raw/` 原图永不移动（import-photos 的硬约束，有源码扫描用例守住）。

## 最小任务清单

### A. 内容模型（content-model 扩展）
- [x] A1. 新增 `src/content/pool/photos/`：展示版 + 缩略图统一落这里
- [x] A2. 新增全局 sidecar `src/content/pool/photos.meta.json`：PhotoEntry 数组
- [x] A3. series schema 增加 `photos: string[]`（照片 ID 列表，顺序 = 前台照片流顺序）
- [x] A4. posts schema 同步增加 `photos: string[]`
- [x] A5. series/posts schema 的 `cover` 改为照片 ID（已定：`cover: string` 允许空串，前台空则退回 `photos[0]`）
- [x] A6. `src/utils/contentImages.ts` 支持池路径解析（`pool/photos/x.webp`），迁移期兼容旧条目路径
- [x] A7. `src/types/photoSidecar.ts` 头注中的位置约定（"系列放 <标识>/、随笔放 <日期-标题>/"）更新为池化口径

### B. import 脚本（import-photos 扩展）
- [x] B1. `--pool` 模式：raw/ → pool/photos/ + 追加全局 sidecar；不带 `--series`/`--post` 时默认进池
- [x] B2. `--migrate` 子命令，拆成四步各自可独立验证：
  - [ ] B2a. 文件搬运：5 个条目的 photos/ 下 168 个 webp 移入 `pool/photos/`，**原图不动**（K6）
  - [ ] B2b. sidecar 合并：5 份数组合并成 1 份全局 sidecar，按文件名去重（同一张图被多条目引用的情况）
  - [ ] B2c. frontmatter 回填：7 个条目的 `photos` 列表按原 sidecar 顺序生成；`cover` 从相对路径换算成照片 ID
  - [ ] B2d. 坏 cover 处理（K1）：`wip-empty` 与 `2026-07-02-alley-light` 按 A5 决策落地（cover 置空串、前台退回 photos[0]；`wip-empty` 的 photos 也空，封面块整块不渲染），迁移结束打印这两个条目的待办提醒
- [x] B3. 迁移/导入结束打印：清单（搬了几张、跳了几张）+ 各条目的 `photos` 列表 + 可复制的插图引用行

### C. 构建期检查（check-image-sources 重写）
- [x] C1. R1 改为：图片只能位于 `src/content/pool/photos/`；`src/content` 其他位置不得有图片（注意 K5，只拦图片扩展名）
- [x] C2. R2/R3/R4 改为校验全局 sidecar 与 pool/photos/ 成对
- [x] C3. R5 保持：public/ 下不许出现图片
- [x] C4. 新增 R6：frontmatter 的 `photos` 列表里每个 ID 必须存在于全局 sidecar
- [x] C5. `tests/unit/check-image-sources.test.ts` 全量重写（现有用例的夹具全是旧结构）

### D. 前台渲染
- [x] D1. series 详情页：按 `entry.data.photos` 顺序渲染照片流（不再按 sidecar 顺序）；封面 = `cover` 有值则取其 ID，空则 `photos[0]`，两者皆空则整块封面区不渲染
- [x] D2. posts 详情页，拆成两项分别落地：
  - [x] D2a. **插图引用语法（已定）**：`![说明](photo:照片ID)`——`photo:` 协议头 + 池内照片 ID，alt 即方括号内的说明文字；已写进 content-model 约定，后台插图按钮按此生成
  - [x] D2b. **postIllustrations 管线适配**：按 D2a 语法改造解析逻辑（`normalizeIllustrationPath` / `findSidecarIndex` / `processPostIllustrations` 的匹配口径），保留"不伪造宽高、不占空帧、重复引用复用帧号"三条既有契约；同步重写 20 个单测
- [x] D3. 首页 / 系列目录 / 随笔目录：张数口径改为 `photos.length`；封面解析改为按照片 ID 查池（同样按 A5 三级回退：cover → photos[0] → 无封面）
- [x] D4. `src/data/site.json` 的 `featured.photos` 结构改掉（K3）：三元组 `{collection,id,file}` → 照片 ID；首页 `resolvePhoto` 随之改写
- [x] D5. 旧正文一次性改写：把 `2026-09-21-morning-fog.md` 里那条相对路径引用转成 D2a 的新语法

### E. 自建后台（public/admin/，原生 JS + Vditor）
- [x] E1. GitHub contents API 客户端：token 登录（localStorage 可选记忆）、读文件、写文件、列目录
- [x] E2. 三板块导航：照片池 / 系列 / 随笔
- [x] E3. 池页：缩略图网格（800px thumb）、上传入口（浏览器直传 + 提示本地 import 命令）
- [x] E4. 编辑页：字段表单 + 照片勾选网格（缩略图 + 复选框 + 拖拽排序）+ Vditor 富文本
- [x] E5. 保存：拼 YAML frontmatter + 正文 → contents API PUT
- [x] E6. 浏览器直传（画质取舍已定）：Canvas 压 2560px WebP → PUT 进 pool/photos/ + 追加 sidecar（**EXIF 全空**——浏览器读不到，属既定取舍；宽高从产物读真值）；sidecar 里该条目标 `exifIncomplete: true`，池页与 EXIF 卡显示「EXIF 待补」角标；在意拍摄参数的图走本地 `npm run import --pool`

### F. 退役 Sveltia
- [x] F1. 删除 `public/admin/config.yml` 与 Sveltia index.html，替换为自建入口
- [x] F2. 删除 / 重写 `tests/unit/decap-cms.test.ts`（原为 config.yml 与 schema 对齐的往返测试）
- [x] F3. `src/utils/imageUrl.ts` 与 `contentImages.ts` 顶部关于 Sveltia public_folder 的同步注释更新
- [x] F4. 更新 `doc/admin-login-setup.md`（自建后台登录说明）

### G. 清理死代码（池化后不再成立的机制）
- [x] G1. `src/utils/photoCount.ts`：删掉"缺 sidecar 兜底 + 告警"分支（K4），或改造为纯 `photos.length` 取值；同步删/改 `tests/unit/photo-count.test.ts`
- [x] G2. 各页面里 `photosUnder(dir)` / `sidecarByDir[dir]` 的按条目兜底查询全部移除
- [x] G3. `src/content/posts/*/photos/` 等 5 个旧目录在 B2a 之后应为空目录，确认删除并确认 git 记录了移动

## 验收标准

- [x] 7 个条目迁移后 `npm run build` 全绿，前台照片流顺序与迁移前一致
- [x] `npm run check-images` 按新规则全绿；手工在错误位置放一张图能被拦下；`pool/photos.meta.json` 不误报
- [x] 2 个坏 cover 条目（K1）按 A5 三级回退落地：`2026-07-02-alley-light` 退回 photos[0] 或显示无封面，`wip-empty` 封面块整块不渲染，均不留占位死链
- [x] `2026-09-21-morning-fog` 的插图在新语法下仍能渲染（灯箱 + EXIF 卡正常）
- [x] 首页精选区 3 张照片改结构后仍渲染
- [ ] 后台能完成：浏览池（看缩略图）→ 新建系列 → 勾选照片（看缩略图 + 拖拽排序）→ 写正文 → 保存 → push → 上线
- [ ] 浏览器直传一张图后，前台能渲染（宽高/灯箱正常；EXIF 缺失不报错）
- [x] 全测试套件（vitest + playwright）绿

## 设计约束（勿偏离）

- 前台渲染、灯箱、EXIF 卡、import 管线、构建检查的既有契约尽量保留，只改数据来源
- 后台是纯静态 JS，无构建步骤、无框架，直接放 public/admin/ 随站点部署
- token 只进 localStorage，不进仓库；config.yml 随之消失，无密钥泄漏面
- `raw/` 原图永不移动、永不删除（import-photos 既有硬约束）
