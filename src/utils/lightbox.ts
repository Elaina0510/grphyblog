// =============================================================================
// lightbox.ts —— 灯箱的「纯逻辑」层（lightbox 模块 任务 2/4/6/7）
//
// 为什么单独成一个 util：Lightbox.astro 的 <script> 只做 DOM 接线，
// 所有可判定的算法（读 frames 岛、索引夹取、相邻预加载选谁、滑动方向判定、
// 播报文案口径）都在这里，既能被 Node 端单测直接钉住（tests/unit/lightbox-utils.test.ts），
// 也保证三处入口（首页 / 系列详情 / 随笔插图）走的是同一套规则。
//
// 硬约束（勿偏离）：
//   - 零依赖、零框架：本文件不 import 任何运行时库，也不碰 DOM；
//   - 灯箱数据**只有一个来源** = 脚本生成的 sidecar → 页面构建期序列化的
//     `script.lightbox-frames[data-gallery]` JSON 岛（design §4「所有照片都出自脚本」）。
//     本模块绝不从别处（前端配置、手写字面量…）造帧数据。
// =============================================================================

import type { Exif } from '../types/photoSidecar';

/**
 * 一帧：与「灯箱数据契约 §2」逐字对齐。
 * src = 展示图 URL、thumb = 缩略图 URL、width/height = **展示图**真值（sidecar 口径）、
 * alt 必填、title 可选、exif 直接是 sidecar 的 exif 对象。
 */
export interface LightboxFrame {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  title?: string;
  exif: Exif;
}

/** frames 岛的解析结果：帧序列 + 被丢掉的坏帧序号（供控制台告警，不静默吞数据问题）。 */
export interface ParsedIsland {
  frames: LightboxFrame[];
  rejected: number[];
}

/** 空 exif 的兜底：sidecar 一条记录也应带 exif 对象，缺了也不至于让渲染报错。 */
const NO_EXIF: Exif = {};

