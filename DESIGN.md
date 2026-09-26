# DESIGN.md —— 「柚 · Justyou」视觉系统规范

> 版本 v0.0.1（visual-system 模块产物，2026-09-24）
> 事实源：`.impeccable/design.json`（机器可读扩展）+ `doc/designv0.0.1.md` §10（已拍板的视觉事实）
> + `doc/preview/home.html`（首页视觉样张）+ `PRODUCT.md`（品牌与语言事实）。
> 本文件是后续**所有页面与组件的唯一视觉规范**：新页面只做组装，不改样式源。
> 代码侧唯一数值出处：`src/styles/global.css`（token）与 `src/styles/fonts.css`（字体接入）。
> 数值一致性由 `tests/unit/design-tokens.test.ts` 钉住（本文与 global.css 对不上即测试红）。

---

## 0. 一分钟对齐（给接手的人）

| 问题 | 答案 |
|---|---|
| 这个站是什么 | 一册摊开的自印摄影书（North Star: **The Self-Printed Book**）。访客翻「跨页」，不是扫缩略图网格。 |
| UI 允许几种颜色 | 纸白 / 墨 / 朱砂 / 夜底四色，**照片承担全部色彩**，UI 不加新色相。 |
| 允许几种字体 | 三种声音：宋体=书、黑体=文、等宽=数据。越界即破功。 |
| 允许几种圆角 | 零圆角；只有印章（方印 / 闲章）例外，闲章是圆。 |
| 允许几种缓动曲线 | **一条**：`cubic-bezier(.16,1,.3,1)`。 |
| 页面从哪开始 | `src/layouts/Base.astro`（书脊 + 导航 + 容器 + 页脚 + 入场编排已备好）。 |
| 数值从哪来 | `src/styles/global.css` 的 `var(--…)`；组件与页面里不写字面色值/字面字号。 |
| 图片 URL 从哪来 | `src/utils/imageUrl.ts` / `src/utils/contentImages.ts`；宽高从 `photos.meta.json` sidecar 取。 |

---

## 1. 世界与规则

**keyCharacteristics**（照 design.json narrative）：

1. 纸白 + 墨黑 + 唯一朱砂强调色；照片承担全部色彩。
2. 竖排中文是结构件：书脊导航、栏目名、大标题。
3. 系列编号即册页码（`No.01…`），帧号即页码片。
4. 微标签走打字机等宽体。
5. 零圆角（印章除外）、零渐变文字、禁用玻璃拟态。

**五条硬规则**（违反其中任何一条，按返工处理）：

| 规则 | 内容 |
|---|---|
| The One Seal Rule | 朱砂只用于「盖章级」语义（编号、印章、记号、当前项），**面积 ≤5%**，不做大面积底色。 |
| The Photos Own Color Rule | UI 永不与照片抢色；照片里的红是照片的红，UI 的朱砂只在纸面上。 |
| The Three Voices Rule | 竖排大宋体=书，黑体=文，等宽=数据。散文不许用等宽，参数表不许用宋体。 |
| The Positive Tracking Rule | 中文只用正值宽字距（`.05em`–`.5em`），永不用负字距压中文。 |
| The Paper-Stack Rule | 深度＝「图版压在纸上」，不是飘在云上；禁止零偏移彩色光晕。 |

**Do**：新页面沿用章节题行三段式（册号等宽朱砂 + 题名宋体 900 + 元数据等宽墨浅）；图版必配页码片或拍摄单；文字行长 ≤66ch、行高 1.9；保持「安静页 → 重图版」的翻页节奏，章间留白 `--gap-page`；动效整页一次编排。

**Don't**：等权缩略图网格开场；给标题加 kicker/eyebrow 小帽；圆角（印章除外）/渐变文字/玻璃拟态/硬偏移阴影；**未经 `※示例` 标注就展示虚构 EXIF 或站点数据**。

---

## 2. 色彩 token

### 2.1 四色（锁死，§10）

