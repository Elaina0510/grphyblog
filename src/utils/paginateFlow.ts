// =============================================================================
// paginateFlow —— 「照片流 >30 张分批渲染」的纯逻辑（series-pages §6 / designv0.0.1 §6）
//
// 为什么抽成纯函数：分批「判定 + 每批几帧」既是页面挂 IntersectionObserver 的依据，
// 也是验收要钉的死数字。把它从 Astro 页面里剥出来，才能像 photoCount 一样在 Node 单测里
// 直接跑（零 I/O、不 import Astro/Node），避免为了测一段算术去起一次 build。
//
// 口径（§6「单页照片 > 30 张时分批渲染（IntersectionObserver 追加）」）：
//   - total ≤ threshold（默认 30）→ 不分批：首屏即全部，batches = []。
//   - total > threshold            → 分批：首屏先出 initialSize（默认 = threshold）张，
//                                    其余按 chunkSize（默认 20）一批批由 IO 追加。
//
// 注意：这只是「批次计划」。灯箱帧序列（frames JSON 岛）始终含全部帧，不受分批影响 ——
//       分批只决定「照片流 DOM 何时出现」，不改变灯箱可切帧的完整性。
// =============================================================================

/** planPhotoFlow 的可选项；都给了默认值，调用方可整体省略。 */
export interface FlowOptions {
  /** 触发分批的阈值：total **严格大于** 它才分批（§6 的「>30」）。默认 30。 */
  threshold?: number;
  /** 分批时首屏渲染的帧数（其余进 IO 批次）。默认等于 threshold。 */
  initialSize?: number;
  /** 每个后续批次的帧数（IO 追加的节奏）。默认 20。 */
  chunkSize?: number;
}

/** 分批计划的完整快照：页面据此决定「是否挂 IO」「首屏几帧」「后续每批几帧」。 */
export interface FlowPlan {
  /** 归一化后的总帧数（>=0 的整数）。 */
  total: number;
  /** 生效阈值。 */
  threshold: number;
  /** 生效首屏数量（未分批时等于 total）。 */
  initialSize: number;
  /** 生效批次大小。 */
  chunkSize: number;
  /** 是否需要分批（total > threshold）。 */
  batched: boolean;
  /** 首屏渲染帧数（= min(需要立即呈现的数, total)）。 */
  firstScreen: number;
  /** 需由 IO 追加的剩余帧数（total - firstScreen）。 */
  remaining: number;
  /** 后续每批的帧数序列（各值 ≤ chunkSize，末批为余数；不分批时为 []）。 */
  batches: number[];
}

const DEFAULT_THRESHOLD = 30;
const DEFAULT_CHUNK_SIZE = 20;

/** 把任意输入夹成「>=0 的有限整数」，NaN/Infinity/负数一律归 0。 */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** 把 remaining 按 size 切批：每批 size，末批取余；size<=0 或 remaining<=0 → []。 */
export function chunkSizes(remaining: number, size: number): number[] {
  const total = toCount(remaining);
  const step = toCount(size);
  if (total <= 0 || step <= 0) return [];
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    const take = Math.min(step, left);
    out.push(take);
    left -= take;
  }
  return out;
}

/**
 * 照片流分批计划：给 N（与可选阈值/首屏/批大小），返回是否分批 + 首屏数 + 后续批次序列。
 * 纯函数——不读文件、不碰 DOM；页面拿到 plan 后自行挂 IntersectionObserver。
 */
export function planPhotoFlow(total: number, options: FlowOptions = {}): FlowPlan {
  const n = toCount(total);
  const threshold = toCount(options.threshold ?? DEFAULT_THRESHOLD) || DEFAULT_THRESHOLD;
  const chunkSize = toCount(options.chunkSize ?? DEFAULT_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE;
  const batched = n > threshold;

  // 未分批：首屏即全部；分批：首屏 = min(initialSize(默认=threshold), total)。
  const initialCap = toCount(options.initialSize ?? threshold) || threshold;
  const firstScreen = batched ? Math.min(initialCap, n) : n;
  const remaining = Math.max(n - firstScreen, 0);
  const batches = batched ? chunkSizes(remaining, chunkSize) : [];

  return {
    total: n,
    threshold,
    initialSize: firstScreen,
    chunkSize,
    batched,
    firstScreen,
    remaining,
    batches,
  };
}

export default planPhotoFlow;
