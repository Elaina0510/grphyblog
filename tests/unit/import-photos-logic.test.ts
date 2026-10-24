import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  IMAGE_FORMAT,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
} from '../../astro.config.mjs';
import { postsSchema, seriesSchema } from '../../src/content/schemas';
import {
  SUPPORTED_RAW_EXTENSIONS,
  applyFrontmatterBackfill,
  baseName,
  baseNameFromDisplayPath,
  buildIllustrationRefLines,
  buildManifest,
  buildMigrationReport,
  buildPhotoEntry,
  buildPoolIllustrationRefLines,
  composeCamera,
  composeLens,
  deriveTitle,
  discoverEntryMarkdowns,
  discoverLegacyEntries,
  displayFileNameOf,
  displayPhotoIdOf,
  entryRelPaths,
  formatBytes,
  formatDateTaken,
  formatShutter,
  frontmatterPhotosOf,
  frontmatterValueOf,
  groupDuplicateBasenames,
  interpretPromptAnswers,
  isKnownUnsupportedImage,
  isSupportedRawImage,
  mapExif,
  mergeLegacySidecars,
  mergeSidecar,
  normalizeDate,
  parseArgs,
  parseMigrateSteps,
  photoIdFromPath,
  photoSignature,
  pickCollection,
  planBackfill,
  planImports,
  planOutputSize,
  planPoolMoves,
  PROMPT_KIND,
  PROMPT_POST_ID,
  PROMPT_SERIES_ID,
  promptTarget,
  renderPostMarkdown,
  renderSeriesMarkdown,
  resolveTarget,
  runCli,
  serializeSidecar,
  splitFrontmatter,
  thumbFileNameOf,
  todayISO,
  validateIdentifier,
  dateFromIdentifier,
} from '../../scripts/import-photos.mjs';

// ============================================================================
// import-photos 的「纯函数层」单测（§4.2：核心模块重测；I/O 与计算分离才谈得上测得到）。
// 真实 sharp/exifr 跑产物的部分见同目录 import-photos-pipeline.test.ts。
// ============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 从 `---\nfrontmatter\n---` 里取出原文（骨架文件由脚本生成，形状固定）。 */
function frontmatterOf(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  expect(m, '生成的 Markdown 缺少 frontmatter').not.toBeNull();
  return /** @type {RegExpMatchArray} */ (m)[1];
}

/** 骨架 frontmatter 的键值读取（只用在本文件里对已知简单格式做断言，不通用）。 */
function scalar(frontmatter, key) {
  const m = new RegExp(`^${key}:[ ]*(.+)$`, 'm').exec(frontmatter);
  return m ? m[1].trim() : undefined;
}

describe('输入格式白名单（任务 1：jpg/png，HEIC 明确不做）', () => {
  it('jpg / jpeg / png（含大写扩展名）被支持', () => {
    for (const name of ['P1230857.jpg', 'a.jpeg', 'b.JPG', 'c.PNG']) {
      expect(isSupportedRawImage(name), name).toBe(true);
    }
    expect(SUPPORTED_RAW_EXTENSIONS).toEqual(['.jpg', '.jpeg', '.png']);
  });

  it('HEIC / RAW / TIFF 属于「已知不支持」，其余非图片文件两者皆否', () => {
    expect(isSupportedRawImage('x.heic')).toBe(false);
    expect(isKnownUnsupportedImage('x.heic')).toBe(true);
    expect(isKnownUnsupportedImage('x.tiff')).toBe(true);
    expect(isKnownUnsupportedImage('notes.txt')).toBe(false);
  });
});

describe('输出文件名派生（落位口径与种子内容一致）', () => {
  it('baseName 去掉目录与扩展名，相机名原样保留', () => {
    expect(baseName('P1230857.jpg')).toBe('P1230857');
    expect(baseName('some/dir/photo-01.jpeg')).toBe('photo-01');
    expect(baseName('no-extension')).toBe('no-extension');
  });

  it('展示版与缩略图文件名沿用 <base>.webp / <base>.thumb.webp 复合后缀', () => {
    expect(displayFileNameOf('night-01')).toBe('night-01.webp');
    expect(thumbFileNameOf('night-01')).toBe('night-01.thumb.webp');
    expect(entryRelPaths('night-01')).toEqual({
      file: 'photos/night-01.webp',
      thumb: 'photos/night-01.thumb.webp',
    });
  });

  it('文件名一律用 astro.config 的 IMAGE_FORMAT，不在脚本里写死', () => {
    expect(displayFileNameOf('x')).toBe(`x.${IMAGE_FORMAT}`);
    expect(entryRelPaths('x').thumb).toBe(`photos/x.thumb.${IMAGE_FORMAT}`);
  });

  it('baseNameFromDisplayPath 是 entryRelPaths 的逆运算（幂等判定依赖它）', () => {
    expect(baseNameFromDisplayPath('photos/night-01.webp')).toBe('night-01');
    expect(baseNameFromDisplayPath(entryRelPaths('P1230857').file)).toBe('P1230857');
    expect(baseNameFromDisplayPath(undefined)).toBe('');
  });
});

describe('EXIF → Exif 字段映射（任务 5，含缺字段容错留空）', () => {
  it('完整 EXIF：机型合成、镜头、焦距、光圈、快门分数串、ISO、日期', () => {
    const exif = mapExif({
      Make: 'Panasonic',
      Model: 'DMC-GX85',
      LensModel: 'LUMIX G 14/F2.5',
      FocalLength: 14,
      FNumber: 5,
      ExposureTime: 0.008,
      ISO: 200,
      DateTimeOriginal: new Date('2026-08-10T03:08:28.000Z'),
    });
    expect(exif).toEqual({
      camera: 'Panasonic DMC-GX85',
      lens: 'LUMIX G 14/F2.5',
      focalLength: 14,
      aperture: 5,
      shutter: '1/125',
      iso: 200,
      dateTaken: '2026-08-10',
    });
  });

  it('完全没有 EXIF 时七个字段全部留 null，不抛错', () => {
    expect(mapExif({})).toEqual({
      camera: null,
      lens: null,
      focalLength: null,
      aperture: null,
      shutter: null,
      iso: null,
      dateTaken: null,
    });
    // 极端入参：undefined / null 也不能炸（exifr 对无 EXIF 文件就返回 undefined）
    expect(mapExif(undefined).camera).toBeNull();
    expect(mapExif(null).iso).toBeNull();
  });

  it('只有一两项 EXIF 时按项容错，缺的仍是 null', () => {
    const exif = mapExif({ Model: 'ILCE-7M4', ISO: 400 });
    expect(exif.camera).toBe('ILCE-7M4');
    expect(exif.iso).toBe(400);
    expect(exif.lens).toBeNull();
    expect(exif.focalLength).toBeNull();
    expect(exif.aperture).toBeNull();
    expect(exif.shutter).toBeNull();
    expect(exif.dateTaken).toBeNull();
  });

  it('退回链生效：ApertureValue / FocalLengthIn35mmFilm / CreateDate / ISO 数组', () => {
    const exif = mapExif({
      ApertureValue: 2.8,
      FocalLengthIn35mmFilm: 35,
      ISOSpeedRatings: [640],
      CreateDate: '2026:03:04 10:11:12',
    });
    expect(exif.aperture).toBe(2.8);
    expect(exif.focalLength).toBe(35);
    expect(exif.iso).toBe(640);
    expect(exif.dateTaken).toBe('2026-03-04');
  });

  it('只有 ShutterSpeedValue（AV 秒对数）时反算快门', () => {
    // 2^-7 = 1/128
    expect(mapExif({ ShutterSpeedValue: 7 }).shutter).toBe('1/128');
  });

  it('占位垃圾值（Unknown / --- / 空串 / 0）当作缺失', () => {
    const exif = mapExif({ Make: '---', Model: 'Unknown', LensModel: '', FNumber: 0, ISO: 'NA' });
    expect(exif.camera).toBeNull();
    expect(exif.lens).toBeNull();
    expect(exif.aperture).toBeNull();
    expect(exif.iso).toBeNull();
  });

  it('机型合成：Model 已含厂商名时不重复拼接', () => {
    expect(composeCamera({ Make: 'FUJIFILM', Model: 'X-T5' })).toBe('FUJIFILM X-T5');
    expect(composeCamera({ Make: 'NIKON CORPORATION', Model: 'NIKON CORPORATION Z6' })).toBe(
      'NIKON CORPORATION Z6',
    );
    expect(composeCamera({ Model: '  ILCE-7M4  ' })).toBe('ILCE-7M4');
  });

  it('镜头合成：必要时带 LensMake 前缀', () => {
    expect(composeLens({ LensMake: 'SIGMA', LensModel: '50mm F1.4' })).toBe('SIGMA 50mm F1.4');
    expect(composeLens({ LensMake: 'SIGMA', LensModel: 'SIGMA 50mm' })).toBe('SIGMA 50mm');
    expect(composeLens({ LensModel: 'Unknown' })).toBeNull();
  });

  it('快门格式化：长曝留秒、短曝化分数', () => {
    expect(formatShutter(0.00125)).toBe('1/800');
    expect(formatShutter(0.01)).toBe('1/100');
    expect(formatShutter(0.5)).toBe('1/2');
    expect(formatShutter(2)).toBe('2s');
    expect(formatShutter(2.54)).toBe('2.5s');
    expect(formatShutter('0.02')).toBe('1/50');
    expect(formatShutter(0)).toBeNull();
    expect(formatShutter(undefined)).toBeNull();
    expect(formatShutter('abc')).toBeNull();
  });

  it('日期格式化接受 Date / EXIF 串 / ISO 串，且输出 YYYY-MM-DD（与种子口径一致）', () => {
    expect(formatDateTaken(new Date('2026-09-20T15:00:00.000Z'))).toBe('2026-09-20');
    expect(formatDateTaken('2026:09:20 10:00:00')).toBe('2026-09-20');
    expect(formatDateTaken('2026-09-20T23:00:00Z')).toBe('2026-09-20');
    expect(formatDateTaken(new Date('bad'))).toBeNull();
    expect(formatDateTaken(null)).toBeNull();
  });
});

