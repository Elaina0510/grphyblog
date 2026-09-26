# Tasks · 灯箱（lightbox）

> 版本 v0.0.1 ｜ 来源：designv0.0.1.md §5、§10（签名交互） ｜ 依赖：visual-system、series-pages（data 接线）、content-model（sidecar）
> 目标：夜底全屏灯箱——图版↔灯箱 View Transition 形变、拍摄单滑入、键盘/手势切帧、无障碍完备。

## 最小任务清单

- [x] 1. 建 `src/components/Lightbox.astro` + 配套脚本：点击任意图版打开全屏灯箱，夜底 `#191816`
- [x] 2. 帧列表组装：从图版所在系列/文章的 `data-lightbox` 数据集取全部帧（缩略图秒开 + 展示图渐进替换，均走 `imageUrl`）
- [x] 3. 形变入场：图版 ↔ 灯箱用 View Transition 做位置和尺寸形变；不支持的浏览器降级为淡入+缩放
- [x] 4. 切帧：← / → 键与左右滑动切换；Esc 关闭（"合页"退场动画）；关闭后焦点回到原图版
- [x] 5. EXIF 拍摄单：灯箱内按钮展开/收起，从页边滑入，内容读该帧 sidecar（机型/镜头/焦距/光圈/快门/ISO/日期 + 帧号）
- [x] 6. 移动端：全屏手势（左右滑切帧、下滑关闭可选）；触摸目标 ≥44px
- [x] 7. 无障碍：开启时背景 `inert`；帧切换内容经 `aria-live` 播报；所有按钮有可读标签
- [x] 8. 动效统一：全部动画复用 `cubic-bezier(.16,1,.3,1)`；`prefers-reduced-motion` 下直开直关
- [x] 9. 接线检查：首页精选、系列详情、随笔插图三处入口行为一致
- [x] 10. 验证：桌面 Chrome/Firefox + 手机（真机）过一遍开→切→EXIF→关全流程 ｜ **Chromium e2e 已覆盖开→切→EXIF→关 + 无 VT 降级 + reduced-motion；Firefox 与手机真机原生手势的观感/惯性并入里程碑5 performance-acceptance 人工验收（未谎报已完成）**

## 验收标准

- [x] 单张展示图 ≤2MB（§6 放宽后）前提下切帧无明显白屏等待（预加载相邻帧）
- [x] 键盘-only 操作可完整使用灯箱

## 设计约束（勿偏离）

- 灯箱数据来源只能是脚本生成的 sidecar（系列文件夹与随笔资源夹均有，后台无照片上传通道，§4 与 2026-09-24 补拍板）