/** 正有限数（宽高是真值：非正/非有限一律归 0，由调用方决定「不写显式宽高」，绝不伪造）。 */
function positive(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 解析 `script.lightbox-frames` 的文本内容为帧序列。
 *
 * 口径：
 *   - 非 JSON / 非 {frames:[...]} 形状 → 返回空表（调用方据此不开灯箱），不抛错；
 *   - 逐帧校验：`src` 必须是非空字符串（没有可加载 URL 就不是帧），
 *     缺 src 的条目**整帧丢弃**并记进 rejected（保持「帧 = 数据」而不伪造占位）；
 *   - 宽高缺失归 0（表示「未知」，调用方不给 <img> 写显式宽高），绝不用猜的数字填；
 *   - 顺序原样保留 = sidecar 顺序 = data-lightbox-index 顺序。
 */
export function parseFramesIsland(raw: string | null | undefined): ParsedIsland {
  const source = text(raw);
  if (!source) return { frames: [], rejected: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { frames: [], rejected: [] };
  }

  const list = (parsed as { frames?: unknown })?.frames;
  if (!Array.isArray(list)) return { frames: [], rejected: [] };

  const frames: LightboxFrame[] = [];
  const rejected: number[] = [];
  list.forEach((item, i) => {
    const src = text((item as { src?: unknown })?.src);
    if (!src) {
      rejected.push(i);
      return;
    }
    const frame: LightboxFrame = {
      src,
      thumb: text((item as { thumb?: unknown })?.thumb) || src,
      width: positive((item as { width?: unknown })?.width),
      height: positive((item as { height?: unknown })?.height),
      alt: text((item as { alt?: unknown })?.alt),
      exif: ((item as { exif?: Exif })?.exif ?? NO_EXIF) as Exif,
    };
    const title = text((item as { title?: unknown })?.title);
    if (title) frame.title = title;
    frames.push(frame);
  });

  return { frames, rejected };
}

/** 索引夹取：越界折回边界（灯箱到头就停，不循环翻页——「册子」的翻页隐喻）。 */
export function clampIndex(index: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  if (i < 0) return 0;
  if (i > total - 1) return total - 1;
  return i;
}

/**
 * 相邻帧索引（预加载用）：左右各 reach 帧，到头不循环，排除自己。
 * 例：total=5, i=0, reach=1 → [1]；i=2 → [1,3]；i=4 → [3]。
 */
export function neighborIndices(index: number, total: number, reach = 1): number[] {
  if (total <= 1) return [];
  const i = clampIndex(index, total);
  const span = Math.max(1, Math.trunc(reach));
  const out: number[] = [];
  for (let k = i - span; k <= i + span; k += 1) {
    if (k >= 0 && k < total && k !== i) out.push(k);
  }
  return out;
}

/** 数字补零两位（与 PageChip 同口径：1 → "01"）。 */
export function pad2(value: number): string {
  return Number.isFinite(value) ? String(value).padStart(2, '0') : String(value);
}

/** 页码片文案：`02 / 05`。 */
export function chipText(index: number, total: number): string {
  return `${pad2(index + 1)} / ${pad2(total)}`;
}

/**
 * aria-live 播报文案（§10 换帧播报口径）：`第 2 帧，共 5 帧 · 题名`。
 * 无题名时只报帧号，不编造描述。
 */
export function announceText(index: number, total: number, title?: string): string {
  const head = `第 ${index + 1} 帧，共 ${total} 帧`;
  const name = text(title);
  return name ? `${head} · ${name}` : head;
}

/**
 * 手势判定：把一次滑动的位移换算成动作。
 * 横向位移 ≥ 阈值且横向占优 → 切帧（左手边=下一帧，符合「往后翻」）；
 * 纵向占优且过阈值 → 下滑关闭；其余不动作。
 */
export function swipeDecision(
  dx: number,
  dy: number,
  threshold: number,
): 'prev' | 'next' | 'down' | 'none' {
  const limit = Math.abs(Number.isFinite(threshold) ? threshold : 0);
  const x = Number.isFinite(dx) ? dx : 0;
  const y = Number.isFinite(dy) ? dy : 0;
  if (Math.abs(x) >= Math.abs(y)) {
    if (Math.abs(x) < limit) return 'none';
    return x < 0 ? 'next' : 'prev';
  }
  if (Math.abs(y) < limit) return 'none';
  return y > 0 ? 'down' : 'none';
}

/** 帧数据的输入形状：允许 title 缺省（构建期各处口径不完全一致时不必强行补空串）。 */
export interface FrameInput {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  title?: string;
  exif: Exif;
}

/**
 * 生成 frames 岛的 JSON 文本（与 series / posts 侧同口径：'<' 转义防 </script> 提前闭合）。
 * 首页回填灯箱契约时用这里；series/posts 已有各自的产出路径，不去改它们。
 */
export function buildFramesIslandJson(frames: readonly FrameInput[]): string {
  const payload = {
    frames: frames.map((f) => {
      const frame: Record<string, unknown> = {
        src: f.src,
        thumb: f.thumb,
        width: f.width,
        height: f.height,
        alt: f.alt,
        exif: f.exif,
      };
      if (f.title) frame.title = f.title;
      return frame;
    }),
  };
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

/** 首页「开场图与精选首图是同一张」的去重：同一 URL 只占一帧，两处图版共享索引。 */
export function createFrameRegistry() {
  const frames: FrameInput[] = [];
  const bySrc = new Map<string, number>();
  return {
    indexOf(input: FrameInput): number {
      const existing = bySrc.get(input.src);
      if (existing !== undefined) return existing;
      const next = frames.length;
      bySrc.set(input.src, next);
      frames.push(input);
      return next;
    },
    get frames(): FrameInput[] {
      return frames;
    },
  };
}

export default parseFramesIsland;
