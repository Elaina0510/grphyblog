import { describe, expect, it } from 'vitest';

import {
  POOL_DIR,
  POOL_PHOTOS_DIR,
  POOL_SIDECAR_PATH,
  contentImageKey,
  contentImageKeyCandidates,
  contentImageMap,
  contentImageUrl,
  entryResourceDir,
  photoIdOf,
  poolPhotoKey,
  poolPhotoRelPath,
  poolPhotoUrl,
  resolveContentImage,
} from '../../src/utils/contentImages';

// 契约 (c) 附带：contentImages 把内容夹图片解析成构建期可服务 URL，再经 imageUrl 出口。
// 这些用例同时充当「glob 模式对复合后缀 .thumb.webp 生效」的实证（若有冲突会在此暴露）。
//
// 照片池化（admin-v2.md A6）之后，图片可能还在旧条目夹（series/<id>/photos/）里，
// 也可能已经进池（pool/photos/）。凡是「某张种子图必须可解析」的断言都写成
// 「旧形 或 池形 有一处命中」，两种状态都成立；池相关的口径/拼接用纯函数断言，
// 不依赖 glob 产物（Vitest 下 import.meta.glob 不生效，池目录也还是空的）。

describe('contentImageMap · 扫描种子内容图片', () => {
  /** 迁移期两种合法落点：旧条目夹 or 池。任一命中即说明这支图仍在构建图里。 */
  const scannedAt = (entryRel: string, id: string): boolean =>
    Object.prototype.hasOwnProperty.call(contentImageMap, entryRel) ||
    Object.prototype.hasOwnProperty.call(contentImageMap, poolPhotoKey(id));

  it('展示版与 .thumb.webp 缩略图都被收录（复合后缀可识别）', () => {
    expect(
      scannedAt('series/city-lights/photos/night-01.webp', 'night-01.webp'),
    ).toBe(true);
    expect(
      scannedAt('series/city-lights/photos/night-01.thumb.webp', 'night-01.thumb.webp'),
    ).toBe(true);
    expect(
      scannedAt('posts/2026-09-21-morning-fog/photos/dawn-01.webp', 'dawn-01.webp'),
    ).toBe(true);
  });

  it('每个映射值都是非空字符串 URL', () => {
    for (const url of Object.values(contentImageMap)) {
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    }
  });
});

describe('contentImageKey · 拼接归一', () => {
  it('目录相对 + 资源相对拼成 map key', () => {
    expect(contentImageKey('series/city-lights', 'photos/night-01.webp')).toBe(
      'series/city-lights/photos/night-01.webp',
    );
  });
  it('多余斜杠被规整', () => {
    expect(contentImageKey('/series/foo/', '/photos/a.webp')).toBe('series/foo/photos/a.webp');
  });
});

describe('resolveContentImage / contentImageUrl', () => {
  it('resolve 命中返回构建 URL，未命中返回 undefined', () => {
    expect(resolveContentImage('series/city-lights', 'photos/night-01.webp')).toBeTypeOf('string');
    expect(resolveContentImage('series/city-lights', 'photos/missing.webp')).toBeUndefined();
  });

  it('默认（无 env base）输出同源可加载 URL', () => {
    const url = contentImageUrl('series/city-lights', 'photos/night-01.webp');
    expect(url.startsWith('/')).toBe(true);
    expect(url).toContain('night-01');
  });

  it('base 可切换：把构建 URL 前缀换成 CDN', () => {
    const url = contentImageUrl('series/city-lights', 'photos/night-01.webp', {
      base: 'https://cdn.example/',
    });
    expect(url.startsWith('https://cdn.example/')).toBe(true);
    // 去掉了构建 URL 原本的前导斜杠，避免出现 //
    expect(url).not.toContain('cdn.example//');
  });

  it('查不到时退回把相对路径直接交给 imageUrl（单出口、不抛错）', () => {
    const url = contentImageUrl('series/nope', 'photos/ghost.webp', {
      base: 'https://cdn.example/',
    });
    expect(url).toBe('https://cdn.example/photos/ghost.webp');
  });

  it('随笔资源夹（同名目录）同样解析', () => {
    const url = contentImageUrl('posts/2026-09-21-morning-fog', 'photos/dawn-01.thumb.webp');
    expect(url.startsWith('/')).toBe(true);
    expect(url).toContain('dawn-01.thumb');
  });

  // 后台封面改成「从条目资源里挑」之后，平铺条目（随笔）存出来会多一层 <标识>/ 前缀。
  it('后台挑出来的 `<标识>/photos/x.webp` 与手写的 photos/x.webp 解析成同一个 URL', () => {
    const dir = 'posts/2026-09-21-morning-fog';
    expect(resolveContentImage(dir, `${dir.replace(/^posts\//, '')}/photos/dawn-01.webp`)).toBeTypeOf(
      'string',
    );
    expect(contentImageUrl(dir, '2026-09-21-morning-fog/photos/dawn-01.webp')).toBe(
      contentImageUrl(dir, 'photos/dawn-01.webp'),
    );
  });

  it('归一到 photos/ 尾段后仍查不到 → undefined（不静默指到别的图）', () => {
    expect(
      resolveContentImage('posts/2026-09-21-morning-fog', 'other-place/photos/ghost.webp'),
    ).toBeUndefined();
  });
});