| token | 值 | 角色 | 用途 |
|---|---|---|---|
| `--paper` | `#F2F1EC` | neutral | 纸白地：页面背景、图版之间的「纸」 |
| `--ink` | `#26241F` | neutral | 墨：正文、栏线强调边、页脚顶线 |
| `--cinnabar` | `#A03B28` | **primary** | 朱砂：全站唯一强调色，≤5% 面积，仅盖章级语义 |
| `--night` | `#191816` | neutral | 夜底：灯箱专用（照片之外唯一深底） |

> `#A03B28` 在 `src/` 全树**只出现一次**——`global.css` 的 `--cinnabar` 定义处。
> 组件与页面一律 `var(--cinnabar)`。由 `tests/unit/design-no-hardcode.test.ts` 拦。

### 2.2 同族派生（只从 design.json tonalRamp 取，不引入新色相）

| token | 值 | 来自 | 用途 |
|---|---|---|---|
| `--paper-deep` | `#E8E6DD` | paper ramp 6 | 悬停底、滚动条槽 |
| `--paper-dim` | `#B9B7AE` | paper ramp 4 | 夜底上的次级文字（灯箱 sheet 右栏） |
| `--rule` | `#D5D2C8` | paper ramp 5 | 发丝栏线、拍摄单描边 |
| `--ink-soft` | `#5B574E` | ink ramp 5 | 次级文字、微标签、导航未选中 |
| `--ink-mute` | `#85806F` | ink ramp 6 | 更弱的批注、分隔点 |
| `--cinnabar-deep` | `#7E2E1F` | cinnabar ramp 3 | 印章/记号的按压态 |

### 2.3 透明叠加与阴影（避免组件写裸 `rgba()`）

| token | 值 | 用途 |
|---|---|---|
| `--scrim-night` | `rgba(25,24,22,.84)` | 页码片底（夜底 84%） |
| `--scrim-paper` | `rgba(242,241,236,.92)` | 闲章底（纸白 92%） |
| `--hairline-on-night` | `rgba(242,241,236,.25)` | 灯箱内的细线与按钮框 |
| `--gutter-ink` | `rgba(38,36,31,.07)` | 书槽渐变起点 |
| `--shadow-plate` | `0 10px 28px -18px rgba(38,36,31,.45)` | **落纸影：只有图版用**（plate-rest） |
| `--shadow-plate-float` | `0 24px 60px -30px rgba(0,0,0,.9)` | 灯箱观赏页浮起（plate-float，lightbox 模块用） |
| `--shadow-seal` | `0 1px 3px rgba(38,36,31,.25)` | 方印压纸 |
| `--gutter-spine` | `linear-gradient(90deg, --gutter-ink, transparent 14px)` | 书脊与页面之间的书槽（spine-gutter） |

### 2.4 用法边界

- 选区（`::selection`）、焦点环、当前导航项、册号 `No.xx`、`※` 记号 = 朱砂。
- 灯箱内所有线框按钮：`border: 1px solid var(--hairline-on-night)`，hover 转朱砂。
- 任何新界面元素想要「第三种颜色」＝停手，改用照片本身或朱砂记号。

---

## 3. 字体与三声部

### 3.1 字族 token

| token | 声部 | 栈 |
|---|---|---|
| `--font-serif` | 书（书名 / 章题 / 条目题 / 印章） | `'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif` |
| `--font-sans` | 文（正文 / 手记 / 简介） | `'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif` |
| `--font-mono` | 数（页码 / EXIF / 微标签 / 日期 / 册号） | `'Courier Prime','Courier New',ui-monospace,Consolas,monospace` |

### 3.2 字号阶梯（全部为 token，页面只挂工具类）

