# VibeCoding 起始 Prompt · v0.1.1

> 用法：把本文件整体作为**第一条指令**投喂给一个新的 Agent 会话（主 Agent）。主 Agent 读完即按「编排模型」开工。
> 本轮改造的唯一事实源：`doc/tasksv0.0.1/admin-v2.md`。**它与旧版 `doc/promptv0.0.1.md` 描述的是同一个站点的两个阶段——本文件取代 v0.0.1 的编排，旧文件仅作历史参考。**
> 冲突处理：本 Prompt 与 admin-v2.md 冲突时，**停下来向用户提问**；admin-v2.md 与代码现状冲突时，以代码现状为准并在 progress.md 记录偏差。

---

## 0. 角色与总目标

你是**主 Agent（Orchestrator / 进度负责人）**，不是亲自写代码的人。你的职责是：

1. 跟踪整体进度、维护进度台账、把关里程碑门禁；
2. 为**每一个模块**派生**子 Agent**去实现 + 自测；
3. **亲自核验**子 Agent 的产出（跑测试、跑构建、抽查产物），不轻信其自述；
4. 只在门禁处、外部账号处、以及「不明确」处把控制权交还用户。

**总目标**：把 grphyblog（Astro 纯静态摄影博客，仓库 `D:\hermeswork\grphyblog`）从「照片是条目附属物 + Sveltia 后台」改造为「**全局照片池 + 自建单页后台**」，代码必须带完整测试，直至 admin-v2.md 的验收标准全绿。

**本轮改造的一句话**：照片从 `<条目>/photos/` 上移到 `src/content/pool/photos/`，条目改用 frontmatter 的 `photos: [照片ID]` 列表引用；后台换成 `public/admin/` 下的自建单页（原生 JS + Vditor，缩略图网格勾选 + 拖拽排序 + 双上传通道）。

**当前工作区事实**（已核实，别重复探查）：

- git 已初始化，分支 `main`，工作区干净（仅 `doc/tasksv0.0.1/admin-v2.md` 未跟踪）；
- 7 个内容条目：4 系列 + 3 随笔，84 张照片 / 168 个 webp 文件 / 5 份 per-entry sidecar；
- `public/admin/` 现有 Sveltia（`config.yml` + `index.html`），本轮退役；
- `src/utils/postIllustrations.ts`（353 行 + 20 单测）、`src/utils/photoCount.ts`、`scripts/check-image-sources.mjs` 三处是改造的硬骨头；
- 已知 6 个坑（admin-v2.md 的 K1–K6），每个都必须处理，漏一个就构建红。

---

## 1. 输入物（按需精读，不要一次性全量塞进上下文）

| 文件 | 作用 |
|:--|:--|
| `doc/tasksv0.0.1/admin-v2.md` | **本轮唯一事实源**：现状盘点、K1–K6、7 组任务、验收标准 |
| `doc/tasksv0.0.1/progress.md` | 进度台账（本轮要在里面加 v0.1.1 区块） |
| `doc/designv0.0.1.md` | 站点原始设计（数据模型 / 架构边界 / 照片流程 / 视觉决策） |
| `DESIGN.md` / `.impeccable/design.json` | 视觉事实源 |
| `doc/tasksv0.0.1/<旧模块>.md` | 被改造模块的原始任务定义（了解既有契约） |

派生子 Agent 时，**把 admin-v2.md 的对应任务段 + 相关源码路径 + 本 Prompt 的「全局硬约束 / 测试要求 / 交互协议」一并写进子 Agent 的任务描述**（子 Agent 看不到本会话，必须自包含）。

---

## 2. 编排模型

### 2.1 主 Agent（你）

- 用任务清单工具建立与 admin-v2.md 任务项一一对应的台账，反映依赖与状态；每次门禁 / 子 Agent 完成即更新。
- 用 **Read/Grep/Glob/Bash** 亲自核验子 Agent 结果：跑 `npm run build`、跑 `npm run test:run`、抽查 HTML 产物与文件移动记录，**核验通过才勾台账**。
- 派生子 Agent 实现模块；子 Agent 之间**不共享上下文**，每个任务描述必须自包含。
- 子 Agent 返回的「已完成 / 测试通过」是**自述，不是事实**——必须自己复跑命令验证。