describe('entryResourceDir · 由 collection+id/slug 归一资源目录（页面/灯箱一次调用）', () => {
  // 对 Astro 7 的两可能 id 形态都稳健：series 带 `/index.md`，posts 为扁平 `.md`；
  // 也接受已剥扩展的 slug 传入，结果一致。
  it('系列 id=city-lights/index.md → series/city-lights', () => {
    expect(entryResourceDir('series', 'city-lights/index.md')).toBe('series/city-lights');
  });
  it('系列传 slug（无扩展/index）也归一到同目录', () => {
    expect(entryResourceDir('series', 'city-lights')).toBe('series/city-lights');
  });
  it('随笔 id=x.md → posts/x（资源夹与 md 同名）', () => {
    expect(entryResourceDir('posts', '2026-09-21-morning-fog.md')).toBe(
      'posts/2026-09-21-morning-fog',
    );
  });

  it('归一目录能查中真实图片（池化后真键在 pool/photos/，旧条目路径经池兜底也命中）', () => {
    const dir = entryResourceDir('series', 'city-lights/index.md');
    expect(resolveContentImage(dir, 'photos/night-01.webp')).toBeTypeOf('string');
    // 迁移后真实磁盘位置是 pool/photos/：同一张图在映射表里的 key 就是这个
    expect(contentImageKey('pool', 'photos/night-01.webp')).toBe(
      'pool/photos/night-01.webp',
    );
    expect(contentImageMap).toHaveProperty('pool/photos/night-01.webp');
    // 旧条目相对路径作为入参仍能解析（contentImages 的迁移期兼容：条目相对 → 池兜底）
    expect(resolveContentImage(dir, 'photos/night-01.webp')).toBe(
      contentImageMap['pool/photos/night-01.webp'],
    );
  });
});

// =============================================================================
// 照片池化 · A6：池路径解析 + 迁移期多形兼容
//
// 池目录现在还是空的（真数据由 B 组 --migrate 落），所以这里刻意只断言**纯函数**：
// 常量口径、ID 归一、key 拼接、候选顺序。这样用例在迁移前后都成立，也不需要 mock glob。
// =============================================================================