| token | 值 | 工具类 | 用途 |
|---|---|---|---|
| `--text-display` | `clamp(56px,7vw,84px)` | `.t-display` | 开场竖排书名（全站仅一处） |
| `--text-display-narrow` | `clamp(40px,13vw,52px)` | `.t-display`（≤900px 自动） | 窄屏转横排 |
| `--text-spine-brand` | `21px` | `.t-spine-brand` | 书脊品牌「柚影集」 |
| `--text-headline` | `clamp(26px,3.2vw,36px)` | `.t-headline` | 章节题（系列名/目次/随笔/版权页） |
| `--text-subtitle` | `22px` | `.t-subtitle` | 版权页小节题 h3 |
| `--text-title` | `19px` | `.t-title` | 条目题（目次行题名） |
| `--text-body` | **`16.5px`**（§10 定值） | `.t-body` | 正文、手记、简介 |
| `--text-body-lead` | `17px` | `.t-body-lead` | 随笔散文正文 |
| `--text-margin` | `15.5px` | `.note-margin p` | 页边手记 |
| `--text-nav` | `14.5px` | `.spine-nav a` | 书脊导航（窄屏 `--text-nav-narrow: 13.5px`） |
| `--text-label-xl` | `15px` | `.seal` | 方印「柚」 |
| `--text-label-lg` | `14px` | `.shotcard .t` | 拍摄单题名 |
| `--text-label` | `11.5px` | `.t-label` / `.mono` | 微标签基线 |
| `--text-label-md` | `12px` | `.chapter-no` / `.t-no` | 册号 `No.01`、版权页 dl |
| `--text-label-sm` | `11px` | `.frame-chip` / `.shotcard .m` / `.stamp` | 页码片、EXIF 行、闲章内字 |

行高与字距：`--leading-body` **`1.9`**、`--leading-tight` `1.18`、`--leading-label` `1.8`、`--leading-stamp` `1.3`；
`--tracking-tight .05em` / `--tracking-head .06em` / `--tracking-label .09em` / `--tracking-wide .12em` /
`--tracking-mono .14em` / `--tracking-brand .35em` / `--tracking-nav .5em`（中文一律正值）。
字重：`--weight-book 900`（书名/章题）、`--weight-entry 600`（条目题/拍摄单题名）、`--weight-em 500`（正文强调）。

行长：`--measure 66ch`（散文）、`--measure-note 62ch`、`--measure-intro 34ch`、`--measure-colophon 44ch`。

### 3.3 竖排工具类（结构件）

| 类 | 作用 | 用在 |
|---|---|---|
| `.v-writing` | `writing-mode: vertical-rl` + `text-orientation: upright` | 书脊导航、书脊品牌、章题、开场书名 |
| `.v-latin` | `writing-mode: vertical-rl`（不翻转字身） | 开场书名的拉丁竖列 |
| `.bookname` | CJK 大字 + 拉丁竖列的锁排容器（flex，间距 `--gap-bookname`） | 开场跨页 `<h1 class="bookname">` |

窄屏（≤900px）`.v-writing` / `.v-latin` 自动转 `horizontal-tb`，与「Display 转横排」同批发生。

### 3.4 字体接入现状（**含降级，如实记录**）

| 声部 | 现状 | 传输代价 | 与 §10 的差距 |
|---|---|---|---|
| 等宽 Courier Prime | **已按 §10 落地**：自建 `@fontsource/courier-prime` 的 latin 子集（`latin-400` / `latin-700` / `latin-400-italic`），`src/styles/fonts.css` 的 `@import` 是唯一入口 | 3 个 woff2，共 59KB；按 `unicode-range` 命中，单页通常只拉 400 那一档 ≈ **19KB** | 无 |
| 中文黑体（正文） | **降级为系统字体栈**（`--font-sans` 里 Noto Sans SC / Source Han Sans SC / PingFang SC / Microsoft YaHei 逐级回退） | **0 KB** | 字形随设备：Android=思源黑体、iOS/macOS=苹方、Windows=微软雅黑。正文是「无衬线」，跨端观感差异小 |
| 中文宋体（书名 / 章题） | **同上降级**（`--font-serif`：Noto Serif SC → Source Han Serif SC → Songti SC → STSong → SimSun） | **0 KB** | 有实质差异：iOS/macOS 得到真宋体（Songti SC），Windows 落到 SimSun 合成粗体，Android 可能整体落到黑体——**签名级的「竖排大宋体 900」在非苹果设备上不够硬** |

**为什么不顺手引入中文 webfont（实测依据，供用户裁定）**：
当前 `package.json` 里只有 **一个** 字体依赖：`@fontsource/courier-prime`（347KB 包含全部子集，我们只 `@import` latin 三档）。
`@fontsource/noto-serif-sc`（包 87MB）与 `@fontsource/noto-sans-sc`（包 76MB）在评估时下载安装并逐文件量过后**已卸载**，
所以下面的数字是实测值而不是估计。
Google Fonts CDN 在本机与部署侧不可达（`connect ETIMEDOUT`），必须自建；自建的两个候选都撞 §6 预算：