describe('PhotoEntry 组装（§3.7 显式宽高所需的四个像素字段）', () => {
  it('写入 file/thumb/width/height/thumbWidth/thumbHeight/exif', () => {
    const entry = buildPhotoEntry({
      basename: 'night-01',
      width: 2560,
      height: 1707,
      thumbWidth: 800,
      thumbHeight: 533,
      exif: { Make: 'FUJIFILM', Model: 'X-T5', FNumber: 1.2 },
    });
    expect(entry).toEqual({
      file: 'photos/night-01.webp',
      thumb: 'photos/night-01.thumb.webp',
      width: 2560,
      height: 1707,
      thumbWidth: 800,
      thumbHeight: 533,
      exif: {
        camera: 'FUJIFILM X-T5',
        lens: null,
        focalLength: null,
        aperture: 1.2,
        shutter: null,
        iso: null,
        dateTaken: null,
      },
    });
  });

  it('宽高数字被规范化（sharp 偶发字符串也能落正数）', () => {
    const entry = buildPhotoEntry({
      basename: 'x',
      width: '2560',
      height: '1707',
      thumbWidth: '800',
      thumbHeight: '533',
    });
    expect([entry.width, entry.height, entry.thumbWidth, entry.thumbHeight]).toEqual([
      2560, 1707, 800, 533,
    ]);
  });
});