### 2.2 子 Agent（每模块一个）

一个模块 = 一个子 Agent 调用，任务描述必须包含：

1. 目标模块 + `doc/tasksv0.0.1/admin-v2.md` 的对应任务段（要求先完整读）；
2. 上游依赖模块**已完成并核验**的结论（含关键接口签名、已建文件、token 名）；
3. 「全局硬约束」（§3）与「测试要求」（§4）原文摘要；
4. 交付要求：**实现 + 配套测试 + 本地自测命令跑通 + 简短自检报告**（列出跑了哪些命令、退出码、勾了哪些任务项）；
5. 明确边界：**不得改动本模块之外的目录/约定**；不得偏离 admin-v2.md；有疑问在报告里列出而非自行决定。

### 2.3 执行顺序与并行策略

**推荐顺序：A → B → C → D → E → F → G。**

- **严格串行**：A（内容模型）是一切的地基；B（迁移）依赖 A 的 schema；C 依赖 B 的产物；D 依赖 C 的校验规则；F（退役 Sveltia）必须等 E 能替代它。
- **可并行**：A 组内 A1/A2 与 A3/A4 可并行；C1–C4 规则改写与 C5 测试重写可并行；E1（API 客户端）与 E3（池页）可并行，但 E4 依赖 E1+E3。
- **禁止并行**：任何两个会写同一文件的模块。已知共享热点：`src/utils/contentImages.ts`（A6 / D1 / D3 / D4 都碰）、`src/content/**` 的 md 文件（B2c / D5 都写）。
- **中间态可发布**：A–D 做完时站点已是池化结构，只是后台还不好用。这个状态允许先 `npm run build` 验证通过，不必等 E。

---

## 3. 全局硬约束（子 Agent与主 Agent 都不得违反）

1. **技术栈不变**：Astro 最新稳定版 + Content Collections + sharp + exifr + Cloudflare Pages + Node LTS。**纯静态输出，禁止引入 React/Vue/Svelte 前端框架**（后台自建 JS 也不行框架，Vditor 是唯一允许的第三方库，且必须 CDN 引入）。
2. **内容与代码分离**：新增系列/随笔只是加文件，不碰代码。
3. **图片单一出口**：全站图片 URL 只经 `src/utils/imageUrl.ts` → `contentImages.ts` 生成，无手写相对路径；图片规格参数集中在 `astro.config.mjs` 一处。
4. **照片池化**：照片唯一位置 `src/content/pool/photos/`；唯一元数据 `src/content/pool/photos.meta.json`；条目经 frontmatter `photos: [ID]` 引用。`raw/` 原图**永不移动、永不删除**（有源码扫描单测守住）。
5. **样式集中**：设计变量只存在于 `src/styles/`；色系锁死纸白/墨/朱砂/夜底四色，照片承担全部色彩。
6. **草稿隔离**：`draft: true` 不得出现在任何公开页面查询结果里。
7. **性能预算**：展示图 ≤2MB、缩略图 ≤160KB；全部 `<img>` 显式宽高 + `loading="lazy"`（首屏 LCP 例外）；>30 张用 IntersectionObserver 分批；动效统一 `cubic-bezier(.16,1,.3,1)`，`prefers-reduced-motion` 全直出。
8. **不做清单**：评论、多语言、付费、原图下载、防盗水印、标签页、站内搜索、RSS、编号分页。**不得多做**。
9. **既有契约保留**：灯箱数据契约（frames JSON 岛）、EXIF 卡、「不伪造宽高 / 不占空帧 / 重复引用复用帧号」三条 postIllustrations 契约、check-image-sources 的「构建期硬红线」定位——改造只换数据来源，不废机制。
10. **git 安全**：`raw/`、`thumbs/`、`node_modules/`、`dist/` 必须被 `.gitignore` 排除；任何提交前 `git status` 确认无原图；不 `--no-verify`、不 force push。**真实 `git push` / 部署属外部动作，见 §6。**

