# Surface brief · 首页 `/`（视觉稿 doc/preview/home.html）

Mode: **Experience**（作品本身从第一屏领场，界面退后）。
Visitor: 站长本人与手机/桌面访客；job = 看图、进系列、翻手记。
约束: doc/designv0.0.1.md 第 5 节页面清单与第 6 节性能预算为硬约束；照片只用 raw/ 下 5 张真图；文案为示例（视觉稿阶段），站点正式文案后补。

## Direction contract

> 引擎脚本不可用（网络受限），无 seed key；方向由用户于结构化提问中锁定（pinned，绑定执行）。buildPath = code（记录于 .impeccable/config.json）。

- **THESIS**: 首页是一本摊开的自印摄影书——访客翻"跨页"（spread），而不是扫缩略图网格；拒绝品类默认的等权网格与白墙画廊开场。
- **OWN-WORLD**: 冷调纸白 `#F2F1EC` 地 + 墨炭黑 `#26241F` 正文 + 全站唯一强调色朱砂红 `#A03B28`（印章/点缀）；思源宋体（Noto Serif SC）做标题、思源黑体做正文、打字机等宽（Courier Prime）做页码/拍摄单等微标签；竖排中文栏目名、细发丝栏线、系列编号即页码（No.01…）、固定"书口"侧脊导航、页边批注（marginalia）。组件族：满版跨页图版、拍摄单说明签、目次（dot-leader 目录）、colophon 版权页。
- **STORY**: 访客秒懂——这是按"系列=章"组织的个人影像档案；相信——作品值得以书的形式对待；行动——点图进灯箱"放大观赏页"，拍摄单从页边滑入，左右/滑动切帧，Esc 合页。
- **FIRST VIEWPORT**: 桌面 1440：左缘固定竖排书脊（柚 · Justyou + 竖排导航 + 朱砂印章块）；开场跨页左 1/3 为安静文字页（大字竖排"柚"+一句自述+收录信息），右 2/3 为满版竖幅精选图版（P1230857），图版右下角压小号拍摄单，右上角朱砂圆印。无汉堡菜单、无 hero 按钮。
- **FORM**: 摄影 zine / 自印书（grounded 候选第 1 名，用户钦定）。
- **FINISH**: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Open items

- 灯箱 EXIF 实拍参数（光圈/快门/ISO）待导入脚本 sidecar 供数，视觉稿中以示例值占位并标注。
- 站点名最终写法（柚 / Justyou / 并用）在视觉稿中先行验证"并用"方案。

## Adaptations logged (post-build, 2026-09-23)

- 书脊品牌字用「柚影集」三字连排（契约原文"柚 · Justyou"），Justyou 由拉丁竖列与页脚承载——即"并用"方案的落地形态。
- 开场跨页比例已按契约改为 1/3·2/3（`minmax(280px,1fr) 2fr`）。
- No.02 跨页内联列比会压垮窄屏单列规则，已改 `.duo.rev` 类并在 ≤900px 归一；窄屏大标题加 `white-space:nowrap`。
- 终审 fix 批次已落：开场 View Transition 命名转移移入回调（消除空转与重开冲突）、拍摄单改为开启时从页边滑入（删除死 VT 规则）、页码片遮罩提至 .84、开场图版补 `cursor:zoom-in`、灯箱开启时 `inert` 圈闭背景、`.lb-sheet` 加 `aria-live`。
- 待补证据：桌面全页终版、1440 灯箱开启态、434 原生移动、434 灯箱开启态（内嵌浏览器面板隐藏所致）。→ **已闭环（同日）**：桌面 1454 原生视口三帧 + 灯箱开启态 + 390 两帧重拍完成；裁决轮 8 项全部 resolved。期间追加两处修复：`.frame-no` 遮罩规则从 `.spread-plate` 提为全局（`.tall` 图版页码片此前无底）；`plate` 命名不再常驻灯箱图（改在开/关回调内转移，消除新旧快照命名冲突窗口），功能复验开/关/重开零报错。