describe('照片池 · 位置与 ID 口径（纯函数，不依赖 glob）', () => {
  it('池目录常量与拍板口径一致（相对 src/content）', () => {
    expect(POOL_DIR).toBe('pool');
    expect(POOL_PHOTOS_DIR).toBe('pool/photos');
    expect(POOL_SIDECAR_PATH).toBe('pool/photos.meta.json');
    // 展示版与缩略图同目录、sidecar 在池根 —— 三者同属 src/content 之内
    expect(POOL_PHOTOS_DIR.startsWith(`${POOL_DIR}/`)).toBe(true);
  });

  it('照片 ID = 完整文件名含 .webp（不丢 .thumb.webp 复合后缀）', () => {
    expect(photoIdOf('night-01.webp')).toBe('night-01.webp');
    expect(photoIdOf('P1230888.webp')).toBe('P1230888.webp');
    expect(photoIdOf('night-01.thumb.webp')).toBe('night-01.thumb.webp');
  });

  it('任意形路径都能归到同一个 ID（旧条目路径 / 池内相对 / 带查询串）', () => {
    const id = 'night-01.webp';
    for (const form of [
      id,
      `photos/${id}`,
      `pool/photos/${id}`,
      `series/city-lights/photos/${id}`,
      `posts/2026-09-21-morning-fog/photos/${id}`,
      `./photos/${id}`,
      `/src/content/pool/photos/${id}`,
      `photos/${id}?v=2`,
      `photos/${id}#frame`,
      `  photos\\${id}  `,
    ]) {
      expect(photoIdOf(form), `入参 ${JSON.stringify(form)}`).toBe(id);
    }
  });

  it('空入参不制造假路径（空串而非 photos/ 或池目录）', () => {
    expect(photoIdOf('')).toBe('');
    expect(photoIdOf('   ')).toBe('');
    expect(poolPhotoRelPath('')).toBe('');
    expect(poolPhotoKey('')).toBe('');
  });

  it('池内相对路径（sidecar 的 file/thumb 口径）= photos/<id>', () => {
    expect(poolPhotoRelPath('night-01.webp')).toBe('photos/night-01.webp');
    expect(poolPhotoRelPath('series/city-lights/photos/night-01.webp')).toBe(
      'photos/night-01.webp',
    );
  });

  it('池查表 key = pool/photos/<id>：ID 与 sidecar 口径拼出同一个键', () => {
    expect(poolPhotoKey('night-01.webp')).toBe('pool/photos/night-01.webp');
    expect(poolPhotoKey('photos/night-01.webp')).toBe('pool/photos/night-01.webp');
    expect(poolPhotoKey('P1230888.thumb.webp')).toBe('pool/photos/P1230888.thumb.webp');
    // key 与 contentImageKey 同口径（相对 src/content，无前导斜杠）
    expect(poolPhotoKey('night-01.webp').startsWith('/')).toBe(false);
  });
});

describe('contentImageKeyCandidates · 迁移期多形兼容的查表顺序', () => {
  const seriesDir = 'series/city-lights';
  const postDir = 'posts/2026-09-21-morning-fog';

  it('照片 ID：条目内先找同名文件，再落到池（池 key 恒为末位兜底）', () => {
    expect(contentImageKeyCandidates(seriesDir, 'night-01.webp')).toEqual([
      'series/city-lights/night-01.webp',
      'pool/photos/night-01.webp',
    ]);
  });

  it('旧的条目相对形 photos/x.webp：条目内命中优先，池是退路', () => {
    expect(contentImageKeyCandidates(seriesDir, 'photos/night-01.webp')).toEqual([
      'series/city-lights/photos/night-01.webp',
      'pool/photos/night-01.webp',
    ]);
  });

  it('后台平铺条目多一层的 <标识>/photos/x.webp：归一到 photos/ 尾段再查，最后落到池', () => {
    expect(
      contentImageKeyCandidates(postDir, '2026-09-21-morning-fog/photos/dawn-01.webp'),
    ).toEqual([
      'posts/2026-09-21-morning-fog/2026-09-21-morning-fog/photos/dawn-01.webp',
      'posts/2026-09-21-morning-fog/photos/dawn-01.webp',
      'pool/photos/dawn-01.webp',
    ]);
  });

  it('旧形一定能落到池（迁移后旧文件删了也不会断：池 key 出现在候选里）', () => {
    const id = 'night-01.webp';
    for (const form of [`photos/${id}`, `${seriesDir}/photos/${id}`, id]) {
      expect(contentImageKeyCandidates(seriesDir, form)).toContain(poolPhotoKey(id));
    }
    // 缩略图同规则
    expect(
      contentImageKeyCandidates(seriesDir, 'photos/night-01.thumb.webp'),
    ).toContain(poolPhotoKey('night-01.thumb.webp'));
  });

  it('顺序即优先级：池永远排在条目之后（迁移删文件前后 URL 不抖动）', () => {
    const keys = contentImageKeyCandidates(seriesDir, 'photos/night-01.webp');
    expect(keys[0]).toBe('series/city-lights/photos/night-01.webp');
    expect(keys[keys.length - 1]).toBe('pool/photos/night-01.webp');
    expect(keys.indexOf('pool/photos/night-01.webp')).toBe(keys.length - 1);
  });

  it('entryDir 就是池目录时首个候选即池 key（不拼出 photos/photos 这类叠层）', () => {
    expect(contentImageKeyCandidates(POOL_PHOTOS_DIR, 'night-01.webp')[0]).toBe(
      'pool/photos/night-01.webp',
    );
    expect(contentImageKeyCandidates(POOL_DIR, 'photos/night-01.webp')[0]).toBe(
      'pool/photos/night-01.webp',
    );
    for (const keys of [
      contentImageKeyCandidates(POOL_PHOTOS_DIR, 'night-01.webp'),
      contentImageKeyCandidates(POOL_DIR, 'photos/night-01.webp'),
    ]) {
      expect(keys.some((k) => k.includes('photos/photos'))).toBe(false);
    }
  });

  it('候选去重且已规整斜杠（前导 ./ 与多余 / 不影响结果）', () => {
    const keys = contentImageKeyCandidates(seriesDir, './photos/night-01.webp');
    expect(keys).toEqual(['series/city-lights/photos/night-01.webp', 'pool/photos/night-01.webp']);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => !k.startsWith('/') && !k.includes('//'))).toBe(true);
  });

  it('空引用不产生任何候选（不做兜底猜测）', () => {
    expect(contentImageKeyCandidates(seriesDir, '')).toEqual([]);
    expect(contentImageKeyCandidates(seriesDir, '   ')).toEqual([]);
    expect(contentImageKeyCandidates('', '')).toEqual([]);
  });
});