- `@fontsource/noto-serif-sc` 分片版（`900.css`，101 个 `@font-face`，每片约 45KB）：中文按码位分片，一页常用字会命中十几到几十片 → 约 **350–700KB/页**；且构建产物要落 1000+ 字体文件。
- 同包单文件版（`chinese-simplified-900.css`，1 片 **1.44MB woff2**）：一次全量下载，单这一片就抵得上整页多数资源，直接顶穿 §6「移动端 Lighthouse ≥90、单页传输尽量小」。

**升级路径（若用户要求「签名级宋体」，只改两处，不动组件）**：

1. `npm_config_proxy=false npm_config_https_proxy=false npm i @fontsource/noto-serif-sc`
2. 在 `src/styles/fonts.css` 追加 `@import '@fontsource/noto-serif-sc/900.css';`（或 900 + 600）；
   `--font-serif` 首项已经是 `'Noto Serif SC'`，组件与 token 一行都不用改。
3. 建议同时只给 `.t-display` / `.t-headline` 两类启用（章题字符集小），并把 `font-display: swap` 换成
   `optional` + 度量匹配（Astro 7 的 `astro:fonts` 本地 provider 可做 metric-override 回退），以免首屏文字跳动。

**新增字重的唯一正确姿势**：只在本文件加 `@import` / `@font-face`；字族名不改；组件永远写 `var(--font-*)`。

---

## 4. 版式骨架与断点

| token | 值 | 含义 |
|---|---|---|
| `--spine-w` | **`76px`** | 左缘固定书脊宽（窄屏置 `--spine-w-narrow: 0px`） |
| `--spine-h-narrow` | `56px` | 窄屏书脊转吸顶横条后的高 |
| `--container-w` | **`1280px`** | `.wrap` 容器最大宽 |
| `--gutter-x` | `clamp(20px,4vw,56px)` | 容器左右内衬 |
| `--open-min` | `100vh` | 开场跨页最小高 |
| `--open-cols` | `minmax(280px,1fr) 2fr` | **开场 1/3 文字 · 2/3 图版** |
| `--duo-cols` / `--duo-cols-rev` | `5fr 7fr` / `7fr 5fr` | 系列跨页的左右对置栏（手记 ↔ 图版） |
| `--essay-cols` | `minmax(0,7fr) minmax(180px,3fr)` | 随笔正文 · 页边批注 |
| `--colophon-cols` | `1fr 1fr` | 版权页两栏 |
| `--rule-w` | `1px` | 发丝栏线（全站唯一线宽） |

**骨架结构（`Base.astro` 已实现，页面不要自己重写）**：

```
<header class="spine">            左缘 76px 固定（窄屏转吸顶横条）
  <div class="spine-brand">        SiteMark variant="spine"（竖排「柚影集」）+ .spine-rule
  <nav class="spine-nav">          书脊导航四项（当前项 aria-current → 朱砂 + 下划线）
  <SiteMark variant="seal">         朱砂方印「柚」
</header>
<div class="page">                 margin-left: var(--spine-w)
  <main id="main"> <slot/> </main>  页面内容
  <div class="wrap"><footer class="site-footer">…</footer></div>   版权页脚（可关）
</div>
```

**页面侧只允许这三层**：`.wrap`（每章一个）→ `section`（自动获得 `--gap-page` 翻页留白）→ 章内网格。

**断点（全站唯一）**：`900px`（design.json `page-narrow`）。CSS 不能在媒体查询里用 `var()`，
所以 `900px` 只作为字面量出现在 `global.css` 底部那一个 `@media` 里（演示页自己的 `.trio` 另有一处同类媒体查询）。
窄屏发生的四件事：书脊转吸顶横条、多栏归一、竖排转横排、Display 换 `--text-display-narrow`。

---

## 5. 节奏与留白

