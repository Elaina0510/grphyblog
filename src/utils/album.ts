// =============================================================================
// album —— 「摄影集画册」分页的纯逻辑（系列详情页一屏两页）
//
// 系列详情页不再平铺照片 + 点开灯箱，而是像实体摄影集那样一屏摊开两张照片，
// 左右翻页。这里只管「几张一页、第几页、到头没到头」这类算术，零 DOM / 零 I/O，
// 所以能像 paginateFlow 一样在 Node 单测里直接钉死。
//
// 口径：
//   - 一屏（一个 spread）最多 TWO_UP 张；末屏可能只有 1 张，不补空位；
//   - 页数 = ceil(照片数 / 2)，0 张 → 0 页；
//   - 下标一律 0-based，展示时用 spreadLabel 补零成「01 / 38」。
// =============================================================================

/** 一屏摊开的照片数（摄影集对页）。 */
export const TWO_UP = 2;

/** 画册里的一张照片：渲染所需的全部数据，宽高出自 sidecar 真值。 */
export interface AlbumPhoto {
  /** 池内照片 ID（含 .webp），也是稳定标识 */
  id: string;
  /** 已解析的可服务 URL */
  src: string;
  width: number;
  height: number;
  alt: string;
  exif: unknown;
}

/** 一个对页：一到两张照片。 */
export interface AlbumSpread {
  /** 0-based 页序号 */
  index: number;
  photos: AlbumPhoto[];
}

/** 把照片按「一屏两张」切成对页序列；末屏 1 张不补空。 */
export function paginateAlbum(photos: AlbumPhoto[]): AlbumSpread[] {
  const list = Array.isArray(photos) ? photos : [];
  const spreads: AlbumSpread[] = [];
  for (let i = 0; i < list.length; i += TWO_UP) {
    spreads.push({ index: spreads.length, photos: list.slice(i, i + TWO_UP) });
  }
  return spreads;
}

/** 把任意下标夹到 [0, total-1]；total<=0 返回 0。 */
export function clampSpread(index: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const n = Number(index);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.floor(n), 0), total - 1);
}

/** 补零页码串：「01 / 38」。 */
export function spreadLabel(index: number, total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(clampSpread(index, total) + 1)} / ${pad(Math.max(0, Math.floor(total) || 0))}`;
}

/** 读屏播报文案。 */
export function announceSpread(index: number, total: number): string {
  return `第 ${clampSpread(index, total) + 1} 页，共 ${Math.max(0, Math.floor(total) || 0)} 页`;
}
