// @ts-check
// =============================================================================
// 构建与图片优化参数集中于此（design §3 边界②："改清晰度/换格式只改一处"）
//
// 下面的具名常量是「全站唯一的图片规格出处」：
//   - scripts/import-photos.mjs（import-photos 模块）import 它们做压缩与缩略图；
//   - imageUrl 工具函数（content-model 模块）与站点图片参数共享同一份数值；
//   - 本文件底部的 astro `image` 配置也直接消费它们，保证构建期与脚本期口径一致。
// 需要更清晰 / 更省流量 / 换格式时，只改这里，然后重新构建。
// =============================================================================

/** 展示版与缩略图的输出格式（design §4：WebP）。 */
export const IMAGE_FORMAT = /** @type {'webp'} */ ('webp');

/** 展示版长边像素（design §4：2560px 长边 WebP，目标约 300~600KB）。 */
export const DISPLAY_LONG_EDGE = 2560;

/** 缩略图长边像素（design §4：800px 长边 WebP，目标约 30~60KB）。 */
export const THUMB_LONG_EDGE = 800;

/**
 * 编码质量。design §4 给的是体积预算（§6 性能预算：展示图 ≤2MB、缩略图 ≤160KB；
 * 原为 800KB/80KB，75 张真机原图导入后放宽，见 import-photos SIZE_BUDGET），
 * 未拍板具体 quality 数值，故此处为可调值：
 *   - DISPLAY_QUALITY = 82：2560px 长边真图实测 p50≈687KB、p95≈1.4MB、max≈1.7MB，
 *     放宽预算后全部落在 2MB 内。选择「保画质、放宽预算」而非降 quality，展示清晰度优先。
 *   - THUMB_QUALITY = 64（起点 76 下调）：真图缩略实测 p50≈51KB、max≈147KB，在 160KB 内。
 *     缩略图只在网格里以小尺寸出现且懒加载，列表页负担仍轻；要改清晰度仍只改这一处。
 */
export const DISPLAY_QUALITY = 82;
export const THUMB_QUALITY = 64;

/** 供脚本与工具函数一次性 import 的规格对象。 */
export const IMAGE_SPECS = Object.freeze({
  format: IMAGE_FORMAT,
  display: Object.freeze({ longEdge: DISPLAY_LONG_EDGE, quality: DISPLAY_QUALITY }),
  thumbnail: Object.freeze({ longEdge: THUMB_LONG_EDGE, quality: THUMB_QUALITY }),
});

/**
 * 长边缩放：把宽高按长边 = longEdge 等比缩放（用于脚本侧计算尺寸）。
 * @param {number} width 原图宽
 * @param {number} height 原图高
 * @param {number} [longEdge] 目标长边
 * @returns {{ width: number, height: number }}
 */
export function scaleToLongEdge(width, height, longEdge = DISPLAY_LONG_EDGE) {
  const longest = Math.max(width, height);
  if (!longest || longest <= longEdge) return { width, height };
  const ratio = longEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

// =============================================================================
// Astro 配置：纯静态输出（SSR 关闭），不引入任何前端框架
// =============================================================================
export default {
  output: 'static',
  site: 'https://grphyblog.pages.dev',
  image: {
    // 内置 sharp 图片服务（Astro 7 的 image.service 形状为 { entrypoint, config }）
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        // 计算键 = IMAGE_FORMAT：换输出格式只改上面的常量，这里的编码器块随之改名
        [IMAGE_FORMAT]: { quality: DISPLAY_QUALITY },
      },
    },
    // 响应式图片只生成两档宽度：缩略图 + 展示版（需设 layout 才启用 breakpoints）
    layout: 'constrained',
    breakpoints: [THUMB_LONG_EDGE, DISPLAY_LONG_EDGE],
    // 生成的 <img> 带内联响应式样式，配合显式宽高防布局抖动（design §6 性能预算）
    responsiveStyles: true,
  },
  vite: {
    // 强制所有资源（含小缩略图）经 ?url 产出 /_astro/ 真文件 URL，而非内联成 data: URI：
    // 否则 <4KB 的种子缩略图会变 base64 塞进灯箱 frames JSON 岛撑爆 HTML，且 imageUrl 的 base
    // 拼接对 data: 不友好。关掉内联后全站图片恒为文件 URL，单一出口口径更干净（§3 边界③/§6 预算）。
    build: {
      assetsInlineLimit: 0,
    },
    // 把图片规格注入构建环境，组件里可用 import.meta.env.PUBLIC_IMAGE_* 读取同一份数值
    define: {
      'import.meta.env.PUBLIC_IMAGE_FORMAT': JSON.stringify(IMAGE_FORMAT),
      'import.meta.env.PUBLIC_DISPLAY_LONG_EDGE': JSON.stringify(DISPLAY_LONG_EDGE),
      'import.meta.env.PUBLIC_THUMB_LONG_EDGE': JSON.stringify(THUMB_LONG_EDGE),
    },
  },
};
