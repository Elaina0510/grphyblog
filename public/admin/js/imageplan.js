// =============================================================================
// imageplan.js —— 浏览器直传的「缩放计划」（纯函数，不碰 Canvas）
//
// E6 已定取舍：Canvas 重编码 2560px 长边 WebP（EXIF 全空）+ 池里打「EXIF 待补」角标。
// 这里只算目标尺寸，真正的编码在 app.js 的 canvas 部分。
//
// 规则（与 astro.config.mjs 的 scaleToLongEdge 同口径）：
//   · 按长边等比缩放（横竖图都收敛到同一长边）；
//   · 长边已经 ≤ 目标值时不放大（原样输出，避免无意义重采样）；
//   · 四舍五入，最小值 1px（极端细长图不至于算出 0）。
//
// 单测：tests/unit/admin-image-plan.test.ts
// =============================================================================

/**
 * @param {{width:number, height:number, longEdge:number}} input
 * @returns {{width:number, height:number, longEdge:number, scale:number, resized:boolean}}
 */
export function planCompression({ width, height, longEdge }) {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  const edge = Math.floor(Number(longEdge));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new TypeError(`尺寸非法：${width}×${height}`);
  }
  if (!Number.isFinite(edge) || edge <= 0) {
    throw new TypeError(`长边非法：${longEdge}`);
  }
  const longest = Math.max(w, h);
  if (longest <= edge) {
    return { width: w, height: h, longEdge: edge, scale: 1, resized: false };
  }
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    longEdge: edge,
    scale,
    resized: true,
  };
}

/** 展示版计划（2560px 长边）。 */
export function planDisplay(width, height, longEdge) {
  return planCompression({ width, height, longEdge });
}

/** 缩略图计划（800px 长边）。 */
export function planThumb(width, height, longEdge) {
  return planCompression({ width, height, longEdge });
}

export default { planCompression, planDisplay, planThumb };