describe('照片池 · 出图路径（resolve / contentImageUrl / poolPhotoUrl 同一出口）', () => {
  const id = 'night-01.webp';

  it('池内相对形与 ID 形解析到同一结果（池空时同为 undefined，B 组填数后同为同一 URL）', () => {
    expect(resolveContentImage(POOL_DIR, `photos/${id}`)).toBe(
      resolveContentImage(POOL_PHOTOS_DIR, id),
    );
    expect(resolveContentImage(POOL_PHOTOS_DIR, id)).toBe(resolveContentImage('anything', id));
  });

  it('poolPhotoUrl 等价于 contentImageUrl(POOL_DIR, photos/<id>)（不新增第二个出口）', () => {
    expect(poolPhotoUrl(id)).toBe(contentImageUrl(POOL_DIR, `photos/${id}`));
    expect(poolPhotoUrl(id, { base: 'https://cdn.example/' })).toBe(
      contentImageUrl(POOL_DIR, `photos/${id}`, { base: 'https://cdn.example/' }),
    );
  });

  it('池里缺这张图时退化到 photos/<id>（不抛错、不加双斜杠）', () => {
    expect(poolPhotoUrl('ghost-99.webp', { base: 'https://cdn.example/' })).toBe(
      'https://cdn.example/photos/ghost-99.webp',
    );
    expect(poolPhotoUrl('ghost-99.webp')).toBe('/photos/ghost-99.webp');
    expect(poolPhotoUrl('ghost-99.webp', { base: 'https://cdn.example/' })).not.toContain(
      'cdn.example//',
    );
  });

  it('poolPhotoUrl 空 ID 返回空串（不产出指向池目录的假 URL）', () => {
    expect(poolPhotoUrl('')).toBe('');
    expect(poolPhotoUrl('', { base: 'https://cdn.example/' })).toBe('');
  });

  it('边界：ID 未命中池时不会退化成一个站点根下的裸文件名', () => {
    // 不同于旧的 relPath 直传：ID 形会补上 photos/ 前缀，与 sidecar 口径一致
    expect(
      contentImageUrl('series/city-lights', 'ghost-99.webp', { base: 'https://cdn.example/' }),
    ).toBe('https://cdn.example/photos/ghost-99.webp');
    // 已是路径的仍原样交给 imageUrl（旧行为不变）
    expect(
      contentImageUrl('series/city-lights', 'photos/ghost-99.webp', {
        base: 'https://cdn.example/',
      }),
    ).toBe('https://cdn.example/photos/ghost-99.webp');
  });

  it('空入参不抛错（出口契约：绝不 throw）', () => {
    expect(() => contentImageUrl('', '')).not.toThrow();
    expect(contentImageUrl('', '')).toBe('');
    expect(resolveContentImage('', '')).toBeUndefined();
  });
});