| token | 值 | 用途 |
|---|---|---|
| `--gap-page` | **`clamp(72px,12vh,128px)`** | 章与章之间（`section { padding-top }` 统一给，页面不要再加） |
| `--gap-open-top` | `clamp(48px,9vh,96px)` | 开场顶衬 |
| `--gap-spread` | `clamp(32px,5vw,72px)` | 开场跨页栏间 |
| `--gap-duo` | `clamp(20px,3vw,40px)` | 对置栏间 |
| `--gap-essay` | `clamp(28px,5vw,72px)` | 随笔栏间 |
| `--gap-colophon` | `clamp(32px,6vw,88px)` | 版权页栏间 |
| `--gap-stack-xs/sm/md/lg` | `6 / 14 / 26 / 36px` | 纵向堆叠四级 |
| `--gap-inline` `--gap-baseline` | `18px` / `28px` | 章节题行三段间距 / 章题到图版 |
| `--footer-pad-top` `--footer-pad-bottom` | `22px` / `34px` | 页脚 |

**翻页节奏**：安静页（纯文字或单图）与重图版页交替；一章 = 一个 `.wrap > section`；连续两张满版图之间必须有文字页。

---

## 6. 动效

| token | 值 | 用途 |
|---|---|---|
| `--ease` | **`cubic-bezier(.16,1,.3,1)`** | 全站唯一曲线（写为 `cubic-bezier(0.16, 1, 0.3, 1)`，同一函数） |
| `--dur-rise` | `.9s` | 入场 rise（opacity + translateY `--rise-y 26px` + clip-path `--rise-clip 12%`） |
| `--stagger-step` / `--stagger-max` | `90ms` / `270ms` | 同组兄弟错峰，整页只编排一次 |
| `--dur-morph` | `.42s` | `::view-transition-(old\|new)(plate)` 图版 ↔ 灯箱形变 |
| `--dur-sheet` / `--sheet-y` | `.55s` / `18px` | 拍摄单从页边滑入（lightbox 模块使用） |
| `--dur-hover` / `--plate-zoom` | `.8s` / `scale(1.012)` | 满版图版呼吸级 hover（PhotoPlate 已实现） |
| `--dur-fast` / `--dur-fade` | `.2s` / `.35s` | 颜色微反馈 / 灯箱开合 |

编排落在 `Base.astro` 末尾那段脚本：`.rise` → 进视口加 `.is-in`，延迟 `min(序号 × --stagger-step, --stagger-max)`（两个数值从 CSS 变量读，不写在 JS 里）。

**降级（必守）**：
- `prefers-reduced-motion: reduce` → 无入场位移、无 hover 缩放、无 View Transition；`scroll-behavior` 转 `auto`；全站 transition/animation 时长压到 0.01ms。内容**直出**。
- 浏览器禁用 JS（`html` 上没有 `.js`）→ `.rise` 隐藏态整体不生效，等价于直出。
- `--ease` 之外不许出现第二条曲线；`global.css` 之外不许出现 `cubic-bezier(`（测试会扫全树，只允许「同一曲线」的写法）。

---

## 7. 组件规范与 props 契约

组件都在 `src/components/`，Astro 原生 `.astro`，**零框架依赖**；样式全为 token（`tests/unit/design-no-hardcode.test.ts` 扫组件与布局）。

### 7.1 `PhotoPlate.astro` 图版

`<figure class="plate">` + `<img>` + 可选 `PageChip` + `<slot/>`（放 `ExifCard` / `.stamp` 闲章）。
落纸影 `--shadow-plate`、`cursor: zoom-in`、hover `--plate-zoom`、`overflow: hidden`。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `src` | `string` | 必填 | **已过 `imageUrl()` / `contentImageUrl()` 的 URL**，不接未解析的内容相对路径 |
| `width` `height` | `number` | 必填 | sidecar 真实像素（`PhotoEntry.width/height` 或 `thumbWidth/thumbHeight`）→ 显式宽高防布局抖动 |
| `alt` | `string` | 必填 | 图像描述（无描述也要显式给空串） |
| `loading` | `'lazy' \| 'eager'` | `'lazy'` | §6 全懒加载；只有首屏 LCP 那张显式传 `eager` |
| `fetchpriority` | `'high' \| 'low' \| 'auto'` | — | 开场图传 `'high'` |
| `current` `total` | `number \| string` | — | 数字自动补零成 `01 / 03` 压页码片 |
| `frame` | `string` | — | 已格式化好的帧号整串（优先于 `current/total`） |
| `fit` | `'spread' \| 'cover'` | `'spread'` | spread＝满宽自然比例；cover＝填满外框裁切（配 `aspect`） |
| `aspect` | `string` | — | 如 `'4/3'`，cover 模式用 |
| `zoom` | `boolean` | `true` | 关掉则无 zoom-in 光标与 hover 呼吸 |
| `shadow` | `boolean` | `true` | 关掉＝平贴纸面（缩略图行可用） |
| `dataFrame` | `number \| string` | — | 输出 `data-frame`，lightbox 模块据此取帧（视觉稿同口径） |
| `class` `id` | `string` | — | 追加到根 `<figure>`（如 `class="rise"`） |

