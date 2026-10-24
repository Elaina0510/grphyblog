import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from '@astrojs/compiler';
import { describe, expect, it } from 'vitest';

import type { PhotoEntry } from '../../src/types/photoSidecar';
import { buildUploadEntry } from '../../public/admin/js/photos.js';

// =============================================================================
// E6 的前台一半：浏览器直传产物在 EXIF 卡上显示「EXIF 待补」
//
// 背景（为什么要有这条测试）：Canvas 重编码拿不到 EXIF 是既定取舍，取舍的代价必须**可见**——
// 否则读者会以为「这张图本来就没参数」。所以 sidecar 里打了 exifIncomplete，
// 池页（/admin）与前台 EXIF 卡都要显示角标。
//
// 前台这条路的限制：页面只把 `photo.exif`（不含条目级标记）交给 ExifCard，E 组又不许改页面，
// 所以直传时在 exif 内镜像了一份标记。这里同时钉住两件事：
//   ① 后台的 buildUploadEntry 确实产出这份标记（条目级 + exif 内镜像）；
//   ② ExifCard 编译产物里有「待补」分支，且不破坏原有的「全缺字段不渲染」契约。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function compile(rel: string): Promise<string> {
  const source = readFileSync(resolve(ROOT, rel), 'utf8');
  const result = await transform(source, {
    filename: rel.split('/').pop(),
    normalizedFilename: `/${rel}`,
    internalURL: 'astro/compiler-runtime',
    resultScopedSlot: true,
  } as Parameters<typeof transform>[1]);
  return result.code;
}

describe('直传产物带「EXIF 待补」标记', () => {
  it('条目级 exifIncomplete 与 exif 内镜像同时存在（渲染侧才拿得到）', () => {
    const entry = buildUploadEntry({
      baseName: 'web-20261024',
      width: 2560,
      height: 1707,
      thumbWidth: 800,
      thumbHeight: 533,
    }) as PhotoEntry & { exif: Record<string, unknown> };

    expect(entry.exifIncomplete).toBe(true);
    expect(entry.exif.exifIncomplete).toBe(true);
    // EXIF 字段全空（浏览器读不到），不得伪造任何参数
    for (const key of ['camera', 'lens', 'focalLength', 'aperture', 'shutter', 'iso', 'dateTaken']) {
      expect(entry.exif[key], `${key} 不该有值`).toBeNull();
    }
  });

  it('普通照片（脚本导入）不带这个标记', () => {
    const sidecar = JSON.parse(
      readFileSync(resolve(ROOT, 'src/content/pool/photos.meta.json'), 'utf8'),
    ) as PhotoEntry[];
    for (const entry of sidecar) {
      expect(entry.exifIncomplete, `${entry.file} 被误标成待补`).toBeUndefined();
      expect((entry.exif as { exifIncomplete?: boolean }).exifIncomplete).toBeUndefined();
    }
  });
});

describe('ExifCard 的「※EXIF 待补」角标', () => {
  it('编译产物里有待补分支，且走朱砂 .demo（不新造颜色/字号）', async () => {
    const code = await compile('src/components/ExifCard.astro');
    expect(code).toContain('exifIncomplete');
    expect(code).toContain('※EXIF 待补');
    expect(code).toContain('data-field');
  });

  it('原有容错契约没被破坏：缺字段容错 + 全空不渲染 + ※示例 仍在', async () => {
    const code = await compile('src/components/ExifCard.astro');
    expect(code).toContain('function present');
    expect(code).toContain('items.length > 0');
    expect(code).toContain('※示例');
    expect(code).toContain('<figcaption');
  });
});