describe('幂等 / 新图判定（任务 2）', () => {
  const sidecar = [
    { file: 'photos/old-a.webp', thumb: 'photos/old-a.thumb.webp' },
    { file: 'photos/broken.webp', thumb: 'photos/broken.thumb.webp' },
  ];
  const onDisk = new Set([
    'photos/old-a.webp',
    'photos/old-a.thumb.webp',
    'photos/broken.webp', // 缩略图丢了
    'photos/new-b.webp',
    'photos/new-b.thumb.webp',
  ]);

  it('sidecar 有记录且两个产物都在 → 跳过', () => {
    const { newOnes, skipped } = planImports({
      rawFiles: ['old-a.jpg', 'new-b.jpg'],
      sidecar,
      existingRels: onDisk,
    });
    expect(skipped).toEqual([{ file: 'old-a.jpg', basename: 'old-a', reason: '已导入' }]);
    expect(newOnes).toEqual([{ file: 'new-b.jpg', basename: 'new-b', replacing: false }]);
  });

  it('整批已导入 → 新图为空（CLI 据此报「全部跳过」）', () => {
    const { newOnes, skipped } = planImports({
      rawFiles: ['old-a.jpg'],
      sidecar,
      existingRels: ['photos/old-a.webp', 'photos/old-a.thumb.webp'],
    });
    expect(newOnes).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it('产物不完整或完全没记录 → 当新图（sidecar 有记录但文件丢了则标记 replacing）', () => {
    const { newOnes } = planImports({
      rawFiles: ['broken.jpg', 'fresh.png', 'unknown.jpg'],
      sidecar,
      existingRels: onDisk,
    });
    expect(newOnes).toEqual([
      { file: 'broken.jpg', basename: 'broken', replacing: true },
      { file: 'fresh.png', basename: 'fresh', replacing: false },
      { file: 'unknown.jpg', basename: 'unknown', replacing: false },
    ]);
  });

  it('空 sidecar / 缺参也不炸', () => {
    expect(planImports({ rawFiles: ['a.jpg'] }).newOnes).toHaveLength(1);
    expect(planImports({ rawFiles: [] , sidecar: null, existingRels: undefined }).newOnes).toEqual([]);
  });
});

describe('sidecar 合并与序列化（任务 6：顺序即灯箱帧序列）', () => {
  it('原位替换旧条目、按导入顺序追加新条目，绝不重排', () => {
    const existing = [{ file: 'photos/a.webp' }, { file: 'photos/b.webp' }];
    const merged = mergeSidecar(existing, [
      { file: 'photos/a.webp', width: 999 },
      { file: 'photos/c.webp' },
    ]);
    expect(merged.map((e) => e.file)).toEqual(['photos/a.webp', 'photos/b.webp', 'photos/c.webp']);
    expect(/** @type {{width:number}} */ (merged[0]).width).toBe(999);
  });

  it('序列化固定 2 空格缩进并以换行结尾（git diff 友好）', () => {
    const text = serializeSidecar([{ file: 'photos/a.webp' }]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  {\n');
    expect(JSON.parse(text)).toEqual([{ file: 'photos/a.webp' }]);
  });
});

describe('参数解析（任务 9）', () => {
  it('--series / --post 各自主导一种模式', () => {
    expect(parseArgs(['--series', 'daily-frames'])).toMatchObject({
      collection: 'series',
      identifier: 'daily-frames',
      interactive: false,
    });
    expect(parseArgs(['--post', '2026-09-24-evening-stroll'])).toMatchObject({
      collection: 'posts',
      identifier: '2026-09-24-evening-stroll',
    });
    expect(parseArgs(['-s', 'x'])).toMatchObject({ collection: 'series', identifier: 'x' });
    expect(parseArgs(['--series=daily-frames'])).toMatchObject({ identifier: 'daily-frames' });
  });

  it('三个目标都明确：--pool / --series / --post（--pool 与条目目标互斥）', () => {
    expect(parseArgs(['--pool'])).toMatchObject({ pool: true, collection: null, interactive: false });
    expect(() => parseArgs(['--pool', '--series', 'a'])).toThrow(/不能同时使用/);
    expect(() => parseArgs(['--series', 'a', '--pool'])).toThrow(/不能同时使用/);
  });

  it('--migrate 收步骤：all / 单步 / 逗号组合，未知步骤报错，且与导入目标互斥', () => {
    expect(parseArgs(['--migrate'])).toMatchObject({ migrate: ['move', 'merge', 'backfill', 'cover'] });
    expect(parseArgs(['--migrate=all'])).toMatchObject({ migrate: ['move', 'merge', 'backfill', 'cover'] });
    expect(parseArgs(['--migrate=merge'])).toMatchObject({ migrate: ['merge'] });
    expect(parseArgs(['--migrate', 'cover'])).toMatchObject({ migrate: ['cover'] });
    // 写法顺序不影响执行顺序：恒定按 move → merge → backfill → cover
    expect(parseArgs(['--migrate=cover,merge'])).toMatchObject({ migrate: ['merge', 'cover'] });
    expect(() => parseArgs(['--migrate=oops'])).toThrow(/未知的迁移步骤/);
    expect(() => parseArgs(['--migrate', '--series', 'a'])).toThrow(/不能与/);
    expect(parseArgs(['--migrate']).interactive).toBe(false);
  });

  it('两个都不给 → 解析层留空（CLI 层按 B1 兜底成「进池」）', () => {
    const parsed = parseArgs([]);
    expect(parsed.collection).toBeNull();
    expect(parsed.pool).toBe(false);
    expect(parsed.migrate).toBeNull();
    expect(parsed.interactive).toBe(true);
  });

  it('--series 与 --post 同时给要报错，未知参数与缺值也报错', () => {
    expect(() => parseArgs(['--series', 'a', '--post', 'b'])).toThrow(/不能同时使用/);
    expect(() => parseArgs(['--nope'])).toThrow(/未识别的参数/);
    expect(() => parseArgs(['--series'])).toThrow(/缺少取值/);
    expect(() => parseArgs(['--series', '../escape'])).toThrow(/不能包含路径分隔符/);
  });

  it('--only / --title / --date / --help 都被读出来', () => {
    expect(parseArgs(['--series', 'a', '--only', 'P1.jpg,P2', '--title', '日常帧', '--date', '2026-09-24'])).toMatchObject(
      { only: ['P1.jpg', 'P2'], title: '日常帧', date: '2026-09-24' },
    );
    expect(parseArgs(['-h'])).toMatchObject({ help: true });
  });
});

describe('标识校验与落位约定（任务 7/8 的路径口径）', () => {
  it('合法标识原样返回（含中文），越界写法被拒', () => {
    expect(validateIdentifier('daily-frames')).toBe('daily-frames');
    expect(validateIdentifier('2026-09-24-晨雾')).toBe('2026-09-24-晨雾');
    for (const bad of ['', '  ', 'a/b', 'a\\b', '..', 'a..b', 'x*.jpg', '-lead']) {
      expect(() => validateIdentifier(bad), bad).toThrow();
    }
  });

  it('系列：产物与 sidecar 与 index.md 都在同一资源夹内', () => {
    expect(resolveTarget('series', 'daily-frames')).toEqual({
      collection: 'series',
      identifier: 'daily-frames',
      entryDir: 'series/daily-frames',
      markdownPath: 'series/daily-frames/index.md',
      sidecarPath: 'series/daily-frames/photos.meta.json',
      photosDir: 'series/daily-frames/photos',
    });
  });

  it('随笔：资源夹与 .md 同名（.md 在资源夹之外）', () => {
    expect(resolveTarget('posts', '2026-09-24-evening-stroll')).toEqual({
      collection: 'posts',
      identifier: '2026-09-24-evening-stroll',
      entryDir: 'posts/2026-09-24-evening-stroll',
      markdownPath: 'posts/2026-09-24-evening-stroll.md',
      sidecarPath: 'posts/2026-09-24-evening-stroll/photos.meta.json',
      photosDir: 'posts/2026-09-24-evening-stroll/photos',
    });
  });

  it('池：entryDir 是池根，sidecar 在池根，没有 .md（B1）', () => {
    expect(resolveTarget('pool')).toEqual({
      collection: 'pool',
      identifier: 'pool',
      entryDir: 'pool',
      markdownPath: null,
      sidecarPath: 'pool/photos.meta.json',
      photosDir: 'pool/photos',
    });
    // 池口径下 sidecar 的 file/thumb 仍是 photos/x.webp（池内相对路径）
    expect(entryRelPaths('night-01')).toEqual({
      file: 'photos/night-01.webp',
      thumb: 'photos/night-01.thumb.webp',
    });
  });

  it('未知目标类型报错', () => {
    // @ts-expect-error 故意传非法类型，运行时必须拒绝
    expect(() => resolveTarget('albums', 'x')).toThrow(/未知的目标类型/);
  });
});

describe('条目骨架 Markdown（任务 8/10：draft:true 且过 schema）', () => {
  it('系列骨架字段齐全，能被真实 seriesSchema 接受且 draft 为 true', () => {
    const md = renderSeriesFixture();
    const frontmatter = frontmatterOf(md);
    expect(scalar(frontmatter, 'draft')).toBe('true');
    expect(scalar(frontmatter, 'cover')).toBe('photos/P1230857.webp');
    expect(scalar(frontmatter, 'order')).toBe('2');
    expect(scalar(frontmatter, 'date')).toBe('2026-09-24');
    expect(scalar(frontmatter, 'tags')).toBe('[]');
    const parsed = seriesSchema.safeParse({
      title: scalar(frontmatter, 'title'),
      date: scalar(frontmatter, 'date'),
      cover: scalar(frontmatter, 'cover'),
      tags: [],
      order: Number(scalar(frontmatter, 'order')),
      draft: scalar(frontmatter, 'draft') === 'true',
    });
    expect(parsed.success).toBe(true);
  });

  it('随笔骨架字段齐全，能被真实 postsSchema 接受且 draft 为 true', () => {
    const md = renderPostFixture();
    const frontmatter = frontmatterOf(md);
    expect(scalar(frontmatter, 'draft')).toBe('true');
    expect(scalar(frontmatter, 'date')).toBe('2026-09-24');
    expect(scalar(frontmatter, 'cover')).toBe('photos/P1230857.webp');
    // postsSchema 无 order（时间倒序即可）
    expect(scalar(frontmatter, 'order')).toBeUndefined();
    const parsed = postsSchema.safeParse({
      title: scalar(frontmatter, 'title'),
      date: scalar(frontmatter, 'date'),
      cover: scalar(frontmatter, 'cover'),
      tags: [],
      draft: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('含 YAML 特殊字符的标题被加引号，不会写坏 frontmatter', () => {
    const md = renderPostMarkdown({
      identifier: '2026-09-24-x',
      date: '2026-09-24',
      cover: 'photos/a.webp',
      title: '雾:光 #1',
    });
    expect(frontmatterOf(md)).toContain('title: "雾:光 #1"');
  });

  it('标题省略时由标识派生（随笔先剥日期段）', () => {
    expect(deriveTitle('daily-frames')).toBe('Daily Frames');
    expect(deriveTitle('2026-09-24-evening-stroll')).toBe('Evening Stroll');
    expect(deriveTitle('晨雾')).toBe('晨雾');
  });
});

describe('尺寸推算与清单统计', () => {
  it('planOutputSize 走 astro.config 的 scaleToLongEdge，长边命中常量', () => {
    const big = planOutputSize(4592, 3448, undefined, DISPLAY_LONG_EDGE);
    expect(Math.max(big.width, big.height)).toBe(DISPLAY_LONG_EDGE);
    expect(big).toEqual({ width: 2560, height: 1922 });
    const thumb = planOutputSize(4592, 3448, undefined, THUMB_LONG_EDGE);
    expect(Math.max(thumb.width, thumb.height)).toBe(THUMB_LONG_EDGE);
  });

  it('EXIF orientation 5~8 先交换宽高再缩放', () => {
    // 存储为 3448×4592、orientation=6（需转正成 4592×3448）→ 展示版 2560×1922
    expect(planOutputSize(3448, 4592, 6, DISPLAY_LONG_EDGE)).toEqual({
      width: 2560,
      height: 1922,
    });
    // orientation 1（正常）不交换
    expect(planOutputSize(4592, 3448, 1, DISPLAY_LONG_EDGE).width).toBe(2560);
  });

  it('小于目标长边的图不放大', () => {
    expect(planOutputSize(600, 400, undefined, THUMB_LONG_EDGE)).toEqual({
      width: 600,
      height: 400,
    });
  });

  it('buildManifest 统计新增/跳过，并给出「全部跳过」判据', () => {
    const target = resolveTarget('series', 'daily-frames');
    const added = [
      {
        basename: 'P1',
        file: 'photos/P1.webp',
        thumb: 'photos/P1.thumb.webp',
        width: 2560,
        height: 1923,
        thumbWidth: 800,
        thumbHeight: 601,
        bytes: 350_000,
        thumbBytes: 40_000,
      },
    ];
    const first = buildManifest({ target, createdEntry: true, added, skipped: [] });
    expect(first.addedCount).toBe(1);
    expect(first.skippedCount).toBe(0);
    expect(first.allSkipped).toBe(false);
    expect(first.lines.join('\n')).toContain('结果：新增 1 张、跳过 0 张。');
    expect(first.lines.join('\n')).toContain('新建草稿骨架');
    expect(first.lines.join('\n')).toContain('2560×1923');

    const again = buildManifest({
      target,
      skipped: [{ file: 'P1.jpg', basename: 'P1', reason: '已导入' }],
    });
    expect(again.allSkipped).toBe(true);
    expect(again.lines.join('\n')).toContain('结果：新增 0 张、跳过 1 张。');
    expect(again.lines.join('\n')).toContain('P1.jpg');
  });

  it('超出 §6 预算时在清单里点名要调 astro.config 的 quality', () => {
    const target = resolveTarget('series', 'x');
    const manifest = buildManifest({
      target,
      added: [
        {
          basename: 'H',
          file: 'photos/H.webp',
          thumb: 'photos/H.thumb.webp',
          width: 2560,
          height: 1923,
          thumbWidth: 800,
          thumbHeight: 601,
          bytes: 900 * 1024,
          thumbBytes: 90 * 1024,
        },
      ],
      budget: { displayBytes: 800 * 1024, thumbBytes: 80 * 1024 },
    });
    const text = manifest.lines.join('\n');
    expect(text).toContain('DISPLAY_QUALITY');
    expect(text).toContain('THUMB_QUALITY');
  });

  it('formatBytes 给人看的 KB', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(350_000)).toBe('341.8KB');
  });

  it('HEIC 之类被忽略时也写进清单说明', () => {
    const manifest = buildManifest({
      target: resolveTarget('series', 'x'),
      ignored: ['a.HEIC'],
    });
    expect(manifest.lines.join('\n')).toContain('已忽略 1 个不支持的文件');
  });
});

describe('正文插图引用行（buildIllustrationRefLines：后台 Markdown 模式照抄用）', () => {
  const sidecar = [
    { file: 'photos/dawn-01.webp', thumb: 'photos/dawn-01.thumb.webp' },
    { file: 'photos/dawn-02.webp', thumb: 'photos/dawn-02.thumb.webp' },
  ];

  it('系列：路径相对条目（photos/x.webp），顺序 = sidecar 顺序', () => {
    expect(buildIllustrationRefLines({ sidecar, collection: 'series', entryId: 'daily-frames' })).toEqual([
      '![说明](photos/dawn-01.webp)',
      '![说明](photos/dawn-02.webp)',
    ]);
  });

  it('随笔：路径带上同名资源夹标识（<标识>/photos/x.webp）', () => {
    expect(
      buildIllustrationRefLines({
        sidecar,
        collection: 'posts',
        entryId: '2026-09-24-evening-stroll',
      }),
    ).toEqual([
      '![说明](2026-09-24-evening-stroll/photos/dawn-01.webp)',
      '![说明](2026-09-24-evening-stroll/photos/dawn-02.webp)',
    ]);
  });

  it('跳过缩略图（.thumb.）、非 webp、空 / 缺 file 与脏条目', () => {
    const messy = [
      { file: 'photos/a.webp', thumb: 'photos/a.thumb.webp' },
      { file: 'photos/b.thumb.webp' }, // 防御：file 直接写成缩略图
      { file: 'photos/c.png' }, // 非 webp
      { file: '' }, // 空串
      { thumb: 'photos/d.thumb.webp' }, // 缺 file
      null, // 脏条目
      { file: 'photos/e.webp' },
    ];
    expect(buildIllustrationRefLines({ sidecar: messy, collection: 'series' })).toEqual([
      '![说明](photos/a.webp)',
      '![说明](photos/e.webp)',
    ]);
  });

  it('顺序严格按传入 sidecar，绝不排序（与灯箱帧序列同口径）', () => {
    const ordered = [{ file: 'photos/z.webp' }, { file: 'photos/a.webp' }, { file: 'photos/m.webp' }];
    expect(buildIllustrationRefLines({ sidecar: ordered, collection: 'series' })).toEqual([
      '![说明](photos/z.webp)',
      '![说明](photos/a.webp)',
      '![说明](photos/m.webp)',
    ]);
  });

  it('空 / 缺省入参 → 空数组（CLI 据此不打印这块）', () => {
    expect(buildIllustrationRefLines({ sidecar: [], collection: 'series' })).toEqual([]);
    expect(buildIllustrationRefLines({})).toEqual([]);
    expect(buildIllustrationRefLines()).toEqual([]);
  });

  it('随笔标识为空时退化成条目相对路径（不写出前导斜杠的脏值）', () => {
    expect(
      buildIllustrationRefLines({ sidecar: [{ file: 'photos/a.webp' }], collection: 'posts' }),
    ).toEqual(['![说明](photos/a.webp)']);
  });
});

describe('日期与序号辅助', () => {
  it('normalizeDate 只接受能识别的写法', () => {
    expect(normalizeDate('2026-09-24')).toBe('2026-09-24');
    expect(normalizeDate('2026:09:24 10:00')).toBe('2026-09-24');
    expect(normalizeDate('昨天')).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });

  it('dateFromIdentifier 取随笔标识前缀日期', () => {
    expect(dateFromIdentifier('2026-09-24-evening-stroll')).toBe('2026-09-24');
    expect(dateFromIdentifier('daily-frames')).toBeNull();
  });

  it('todayISO 输出 YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 8, 4))).toBe('2026-09-04');
  });
});

describe('脚本不碰原图、不跑 git（design §4 原图策略 + §7 硬约束）', () => {
  const source = readFileSync(path.join(ROOT, 'scripts/import-photos.mjs'), 'utf8');
  /** 剥掉块注释与行注释：头部说明里出现 unlink/rename 字样是正常的，不该被当违规。 */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  /** 再剔掉 SIZE_BUDGET 声明：那里出现的 800/80 是 §6 验收阈值，不是图片规格。 */
  const codeWithoutBudget = code.replace(/export const SIZE_BUDGET[\s\S]*?\}\);/g, '');

  it('不引入 child_process / git（提交与推送归人）', () => {
    for (const forbidden of ['child_process', 'execSync', 'spawn', 'execFile', 'simple-git']) {
      expect(code, `脚本不应出现 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('删除/改名类 API 只出现在迁移段，且绝不落在 raw/ 上（K6）', () => {
    // --migrate 必须能搬走旧产物的副本，故 unlink / rename 是允许的；红线是「不碰 raw/」。
    expect(code).toContain('fsp.rename(');
    expect(code).toContain('fsp.unlink(');
    for (const line of code.split('\n')) {
      if (!/\.(unlink|rename|rmdir|rmSync)\s*\(/.test(line)) continue;
      expect(line.toLowerCase(), `破坏性 API 出现在含 raw 的行：${line.trim()}`).not.toContain('raw');
    }
    // rawDir 是本文件唯一指向原图目录的变量，任何破坏性调用都不许拿它当参数
    for (const match of code.matchAll(/fsp\.(unlink|rename)\(([^)]*)\)/g)) {
      expect(match[2], `破坏性调用接到了原图路径：${match[0]}`).not.toContain('rawDir');
    }
  });

  it('fs 只用 mkdir / readFile / readdir / writeFile / copyFile / rename / unlink', () => {
    const calls = [...code.matchAll(/fsp\.(\w+)\(/g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual([
      'copyFile',
      'mkdir',
      'readFile',
      'readdir',
      'rename',
      'unlink',
      'writeFile',
    ]);
  });

  it('缩放与质量一律取 astro.config 常量，脚本内不写死像素', () => {
    expect(code).toContain("from '../astro.config.mjs'");
    expect(code).toContain('resizeOptions(DISPLAY_LONG_EDGE)');
    expect(code).toContain('resizeOptions(THUMB_LONG_EDGE)');
    expect(code).toContain('quality: DISPLAY_QUALITY');
    expect(code).toContain('quality: THUMB_QUALITY');
    for (const pixelLiteral of ['2560', '800']) {
      expect(codeWithoutBudget, `脚本里不该出现像素字面量 ${pixelLiteral}`).not.toContain(pixelLiteral);
    }
  });

  it('IMAGE_FORMAT 也来自 astro.config：产物扩展名由常量拼出', () => {
    expect(code).toContain('${IMAGE_FORMAT}');
    expect(code).not.toContain("'.webp'");
  });
});

// ---- 局部小工具：骨架 fixture ----
function renderSeriesFixture() {
  return renderSeriesMarkdown({
    identifier: 'daily-frames',
    date: '2026-09-24',
    cover: 'photos/P1230857.webp',
    order: 2,
  });
}

function renderPostFixture() {
  return renderPostMarkdown({
    identifier: '2026-09-24-evening-stroll',
    date: '2026-09-24',
    cover: 'photos/P1230857.webp',
  });
}

// 质量常量层面：确保脚本用的确实是 astro.config 的当前值（防止两处口径漂移）。
describe('quality 常量单一出处（当前复核值）', () => {
  it('DISPLAY_QUALITY/THUMB_QUALITY 由 astro.config 导出且缩略不高于展示', () => {
    expect(DISPLAY_QUALITY).toBeGreaterThan(0);
    expect(THUMB_QUALITY).toBeLessThanOrEqual(DISPLAY_QUALITY);
  });
});

describe('零散分支的兜底行为（覆盖率不许留明显窟窿）', () => {
  it('formatBytes 拿到非数字时给人话而不是 NaN', () => {
    expect(formatBytes('abc')).toBe('未知');
    expect(formatBytes(undefined)).toBe('未知');
  });

  it('纯数字标识的标题原样保留', () => {
    expect(deriveTitle('2026')).toBe('2026');
  });

  it('骨架可以带初始标签（数组字面量形式写进 frontmatter）', () => {
    const md = renderSeriesMarkdown({
      identifier: 'tagged',
      date: '2026-09-24',
      cover: 'photos/a.webp',
      order: 1,
      tags: ['城市', '夜景', '  '],
    });
    expect(frontmatterOf(md)).toContain('tags: [城市, 夜景]');
  });

  it('日期还接受毫秒时间戳', () => {
    expect(formatDateTaken(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02');
    expect(formatDateTaken(Number.NaN)).toBeNull();
  });

  it('exifr 把镜头/ISO 给成数组时也能消化', () => {
    expect(composeLens({ LensInfo: ['Sigma', '50mm'] })).toBe('Sigma 50mm');
    expect(mapExif({ ISOSpeedRatings: [0, 320] }).iso).toBe(320);
    expect(mapExif({ ISO: [] }).iso).toBeNull();
  });

  it('只有 Make 没有 Model 时不留下空尾空格', () => {
    expect(composeCamera({ Make: 'Canon' })).toBe('Canon');
  });
});

describe('runCli：CLI 决策核心（不写盘，只定退出码与提示）', () => {
  /** @type {string[]} */
  let out;
  /** @type {string[]} */
  let err;
  const io = () => ({
    log: (line) => out.push(line),
    logError: (line) => err.push(line),
  });

  /** @type {any} */
  function fakeImport(result) {
    return async (opts) => {
      calls.push(opts);
      return result;
    };
  }

  /** @type {any[]} */
  let calls = [];

  beforeEach(() => {
    out = [];
    err = [];
    calls = [];
  });

  it('--help 打印用法并返回 0，不碰导入', async () => {
    const code = await runCli(['--help'], { ...io(), runImport: fakeImport({ manifest: { failedCount: 0 } }) });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('用法：npm run import');
    expect(calls).toEqual([]);
  });

  it('参数错返回 1 并把错误写进 stderr，不碰导入', async () => {
    expect(await runCli(['--nope'], io())).toBe(1);
    expect(err.join('\n')).toContain('未识别的参数');
    expect(await runCli(['--series', 'a/../b'], io())).toBe(1);
    expect(await runCli(['--series', 'a', '--post', 'b'], io())).toBe(1);
    expect(calls).toEqual([]);
  });

  it('不带目标参数（非交互终端也）→ 默认进池，不再发问', async () => {
    const code = await runCli([], { ...io(), stdinIsTty: false, runImport: fakeImport({ manifest: { failedCount: 0 } }) });
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ collection: 'pool' });
    expect(err).toEqual([]);
  });

  it('--ask 在非交互终端 → 1 并教怎么写', async () => {
    const code = await runCli(['--ask'], { ...io(), stdinIsTty: false });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('不是可交互的终端');
    expect(err.join('\n')).toContain('--series');
  });

  it('交互模式（--ask）：ask 的回答决定目标类型与标识，并把 only/title/date 透传给导入', async () => {
    const code = await runCli(['--ask', '--title', '日常帧', '--date', '2026-09-24', '--only', 'a.jpg'], {
      ...io(),
      stdinIsTty: true,
      ask: async () => ({ collection: 'posts', identifier: '2026-09-24-walk' }),
      runImport: fakeImport({ manifest: { failedCount: 0 } }),
    });
    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        collection: 'posts',
        identifier: '2026-09-24-walk',
        only: ['a.jpg'],
        title: '日常帧',
        date: '2026-09-24',
      },
    ]);
  });

  it('交互回答被拒（标识为空）→ 1 且不导入', async () => {
    const code = await runCli(['--ask'], {
      ...io(),
      stdinIsTty: true,
      ask: async () => interpretPromptAnswers('1', '  '),
      runImport: fakeImport({ manifest: { failedCount: 0 } }),
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('不能为空');
    expect(calls).toEqual([]);
  });

  it('清单里有处理失败的张数 → 退出码 1（但报告已给完原因）', async () => {
    const code = await runCli(['--series', 'x'], {
      ...io(),
      runImport: fakeImport({ manifest: { failedCount: 2 } }),
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('有 2 张没导入成功');
  });

  it('导入本身抛错（例如没有 raw/）→ 退出码 1 并带原话', async () => {
    const code = await runCli(['--series', 'x'], {
      ...io(),
      runImport: async () => {
        throw new Error('找不到原图目录：raw');
      },
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('找不到原图目录');
  });

  it('交互答案解释：1/空回车 = 系列，2 = 随笔', () => {
    expect(interpretPromptAnswers('', 'daily')).toEqual({ collection: 'series', identifier: 'daily' });
    expect(interpretPromptAnswers('2', '2026-09-24-x')).toEqual({
      collection: 'posts',
      identifier: '2026-09-24-x',
    });
  });
});

describe('runCli 缺省出口（不注入 io 时落到 console，仍然只是打印）', () => {
  it('--help 用 console.log 打印用法并返回 0', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      seen.push(String(line));
    });
    try {
      expect(await runCli(['--help'])).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(seen.join('\n')).toContain('用法：npm run import');
    // 没注入 runImport 也没被调用：参数里没目标 → 非交互提示（stdinIsTty 在 CI 里为 false）
    expect(await runCli(['--only', 'x'])).toBe(1);
  });
});

describe('promptTarget：真跑一遍 readline 问答（任务 9 的交互模式）', () => {
  /** 一对内存 stdio：output 收集提示语，测试按提示节奏喂答案。 */
  function makeStreams() {
    const prompts = [];
    const input = new PassThrough();
    const output = new Writable({
      write(chunk, _enc, cb) {
        prompts.push(chunk.toString());
        cb();
      },
    });
    const asked = () => prompts.join('');
    /** 等到某句提示出现再把答案喂进去（避免 readline 抢跑丢行）。 */
    async function answer(promptText, reply) {
      for (let i = 0; i < 400; i += 1) {
        if (asked().includes(promptText)) {
          input.write(`${reply}\n`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`没等到提示：${promptText}`);
    }
    return { input, output, asked, answer };
  }

  it('答 2 + 随笔标识 → posts 目标，两句提示语都问到了', async () => {
    const s = makeStreams();
    const promise = promptTarget({ input: s.input, output: s.output, log: () => {} });
    await s.answer(PROMPT_KIND, '2');
    await s.answer(PROMPT_POST_ID, '2026-09-24-walk');
    await expect(promise).resolves.toEqual({ collection: 'posts', identifier: '2026-09-24-walk' });
    expect(s.asked()).toContain('导入到哪里？');
    expect(s.asked()).toContain('随笔标识');
  });

  it('直接回车（默认系列）+ 空标识两次后给有效值 → 系列目标，且提示「不能为空」', async () => {
    const s = makeStreams();
    const notes = [];
    const promise = promptTarget({ input: s.input, output: s.output, log: (line) => notes.push(line) });
    await s.answer(PROMPT_KIND, '');
    await s.answer(PROMPT_SERIES_ID, '');
    await s.answer(PROMPT_SERIES_ID, 'daily-frames');
    await expect(promise).resolves.toEqual({ collection: 'series', identifier: 'daily-frames' });
    expect(notes.join('\n')).toContain('标识不能为空');
  });

  it('标识连着三次给空 → 校验报错抛出（不静默导入到空目录）', async () => {
    const s = makeStreams();
    const promise = promptTarget({ input: s.input, output: s.output, log: () => {} });
    await s.answer(PROMPT_KIND, '1');
    await s.answer(PROMPT_SERIES_ID, '');
    await s.answer(PROMPT_SERIES_ID, '');
    await s.answer(PROMPT_SERIES_ID, '');
    await expect(promise).rejects.toThrow(/不能为空/);
  });

  it('runCli 走 --ask 交互路径时把问答结果与参数一起交给导入', async () => {
    const s = makeStreams();
    /** @type {any[]} */
    const calls = [];
    const err = [];
    const codePromise = runCli(['--ask', '--title', '走', '--date', '2026-09-24'], {
      log: () => {},
      logError: (line) => err.push(line),
      ask: () => promptTarget({ input: s.input, output: s.output, log: () => {} }),
      runImport: async (opts) => {
        calls.push(opts);
        return { manifest: { failedCount: 0 } };
      },
    });
    await s.answer(PROMPT_KIND, '2');
    await s.answer(PROMPT_POST_ID, '2026-09-24-walk');
    expect(await codePromise).toBe(0);
    expect(calls).toEqual([
      {
        collection: 'posts',
        identifier: '2026-09-24-walk',
        only: [],
        title: '走',
        date: '2026-09-24',
      },
    ]);
  });

  it('pickCollection：2 开头是随笔，1 / 空 / 乱输入都回落系列', () => {
    expect(pickCollection('2')).toBe('posts');
    expect(pickCollection(' 2 ')).toBe('posts');
    expect(pickCollection('20')).toBe('posts');
    expect(pickCollection('1')).toBe('series');
    expect(pickCollection('')).toBe('series');
    expect(pickCollection(undefined)).toBe('series');
  });
});

// ============================================================================
// 池化迁移的纯函数层（B1 / B2a~B2d / B3）
// 真实文件搬运见 import-photos-pipeline.test.ts 的「池化迁移」块。
// ============================================================================

/** 一条 PhotoEntry 夹具（宽高四项 + exif 七键）。 */
function photoFixture(base, overrides = {}) {
  return {
    file: `photos/${base}.webp`,
    thumb: `photos/${base}.thumb.webp`,
    width: 2560,
    height: 1707,
    thumbWidth: 800,
    thumbHeight: 533,
    exif: { camera: 'Cam', lens: null, focalLength: null, aperture: 2, shutter: '1/125', iso: 100, dateTaken: '2026-01-01' },
    ...overrides,
  };
}

describe('迁移步骤解析（--migrate）', () => {
  it('all / 空 / 显式步骤，输出恒按 move → merge → backfill → cover 归一', () => {
    expect(parseMigrateSteps('all')).toEqual(['move', 'merge', 'backfill', 'cover']);
    expect(parseMigrateSteps('')).toEqual(['move', 'merge', 'backfill', 'cover']);
    expect(parseMigrateSteps(undefined)).toEqual(['move', 'merge', 'backfill', 'cover']);
    expect(parseMigrateSteps('cover,merge')).toEqual(['merge', 'cover']);
    expect(parseMigrateSteps(' MERGE ')).toEqual(['merge']);
    expect(parseMigrateSteps('merge,merge')).toEqual(['merge']);
  });

  it('未知步骤报错并列出可选值（不静默跑半套）', () => {
    expect(() => parseMigrateSteps('mvoe')).toThrow(/未知的迁移步骤/);
    expect(() => parseMigrateSteps('mvoe')).toThrow(/move \/ merge \/ backfill \/ cover/);
  });
});

describe('照片 ID 与记录指纹（B2b 去重的前置校验）', () => {
  it('照片 ID = 完整文件名含扩展名；缩略图不算照片 ID', () => {
    expect(photoIdFromPath('photos/night-01.webp')).toBe('night-01.webp');
    expect(photoIdFromPath('P1230888.webp')).toBe('P1230888.webp');
    expect(photoIdFromPath('series/x/photos/a.webp?v=2')).toBe('a.webp');
    expect(photoIdFromPath('')).toBe('');
    expect(displayPhotoIdOf('photos/night-01.webp')).toBe('night-01.webp');
    expect(displayPhotoIdOf('photos/night-01.thumb.webp')).toBe('');
  });

  it('指纹覆盖 file/thumb/宽高四项/exif：任一项不同即不同', () => {
    const base = photoFixture('a');
    expect(photoSignature(base)).toBe(photoSignature(photoFixture('a')));
    expect(photoSignature(base)).not.toBe(photoSignature(photoFixture('a', { width: 1000 })));
    expect(photoSignature(base)).not.toBe(photoSignature(photoFixture('a', { thumbHeight: 1 })));
    expect(
      photoSignature(base),
    ).not.toBe(photoSignature(photoFixture('a', { exif: { ...base.exif, iso: 400 } })));
    expect(photoSignature(base)).not.toBe(photoSignature(photoFixture('b')));
    // exif 键顺序不影响指纹（对象键序不该被当成元数据差异）
    expect(photoSignature(base)).toBe(
      photoSignature({ ...base, exif: { dateTaken: '2026-01-01', iso: 100, shutter: '1/125', aperture: 2, focalLength: null, lens: null, camera: 'Cam' } }),
    );
  });
});

describe('旧结构发现（discoverLegacyEntries / discoverEntryMarkdowns）', () => {
  const files = [
    'series/city-lights/index.md',
    'series/city-lights/photos.meta.json',
    'series/city-lights/photos/night-01.webp',
    'series/wip-empty/index.md',
    'posts/2026-07-02-alley-light.md',
    'posts/2026-09-21-morning-fog.md',
    'posts/2026-09-21-morning-fog/photos.meta.json',
    'pool/photos.meta.json',
    'pool/photos/x.webp',
  ];

  it('只认 <series|posts>/<标识>/photos.meta.json；池自己的 sidecar 不算旧条目', () => {
    expect(discoverLegacyEntries(files).map((e) => e.entryDir)).toEqual([
      'series/city-lights',
      'posts/2026-09-21-morning-fog',
    ]);
    const [series] = discoverLegacyEntries(files);
    expect(series).toMatchObject({
      collection: 'series',
      id: 'city-lights',
      sidecarPath: 'series/city-lights/photos.meta.json',
      markdownPath: 'series/city-lights/index.md',
      photosDir: 'series/city-lights/photos',
    });
  });

  it('7 个条目的 .md 都能从文件清单认出来（含没照片的两个）', () => {
    const md = discoverEntryMarkdowns(files);
    expect(md.map((m) => `${m.collection}/${m.id}`)).toEqual([
      'series/city-lights',
      'series/wip-empty',
      'posts/2026-07-02-alley-light',
      'posts/2026-09-21-morning-fog',
    ]);
    expect(md.find((m) => m.id === '2026-07-02-alley-light')?.markdownPath).toBe('posts/2026-07-02-alley-light.md');
  });
});

describe('搬运计划（B2a planPoolMoves）', () => {
  const sources = [
    { entryDir: 'series/a', entries: [photoFixture('shared'), photoFixture('a-only')] },
    { entryDir: 'posts/b', entries: [photoFixture('shared'), photoFixture('b-only')] },
  ];
  const files = [
    'series/a/photos/shared.webp',
    'series/a/photos/shared.thumb.webp',
    'series/a/photos/a-only.webp',
    'series/a/photos/a-only.thumb.webp',
    'series/a/photos/stray.webp',
    'posts/b/photos/shared.webp',
    'posts/b/photos/shared.thumb.webp',
    'posts/b/photos/b-only.webp',
    'posts/b/photos/b-only.thumb.webp',
  ];

  it('每个 file / thumb 一条搬运记录，目标名 = 池内同名；顺序 = 传入 sidecar 顺序', () => {
    const plan = planPoolMoves({ sources, files });
    expect(plan.moves.map((m) => `${m.from} → ${m.to}`)).toEqual([
      'series/a/photos/shared.webp → pool/photos/shared.webp',
      'series/a/photos/shared.thumb.webp → pool/photos/shared.thumb.webp',
      'series/a/photos/a-only.webp → pool/photos/a-only.webp',
      'series/a/photos/a-only.thumb.webp → pool/photos/a-only.thumb.webp',
      'posts/b/photos/b-only.webp → pool/photos/b-only.webp',
      'posts/b/photos/b-only.thumb.webp → pool/photos/b-only.thumb.webp',
    ]);
  });

  it('同名且指纹一致 → 进 duplicates（去重），不算冲突', () => {
    const plan = planPoolMoves({ sources, files });
    expect(plan.conflicts).toEqual([]);
    expect(plan.duplicates.map((d) => d.from)).toEqual([
      'posts/b/photos/shared.webp',
      'posts/b/photos/shared.thumb.webp',
    ]);
    expect(plan.duplicates.every((d) => d.keptFrom.startsWith('series/a/'))).toBe(true);
  });

  it('同名但指纹不一致 → 进 conflicts（调用方必须中止，不许静默丢数据）', () => {
    const conflicted = [
      { entryDir: 'series/a', entries: [photoFixture('shared')] },
      { entryDir: 'posts/b', entries: [photoFixture('shared', { height: 999 })] },
    ];
    const plan = planPoolMoves({ sources: conflicted, files: [] });
    // 展示图与缩略图各一条冲突（同一张照片的两个产物都要拦）
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts.map((c) => c.basename).sort()).toEqual(['shared.thumb.webp', 'shared.webp']);
    expect(plan.conflicts[0].reason).toContain('不一致');
  });

  it('photos/ 里没被 sidecar 认领的产物进 unregistered（只报告，不搬）', () => {
    const plan = planPoolMoves({ sources, files });
    expect(plan.unregistered).toEqual(['series/a/photos/stray.webp']);
    expect(plan.moves.some((m) => m.from.includes('stray'))).toBe(false);
  });
});

describe('sidecar 合并（B2b mergeLegacySidecars）', () => {
  it('按文件名去重、保持源顺序与条目内顺序，重复项归到 deduped', () => {
    const merged = mergeLegacySidecars([
      { entryDir: 'series/a', entries: [photoFixture('shared'), photoFixture('a-only')] },
      { entryDir: 'posts/b', entries: [photoFixture('shared'), photoFixture('b-only')] },
    ]);
    expect(merged.entries.map((e) => e.file)).toEqual([
      'photos/shared.webp',
      'photos/a-only.webp',
      'photos/b-only.webp',
    ]);
    expect(merged.deduped).toEqual([{ basename: 'shared.webp', sources: ['series/a', 'posts/b'] }]);
    expect(merged.conflicts).toEqual([]);
  });

  it('同名不同指纹 → 冲突（不合并、不丢）', () => {
    const merged = mergeLegacySidecars([
      { entryDir: 'series/a', entries: [photoFixture('shared')] },
      { entryDir: 'posts/b', entries: [photoFixture('shared', { width: 1 })] },
    ]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.entries).toHaveLength(1);
  });

  it('空输入不炸', () => {
    expect(mergeLegacySidecars(undefined)).toEqual({ entries: [], deduped: [], conflicts: [] });
  });

  it('去重例按照片名聚合：展示图与缩略图算同一例', () => {
    const groups = groupDuplicateBasenames([
      { basename: 'shared.webp', from: 'posts/b/photos/shared.webp', keptFrom: 'series/a/photos/shared.webp' },
      { basename: 'shared.thumb.webp', from: 'posts/b/photos/shared.thumb.webp', keptFrom: 'series/a/photos/shared.thumb.webp' },
    ]);
    expect(groups).toEqual([{ basename: 'shared.webp', sources: ['series/a', 'posts/b'] }]);
  });
});

describe('frontmatter 回填（B2c applyFrontmatterBackfill）', () => {
  const CRLF_SOURCE = [
    '---',
    'title: 城市之光',
    'date: 2026-09-20',
    'cover: photos/night-02.webp',
    'tags:',
    '  - 城市',
    'order: 3',
    'draft: false',
    '---',
    '',
    '正文第一段。',
    '',
  ].join('\r\n');

  it('替换 cover、追加 photos 块序列，其它字段与行尾原样保留', () => {
    const out = applyFrontmatterBackfill(CRLF_SOURCE, { photos: ['night-01.webp', 'night-02.webp'], cover: 'night-02.webp' });
    expect(out.ok).toBe(true);
    expect(out.eol).toBe('\r\n');
    expect(splitFrontmatter(CRLF_SOURCE)?.eol).toBe('\r\n');
    expect(splitFrontmatter('没有 frontmatter')).toBeNull();
    expect(out.changed).toBe(true);
    const lines = out.text.split('\r\n');
    expect(lines.slice(0, 4)).toEqual(['---', 'title: 城市之光', 'date: 2026-09-20', 'cover: night-02.webp']);
    expect(out.text).toContain('photos:\r\n  - night-01.webp\r\n  - night-02.webp');
    // 原有 tags 块没被动过
    expect(out.text).toContain('tags:\r\n  - 城市\r\norder: 3');
    expect(out.text.endsWith('正文第一段。\r\n')).toBe(true);
    expect(out.text.split('\r\n').filter((l) => l === '---')).toHaveLength(2);
  });

  it('反复回填结果不变（幂等），photos 列表不会重复堆叠', () => {
    const first = applyFrontmatterBackfill(CRLF_SOURCE, { photos: ['a.webp'], cover: 'a.webp' });
    const second = applyFrontmatterBackfill(first.text, { photos: ['a.webp'], cover: 'a.webp' });
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
    expect(first.text.split('\r\n').filter((l) => /^  - a\.webp$/.test(l))).toHaveLength(1);
  });

  it('空 photos 写 `photos: []`，空 cover 写 `cover: \'\'`（A5）', () => {
    const out = applyFrontmatterBackfill(CRLF_SOURCE, { photos: [], cover: '' });
    expect(out.text).toContain("cover: ''");
    expect(out.text).toContain('photos: []');
    expect(frontmatterValueOf(out.text, 'cover')).toBe('');
    expect(frontmatterPhotosOf(out.text)).toEqual([]);
  });

  it('LF 文件仍是 LF（不被洗成 CRLF）；没有 frontmatter 时原样返回并标记 ok:false', () => {
    const lf = ['---', 'title: B', 'cover: photos/x.webp', '---', '', '正文', ''].join('\n');
    const out = applyFrontmatterBackfill(lf, { photos: ['x.webp'], cover: 'x.webp' });
    expect(out.text.includes('\r')).toBe(false);
    expect(out.eol).toBe('\n');

    const plain = '没有 frontmatter 的正文\n';
    const untouched = applyFrontmatterBackfill(plain, { photos: ['x.webp'], cover: 'x' });
    expect(untouched.changed).toBe(false);
    expect(untouched.ok).toBe(false);
    expect(untouched.text).toBe(plain);
  });

  it('读回：photos 块序列与行内数组两种写法都认；缺键返回 null', () => {
    expect(frontmatterPhotosOf(applyFrontmatterBackfill(CRLF_SOURCE, { photos: ['a.webp', 'b.webp'], cover: '' }).text)).toEqual([
      'a.webp',
      'b.webp',
    ]);
    expect(frontmatterPhotosOf('---\nphotos: [a.webp, b.webp]\n---\n')).toEqual(['a.webp', 'b.webp']);
    expect(frontmatterPhotosOf('---\nphotos: []\n---\n')).toEqual([]);
    expect(frontmatterPhotosOf('---\ntitle: x\n---\n')).toBeNull();
    expect(frontmatterValueOf('---\ncover: photos/x.webp\n---\n', 'cover')).toBe('photos/x.webp');
    expect(frontmatterValueOf('---\ntitle: x\n---\n', 'cover')).toBeNull();
  });
});

describe('回填取数（B2c/B2d planBackfill）', () => {
  const md = '---\ntitle: x\ncover: photos/tbd.webp\ntags: []\ndraft: false\n---\n\n正文\n';

  it('photos 按原 sidecar 顺序取展示图 ID；cover 从相对路径换算成 ID（池里存在才算数）', () => {
    const plan = planBackfill({
      markdown: md.replace('photos/tbd.webp', 'photos/night-02.webp'),
      sidecarEntries: [photoFixture('night-02'), photoFixture('night-01')],
      poolIds: ['night-02.webp', 'night-01.webp'],
    });
    expect(plan.photos).toEqual(['night-02.webp', 'night-01.webp']);
    expect(plan.cover).toBe('night-02.webp');
    expect(plan.coverResolved).toBe(true);
  });

  it('cover 指向不存在的占位串 → 空串（K1/A5），并在 photos 非空时交给前台退回 photos[0]', () => {
    const plan = planBackfill({ markdown: md, sidecarEntries: [photoFixture('a')], poolIds: ['a.webp'] });
    expect(plan.previousCover).toBe('photos/tbd.webp');
    expect(plan.cover).toBe('');
    expect(plan.photos).toEqual(['a.webp']);
  });

  it('没有 sidecar 的条目：沿用 frontmatter 现有 photos（没有则空列表），cover 照旧判存在性', () => {
    const withPhotos = '---\ncover: photos/tbd.webp\nphotos: [old.webp]\n---\n';
    const keep = planBackfill({ markdown: withPhotos, sidecarEntries: [], poolIds: [] });
    expect(keep.photos).toEqual(['old.webp']);
    expect(keep.cover).toBe('');

    const none = planBackfill({ markdown: md, sidecarEntries: [], poolIds: ['tbd.webp'] });
    expect(none.photos).toEqual([]);
    expect(none.cover).toBe('tbd.webp');
  });

  it('sidecar 里的缩略图混进来也不会变成照片 ID', () => {
    const plan = planBackfill({
      markdown: md,
      sidecarEntries: [photoFixture('a'), { ...photoFixture('a'), file: 'photos/a.thumb.webp' }],
      poolIds: ['a.webp'],
    });
    expect(plan.photos).toEqual(['a.webp']);
  });
});

describe('迁移报告与池口插图引用行（B3 / D2a）', () => {
  it('池口引用行用 photo: 协议、只取展示图、顺序 = 传入顺序', () => {
    expect(
      buildPoolIllustrationRefLines([
        { file: 'photos/night-02.webp' },
        { file: 'photos/night-02.thumb.webp' },
        { file: 'photos/P1230888.webp' },
      ]),
    ).toEqual(['![说明](photo:night-02.webp)', '![说明](photo:P1230888.webp)']);
    expect(buildPoolIllustrationRefLines([])).toEqual([]);
  });

  it('报告含：搬了几张 / 跳了几张 / 去重几例 + 各条目 photos + 引用行 + 待办', () => {
    const report = buildMigrationReport({
      steps: ['move', 'merge', 'backfill', 'cover'],
      moved: [
        { from: 'series/a/photos/a.webp', to: 'pool/photos/a.webp' },
        { from: 'series/a/photos/a.thumb.webp', to: 'pool/photos/a.thumb.webp' },
      ],
      skipped: ['series/b/photos/b.webp'],
      dedupedGroups: [{ basename: 'shared.webp', sources: ['series/a', 'posts/b'] }],
      dedupedFiles: 2,
      removedSidecars: ['series/a/photos.meta.json'],
      mergedCount: 3,
      entries: [
        { label: 'series/a', photos: ['a.webp', 'shared.webp'], cover: 'a.webp' },
        { label: 'series/empty', photos: [], cover: '' },
      ],
      todos: ['series/empty：cover 空、photos 空'],
    });
    const text = report.lines.join('\n');
    expect(text).toContain('移动 2 个 webp、跳过 1 个');
    expect(text).toContain('按文件名去重 1 例、共少 2 个文件');
    expect(text).toContain('shared.webp（2 份）');
    expect(text).toContain('全局 sidecar：3 条 PhotoEntry');
    expect(text).toContain('series/a：2 张');
    expect(text).toContain('cover = （空串，且 photos 也为空 → 封面区整块不渲染）');
    expect(text).toContain('![说明](photo:a.webp)');
    expect(text).toContain('![说明](photo:shared.webp)');
    expect(text).toContain('待办（人工决策，脚本不替你做）');
    expect(report.movedCount).toBe(2);
    expect(report.dedupedCount).toBe(1);
  });
});

describe('runCli 池与迁移分支（不写盘，全部注入）', () => {
  it('不带目标参数 → 默认进池（B1），identifier 交给 resolveTarget 兜底', async () => {
    /** @type {any[]} */
    const calls = [];
    const code = await runCli(['--only', 'P1'], {
      log: () => {},
      logError: () => {},
      runImport: async (opts) => {
        calls.push(opts);
        return { manifest: { failedCount: 0 } };
      },
    });
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ collection: 'pool', identifier: '', only: ['P1'] });
  });

  it('--pool 与无参数等价；--series 仍走条目', async () => {
    /** @type {any[]} */
    const calls = [];
    const io = {
      log: () => {},
      logError: () => {},
      runImport: async (opts) => {
        calls.push(opts);
        return { manifest: { failedCount: 0 } };
      },
    };
    await runCli(['--pool'], io);
    await runCli(['--series', 'daily-frames'], io);
    expect(calls.map((c) => [c.collection, c.identifier])).toEqual([
      ['pool', ''],
      ['series', 'daily-frames'],
    ]);
  });

  it('--migrate 走迁移而不是导入，失败退 1', async () => {
    /** @type {any[]} */
    const migrations = [];
    const errs = [];
    const code = await runCli(['--migrate=move,merge'], {
      log: () => {},
      logError: (line) => errs.push(line),
      runImport: async () => {
        throw new Error('不该走导入');
      },
      runMigration: async (opts) => {
        migrations.push(opts.steps);
        return { moved: [] };
      },
    });
    expect(code).toBe(0);
    expect(migrations).toEqual([['move', 'merge']]);

    const failed = await runCli(['--migrate'], {
      log: () => {},
      logError: (line) => errs.push(line),
      runMigration: async () => {
        throw new Error('sidecar 冲突');
      },
    });
    expect(failed).toBe(1);
    expect(errs.join('\n')).toContain('迁移失败');
    expect(errs.join('\n')).toContain('sidecar 冲突');
  });

  it('--ask 在非交互终端下报错退 1（不是挂住）', async () => {
    const errs = [];
    const code = await runCli(['--ask'], {
      stdinIsTty: false,
      log: () => {},
      logError: (line) => errs.push(line),
      runImport: async () => ({ manifest: { failedCount: 0 } }),
    });
    expect(code).toBe(1);
    expect(errs.join('\n')).toContain('不是可交互的终端');
  });
});