### 7.2 `PageChip.astro` 页码片

等宽纸白字压 84% 墨底，绝对定位在图版左下（`--chip-inset-left/-bottom`），零圆角。

| prop | 类型 | 说明 |
|---|---|---|
| `current` | `number \| string` | 当前帧号；数字补零两位 |
| `total` | `number \| string` | 总帧数 → 渲染 `01 / 03` |
| `label` | `string` | 整串原样显示（给了就不拼），如 `No.02 · 草稿` |
| `class` | `string` | 追加类名 |

三者皆空 → 整块不渲染（不留空底）。灯箱切帧的 `aria-live` 由 lightbox 模块负责。

### 7.3 `ExifCard.astro` 拍摄单（EXIF 说明签）

根元素固定 `<figcaption class="shotcard">`（拍摄单是图版的说明签，必须活在 `<figure>` 里）：
宋体题名 + 等宽参数行，纸白底、上/左发丝线，压在图版右下角，`max-width: --shotcard-max-w`。

| prop | 类型 | 说明 |
|---|---|---|
| `title` | `string?` | 图版题名（宋体 600，如「逢简 · 伞与幡」） |
| `exif` | `Exif \| null` | **直接吃 sidecar 的 `exif` 对象**（`src/types/photoSidecar.ts`） |
| `demo` | `boolean` | 整张参数都是示例 → 行尾追加朱砂 `※示例`；同时输出 `data-demo="true"` |
| `demoFields` | `Array<keyof Exif>` | 个别字段是占位 → 只在该值后缀朱砂 `※`，如 `demoFields={['shutter','iso']}` |
| `class` | `string` | 追加类名 |

字段口径（顺序＝§4 的 EXIF 阅读顺序，缺字段整项不输出，全缺且无题名整块不渲染）：

| 字段 | 渲染 | 例 |
|---|---|---|
| `camera` | 原样 | `Panasonic DMC-GX85` |
| `lens` | 原样输出，不改写 | `LUMIX G 14/F2.5` |
| `focalLength` | `+mm` | `14mm` |
| `aperture` | `f/` + 去尾零 | `f/5`、`f/2.8` |
| `shutter` | 数字秒 → `1/Ns`（<1s）或 `Ns`；串则补 `s` | `1/125s` |
| `iso` | `ISO` 前缀 | `ISO200` |
| `dateTaken` | `YYYY.MM.DD` | `2026.08.10` |

### 7.4 `SiteMark.astro` 站点标识（柚 / Justyou 并用）

字符串取自 `src/data/site.json`，组件内不硬编码品牌字。四个变体，都是「锁排」，标题语义由页面自己包：

| `variant` | 输出 | 用在 |
|---|---|---|
| `spine` | `<span class="t-spine-brand v-writing">柚影集</span>` | 书脊顶部 |
| `display` | 两个兄弟节点：`.t-display.v-writing`（CJK）+ `.t-label.v-latin`（拉丁竖列，带 `aria-label`） | 开场跨页，页面写成 `<h1 class="bookname"><SiteMark variant="display"/></h1>` |
| `inline` | `柚 · Justyou`（中文宋体 + 等宽拉丁） | 页脚 / 404 / 关于页 |
| `seal` | `<span class="seal" aria-hidden="true">柚</span>` 朱砂方印 | 书脊末端 |

额外 props：`cjk` / `latin` / `tagline` 可覆盖默认字串（默认：spine 用 `name.spine`，display 用 `bookName.cjk` + `bookName.latin`，其余用 `name.cjk` + `name.latin`），`class` 追加。