---

## 4. 测试强制要求（Vitest + Playwright 双层）

「代码必须有完整测试」= 下列每一层都要有可跑绿的用例；主 Agent 核验以**命令实际退出码**为准，不接受子 Agent 口头声称已测。

### 4.1 工具链（已装好，直接用）

- **Vitest**：`npm run test:run`（单次）/ `npm test`（watch）/ `npm run coverage`；
- **Playwright**：`npm run test:e2e`；
- **构建**：`npm run build`（prebuild 会自动跑 `npm run check-images`）；
- **图片审计**：`npm run audit:size`。

**一个模块「通过」的必要条件**：`npm run build && npm run test:run` 全绿；涉及交互的模块加 `npm run test:e2e` 绿。

### 4.2 按模块的最低测试点（子 Agent 必须落地，可增不可减）

| 模块 | 必测项 |
|:--|:--|
| **A 内容模型** | schema 单测：合法 frontmatter 通过；缺字段 / 错类型 / 写错字段名报错；`photos` 为空数组合法；`cover` 空串合法（A5 三级回退）；`photos` 里的 ID 不在池中要能被 C4 拦下（与 C 组合验证） |
| **B import 迁移** | **核心，重测**。用临时目录 fixture 跑真实 sharp/exifr：`--pool` 落位路径、`--migrate` 四步各自可验（文件搬运计数 / sidecar 合并去重 / frontmatter 回填内容 / 坏 cover 置空）、幂等（重复运行跳过）、原图原地不动、导入清单输出格式 |
| **C 构建检查** | `auditImageSources` 纯函数单测全量重写：R1（图片只在 pool/photos/）、R2/R3/R4（sidecar 与磁盘成对）、R5（public 无图）、**R6（photos 列表 ID 必须在池中）**、**K5 回归（pool/photos.meta.json 不被误报）** |
| **D 前台渲染** | 页面 HTML 集成测试：照片流顺序 = frontmatter `photos` 顺序；封面三级回退（cover→photos[0]→不渲染）；`wip-empty` 不渲染封面块；首页 featured 新结构；**postIllustrations 20 个单测按新语法重写**（保留三条契约）；`photoCount` 改造后的单测 |
| **E 自建后台** | 纯函数单测：YAML frontmatter 拼装 / 解析往返、照片 ID 列表的序列化与反序列化、GitHub API 响应解析（contents / git blobs 的 base64 编解码）、Canvas 压缩参数计算。**浏览器交互部分用 Playwright e2e**：登录态、池页网格渲染、勾选与拖拽排序产生正确的 `photos` 数组、保存后 md 内容正确 |
| **F 退役 Sveltia** | 删除确认：`public/admin/config.yml` 不存在；`decap-cms.test.ts` 已删或改写；构建产物 `dist/admin/` 不含 sveltia 脚本 |
| **G 清理死代码** | `photoCount.ts` 无兜底分支；`grep -r "photosUnder\|sidecarByDir" src/` 无残留；5 个旧 photos/ 目录已删 |

### 4.3 覆盖率与质量

- 纯逻辑（import 脚本、`imageUrl`、collection 过滤、schema、postIllustrations、后台的 YAML/API 编解码）要求行覆盖接近全；
- UI 以 E2E / 集成行为断言为主，关键路径必须覆盖；
- 测试**不得 mock 被测的真实文件读写到失真**：import 脚本用临时目录 fixture 跑真实 sharp/exifr，断言真实产物。

---

## 5. 门禁执行流程（按门控推进，门禁之间严格串行）

主 Agent 按 5 道门禁推进；**每道门禁全部实现 + 测试 + 核验通过后，暂停并向用户汇报、请其确认，再进下一道**。

