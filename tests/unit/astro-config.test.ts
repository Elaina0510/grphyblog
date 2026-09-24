import { describe, expect, it } from 'vitest';

import siteConfig, {
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  IMAGE_FORMAT,
  IMAGE_SPECS,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  scaleToLongEdge,
} from '../../astro.config.mjs';

// 验收点：图片参数只存在于 astro.config.mjs 一处，且数值符合 design §4 / §6。
describe('astro.config.mjs · 图片规格集中一处', () => {
  it('展示版长边为 2560px', () => {
    expect(DISPLAY_LONG_EDGE).toBe(2560);
    expect(IMAGE_SPECS.display.longEdge).toBe(2560);
  });

  it('缩略图长边为 800px', () => {
    expect(THUMB_LONG_EDGE).toBe(800);
    expect(IMAGE_SPECS.thumbnail.longEdge).toBe(800);
  });

  it('输出格式为 WebP，且两种产物共用同一格式常量', () => {
    expect(IMAGE_FORMAT).toBe('webp');
    expect(IMAGE_SPECS.format).toBe('webp');
  });

  it('quality 为合法区间，且缩略图不比展示版更高质量', () => {
    for (const q of [DISPLAY_QUALITY, THUMB_QUALITY]) {
      expect(q).toBeGreaterThan(0);
      expect(q).toBeLessThanOrEqual(100);
    }
    expect(THUMB_QUALITY).toBeLessThanOrEqual(DISPLAY_QUALITY);
  });

  it('规格对象冻结，避免运行期被别处改写（保证"只改一处"）', () => {
    expect(Object.isFrozen(IMAGE_SPECS)).toBe(true);
    expect(Object.isFrozen(IMAGE_SPECS.display)).toBe(true);
    expect(Object.isFrozen(IMAGE_SPECS.thumbnail)).toBe(true);
  });

  it('长边缩放：横图/竖图都按长边收敛，小图不放大', () => {
    // 与 raw/ 里真实素材同尺寸（4592×3448 横、3448×4592 竖）
    expect(scaleToLongEdge(4592, 3448, DISPLAY_LONG_EDGE)).toEqual({ width: 2560, height: 1922 });
    expect(scaleToLongEdge(3448, 4592, DISPLAY_LONG_EDGE)).toEqual({ width: 1922, height: 2560 });
    expect(scaleToLongEdge(600, 400, THUMB_LONG_EDGE)).toEqual({ width: 600, height: 400 });
    expect(scaleToLongEdge(4592, 3448, THUMB_LONG_EDGE)).toEqual({ width: 800, height: 601 });
  });
});

// 验收点：纯静态输出（SSR 关闭）、无前端框架依赖、图片参数已接线进 astro 配置。
describe('astro.config.mjs · 静态输出与接线', () => {
  it('output 显式为 static（SSR 关闭）', () => {
    expect(siteConfig.output).toBe('static');
  });

  it('图片参数接线进 astro image 配置，而非另写一份数值', () => {
    const image = siteConfig.image;
    expect(image?.service?.entrypoint).toBe('astro/assets/services/sharp');
    // 计算键 [IMAGE_FORMAT]：格式常量改了这里也会跟着换编码器块
    expect(image?.service?.config?.[IMAGE_FORMAT]).toEqual({ quality: DISPLAY_QUALITY });
    expect(image?.breakpoints).toEqual([THUMB_LONG_EDGE, DISPLAY_LONG_EDGE]);
    expect(image?.responsiveStyles).toBe(true);
  });

  it('构建期注入的图片常量与配置同源', () => {
    const defined = siteConfig.vite?.define ?? {};
    expect(defined['import.meta.env.PUBLIC_DISPLAY_LONG_EDGE']).toBe('2560');
    expect(defined['import.meta.env.PUBLIC_THUMB_LONG_EDGE']).toBe('800');
    expect(defined['import.meta.env.PUBLIC_IMAGE_FORMAT']).toBe('"webp"');
  });

  it('配置里不出现前端框架集成（React/Vue/Svelte/Solid…）', () => {
    const raw = JSON.stringify(siteConfig).toLowerCase();
    for (const framework of ['react', 'vue', 'svelte', 'solid', 'preact', 'astro/dist/mdx']) {
      expect(raw).not.toContain(framework);
    }
  });
});