### 7.5 已在 `global.css` 备好的家具类（无需组件）

| 类 | 作用 | 备注 |
|---|---|---|
| `.seal` | 朱砂方印「柚」 | 由 `SiteMark variant="seal"` 使用 |
| `.stamp` | 图版右上角朱砂描边圆闲章（`--stamp-size` 44px / `--radius-circle`） | 内容自填，如 `<span class="stamp">精选<br/>帧</span>` |
| `.frame-chip` 的底 | 见 `PageChip` | — |
| `.mono` | 等宽微标签一行（`--text-label` + `--ink-soft`） | 收录信息、页脚、批注尾标 |
| `.chapter-head` + `.chapter-no` + `.chapter-sub` | 章节题行三段式（题名那段自己挂 `.t-headline`） | 系列页 / 目次 / 随笔 / 版权页通用 |
| `.toc`（`.no/.name/.dots/.meta`） | 目次点线行（系列列表用） | hover 转 `--paper-deep` |
| `.spread` / `.spread-quiet` / `.duo` / `.duo-rev` / `.note-margin` / `.essay` / `.marginalia` / `.colophon` / `.index-note` / `.bookname` | 跨页与边栏骨架 | 窄屏自动归一 |
| `.dropcap` | 随笔首字下沉（宋体 900 · 朱砂） | 配 `.t-body-lead` |
| `.hairline` / `.mark` / `.demo` | 发丝线 / 朱砂记号 / `※示例` 标注 | `.demo` 必须与真数据同时出现时才用 |

### 7.6 灯箱（lightbox 模块的实现要点，本模块只留约定）

夜底 `--night` 全屏、`--shadow-plate-float`、按钮框 `--hairline-on-night` hover 转朱砂、
`::view-transition-*(plate)` 用 `--dur-morph` + `--ease`、拍摄单 sheet 用 `--dur-sheet` / `--sheet-y`、
sheet 右栏文字用 `--paper-dim`；开启时背景 `inert`、换帧 `aria-live`；`prefers-reduced-motion` 下无 VT 无 sheet 位移。
新 token 若需要，**只能加进 `global.css` 的 1.13 区块**，不许写进组件。

灯箱已按此约定在 1.13 落 9 条尺寸令牌（均无新色相/曲线）：`--lb-z`(层级) `--lb-pad` `--lb-gap` `--lb-hit`(44 触摸下限) `--lb-btn-pad` `--lb-nav-inset` `--lb-sheet-w` `--lb-dim`(到头弱化透明度) `--lb-lock-pad`(补滚动条宽，与 `::-webkit-scrollbar` 同值)。

---

## 8. 工程约定与验收

### 8.1 样式集中（§3 边界）

1. 设计变量（色、字号、间距、曲线、组件度量）**只存在于 `src/styles/global.css`**；字体接入只在 `src/styles/fonts.css`。
2. `src/components/*.astro`、`src/layouts/Base.astro` 的 `<style>` 只允许 `var()` 与百分比/关键字：**不得**出现 `#hex`、`rgba()`、`cubic-bezier(`、`font-size: <数字>`、任何 `px` 字面量。
3. 组件确实需要新度量时：先在 `global.css` 1.13 区块加 token，再在组件里引用。
4. 自动化：`tests/unit/design-no-hardcode.test.ts`（含「`#A03B28` 全树只出现一次」与「`cubic-bezier` 只有一条曲线」）。

### 8.2 图片与数据

- 图片 URL 唯一出口：`src/utils/imageUrl.ts` 的 `imageUrl(path, {base})`；内容夹相对路径经
  `src/utils/contentImages.ts` 的 `contentImageUrl(entryResourceDir(collection, id), relPath)`。
  迁移 R2 时只改 `PUBLIC_IMAGE_BASE`，页面与组件不动。
- 尺寸唯一来源：`photos.meta.json` sidecar 的 `width/height`（展示版）与 `thumbWidth/thumbHeight`（缩略图）。
  **禁止**在页面里写死宽高或省掉宽高。