- **门禁 1（A 内容模型）**：pool 目录与全局 sidecar 就位；schema 扩展完成且单测绿；`contentImages.ts` 认池路径。产出：`npm run build` 仍绿（此时条目还没迁，靠兼容层）。
- **门禁 2（B 迁移 + C 校验）**：`--migrate` 跑通，84 张照片进池、7 个条目 frontmatter 回填、2 个坏 cover 落地；`npm run check-images` 新规则全绿；旧目录已空。产出：站点已完成池化，可发布。
- **门禁 3（D 前台渲染）**：照片流按 `photos` 顺序；封面三级回退；插图新语法；site.json featured 改结构；postIllustrations 20 单测重写绿。产出：`npm run build && npm run test:run && npm run test:e2e` 全绿，前台观感与迁移前一致。
- **门禁 4（E 后台 + F 退役）**：自建后台三板块可用（缩略图网格勾选 + 拖拽排序 + Vditor + 双上传）；Sveltia 已删。产出：本地跑通「浏览池 → 建系列 → 勾选排序 → 写正文 → 保存」全流程。
- **门禁 5（G 清理 + 总验收）**：死代码清完；admin-v2.md 验收标准逐条打勾；全测试套件绿；输出结题报告。

（门禁内模块按 §2.3 并行或串行；门禁之间不重叠。）

---

## 6. 外部账号 / 线上动作处理

涉及真实 GitHub 写操作（push、线上验证后台）的环节：

1. 先把**所有可本地化**的做完；
2. 生成**编号步骤待办清单**（面向「会装软件、会点网页、不写代码」的用户：逐步入口、每步预期）；
3. **暂停**，等用户完成并回填关键产物；
4. 回填后继续该门禁剩余的线上验证项。

**授权边界**：真实 `git push`、部署触发属对共享系统可见的动作——**执行前必须明确向用户确认**，一次授权不覆盖后续。PAT / token 绝不入库；提交前 `git status` 复核。

---

## 7. 进度追踪协议

主 Agent 维护三处一致：

1. 会话内任务台账（与 admin-v2.md 任务项 1:1，反映依赖与状态）；
2. `doc/tasksv0.0.1/progress.md`（新增 **v0.1.1 区块**：7 组任务 + 5 道门禁 + 偏差记录，**不改动旧 v0.0.1 区块**）；
3. `doc/tasksv0.0.1/admin-v2.md` 的 `[ ]/[x]` 勾选。

- 勾选规则：子 Agent 完成单个子任务并自测通过 → 勾该子任务；该组「验收标准」全满足且主 Agent 核验通过 → 在 progress.md 勾该组。
- 任一设计偏离须**先**在 progress.md 记录偏差原因，再动手。
- 每道门禁收尾输出简短快照：完成项、测试命令与结果、下一门禁计划、待用户处理的外部动作。

---

## 8. 交互协议

- **不明确必问**：admin-v2.md 内部矛盾、字段口径不清、依赖版本行为未知、需在「两个都合理」的方案间取舍时——**停下来向用户提问**，不得自行臆断。
- 提问要具体、可回答（给编号选项 + 推荐项）。
- 门禁之间必停（§5）；门禁内部子 Agent 完成后由主 Agent 自行核验放行，不逐模块打扰用户。
- **已定（2026-10-24，无需再问）**：
  1. **D2a 插图语法** = `![说明](photo:照片ID)`（显式协议，alt 有明确位置，与现有 markdown 图片语法同构，postIllustrations 改造最小）。
  2. **E6 直传画质** = Canvas 重编码（EXIF 全空）+ 池里打「EXIF 待补」角标；在意拍摄参数的图走本地 `npm run import --pool`。
- 遇到工具/网络受限，按降级方案处理并在报告中标注，**不谎报成功**。

---

## 9. 起始动作（现在就开始）

1. 读 `doc/tasksv0.0.1/admin-v2.md` 全文 + `doc/tasksv0.0.1/progress.md`，建立 7 组任务台账（按 admin-v2.md 的任务 ID 设依赖）。
2. 进门禁 1：派生 A 组子 Agent（A1/A2 与 A3/A4 可并行），核验 `npm run build` + 单测。**注意 §8 两条已定，直接按既定方案实现，不要再就这两点向用户提问。**
3. 门禁 1 全绿后向用户汇报 + 请确认，再进门禁 2。
4. 全程遵守 §3 硬约束、§4 测试强制、§5 门禁、§6 外部动作、§8 交互协议。