- 图片规格常量只在 `astro.config.mjs`（`DISPLAY_LONG_EDGE 2560` / `THUMB_LONG_EDGE 800` / `IMAGE_FORMAT webp`）。
- 站点级事实（品牌字、导航四项、页脚、版权页制作信息、社交/联系占位）只在 `src/data/site.json`。
  形状：

```jsonc
{
  "locale": "zh-CN",
  "name":  { "cjk": "柚", "latin": "Justyou", "latinUpper": "JUSTYOU", "spine": "柚影集", "display": "柚 · Justyou" },
  "bookName": { "cjk": "柚·街影", "latin": "JUSTYOU · FIELD PHOTOS" },
  "description": "…",
  "nav":  [ { "key": "home|series|posts|about", "href": "/…", "label": "开卷|系列|随笔|版权页" } ],
  "footer": { "note": "…", "copyright": "© 2026 柚" },
  "colophon": [ { "term": "相机", "value": "Panasonic Lumix GX85" }, … ],
  "social": [ { "key": "instagram", "label": "Instagram", "href": "#", "placeholder": true }, … ],
  "contact": { "email": "", "placeholder": true },
  "intro": { "sample": true, "text": "…" },
  "indexNote": { "sample": true, "lines": ["…"] },
  "featured": { "photos": [] },
  "$comments": { "…": "各字段口径注释" }
}
```

  约定：`placeholder: true` / `sample: true` 的字符串**渲染时必须带朱砂 `※示例`**；
  `featured.photos` 由 home-page 模块按需补加（建议元素形状 `{ collection, id, file, title }`）。

### 8.3 性能对齐（§6）

- 全站 `<img>` 显式 `width`/`height` + `loading="lazy"`（首屏 LCP 那一张例外：`eager` + `fetchpriority="high"`）。
- 中文不走网络字体（0KB）；等宽字体按 `unicode-range` 分档，单页通常 ~19KB。
- 视觉稿图片规格即展示版（2560px 长边 WebP）；缩略图通道同页可用（`thumb*` 宽高）。
- 长列表分批渲染（>30 张用 IntersectionObserver 追加）属系列页模块，但**分页节奏不得破坏 `--gap-page`**。

### 8.4 新增一个页面（检查清单）

1. `src/pages/xxx.astro` → `import Base from '../layouts/Base.astro'` → `<Base current="series" title="…">`。
2. 内容层：`getCollection('series' | 'posts')` + `entryResourceDir()` + `contentImageUrl()`；照片顺序按 sidecar 数组。
3. 版式：`.wrap > section`（一章）→ `.chapter-head` 三段 → `.spread` / `.duo` 图版网格 → 图版配 `PageChip` 或 `ExifCard`。
4. 文字：`.t-body` / `.t-body-lead`，行长 ≤66ch；示例数据一律 `※`。
5. 动效：入场元素挂 `class="rise"`，别自己写 transition。
6. 需要新数值＝先加 token，再引用；不许在组件里就地写字面值。

### 8.5 本模块验收状态

- [x] `DESIGN.md` 重建（本文件）。
- [x] `global.css` token（四色 + 派生阶 + 字号阶梯 + 动效 + 节奏 + 版式 + 组件度量）。
- [x] 版式骨架 + `Base.astro`（76px 书脊含四项导航 + 1280 容器 + 版权页脚 + rise 一次编排）。
- [x] 三件套组件（图版 / 页码片 / 拍摄单）+ 站点标识 + `.stamp` 闲章家具。
- [x] `src/data/site.json`。
- [x] 临时演示路由 `/visual-demo/`（token 表 + 三件套 + 书脊 + 1/3·2/3 跨页 + 容错样例）。
- [x] 单测：token 快照 / 组件零硬编码 / 朱砂面积 / site.json 形状 / DESIGN.md 与 global.css 一致。
- [x] E2E：`/visual-demo/` 桌面 1280 与移动 375 两档的骨架几何、显式宽高 + lazy、字体声部、缺字段容错、reduced-motion 直出。
- [ ] 视觉并排人工核验（对照 `doc/preview/home.html`）：自动化不能替眼看字体降级与阴影观感。
- [ ] 中文 webfont 是否补上（§3.4 的代价与升级路径已列，待用户拍板）。
