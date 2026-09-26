import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DISPLAY_LONG_EDGE,
  IMAGE_FORMAT,
  THUMB_LONG_EDGE,
} from '../../astro.config.mjs';
import { postsSchema, seriesSchema } from '../../src/content/schemas';
import {
  contentImageUrl,
  entryResourceDir,
  resolveContentImage,
} from '../../src/utils/contentImages';
import { SIZE_BUDGET, runImport } from '../../scripts/import-photos.mjs';

// ============================================================================
// import-photos 的「真实管线」集成测（§4.3：打真实依赖，不许 mock 到失真）。
// 这里用真实 sharp + 真实 exifr，在 os.tmpdir() 的临时仓库根里跑完整流程：
//   断言产物尺寸 / 格式 / 字节预算、sidecar 形状与宽高回填、EXIF 缺失容错、
//   幂等（二次运行全跳过）、--series 与 --post 两种落位、草稿骨架、原图不动。
// 绝不往 src/content 写东西（那是内容层，由 CLI 真实导入时才有产物）。
// ============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { default: sharp } = await import('sharp');

/** 临时仓库根（含 raw/ thumbs/ src/content），跑完整体删除。 */
let tmpRoot = '';
const tmpRaw = () => path.join(tmpRoot, 'raw');
const tmpThumbs = () => path.join(tmpRoot, 'thumbs');
const contentPath = (...rel) => path.join(tmpRoot, 'src', 'content', ...rel);

/** 三张 fixture：两张真图副本（带 EXIF、不同长宽比）+ 一张无 EXIF 的小 PNG（测容错与不放大）。 */
const FIXTURES = ['sample-a.jpg', 'sample-b.jpg', 'sample-c.png'];

async function makePng(absPath) {
  const canvas = Buffer.alloc(1200 * 800 * 3);
  for (let i = 0; i < canvas.length; i += 3) {
    canvas[i] = (i / 3) % 256;
    canvas[i + 1] = 40;
    canvas[i + 2] = (i / 900) % 256;
  }
  await sharp(canvas, { raw: { width: 1200, height: 800, channels: 3 } }).png().toFile(absPath);
}

function snapshotRawDir(dir) {
  const names = readdirSorted(dir);
  return names.map((name) => {
    const st = statSync(path.join(dir, name));
    return { name, size: st.size, mtimeMs: st.mtimeMs };
  });
}

function readdirSorted(dir) {
  return readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
}

/** 读 sidecar（JSON 数组）。 */
function readSidecarFile(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

/** 生成物 frontmatter 的极简解析：只覆盖脚本产出的 `key: 标量` / `key: [a, b]` 形态。 */
function parseFrontmatter(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  expect(m, '缺少 frontmatter').not.toBeNull();
  /** @type {Record<string, string | string[] | boolean | number>} */
  const data = {};
  for (const line of /** @type {RegExpMatchArray} */ (m)[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):[ ]*(.*)$/.exec(line);
    if (!kv) continue;
    const rawValue = kv[2].trim();
    if (rawValue.startsWith('[')) {
      data[kv[1]] = rawValue
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    } else if (rawValue === 'true' || rawValue === 'false') {
      data[kv[1]] = rawValue === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      data[kv[1]] = Number(rawValue);
    } else {
      data[kv[1]] = rawValue.replace(/^"(.*)"$/, '$1');
    }
  }
  return data;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'grphy-import-'));
  mkdirSync(tmpRaw(), { recursive: true });
  mkdirSync(tmpThumbs(), { recursive: true });
  mkdirSync(contentPath('series'), { recursive: true });
  mkdirSync(contentPath('posts'), { recursive: true });
  // 真图取 raw/ 里的两张（只读副本；跑完再断言原目录一字未动）
  copyFileSync(path.join(ROOT, 'raw', 'P1230857.jpg'), path.join(tmpRaw(), 'sample-a.jpg'));
  copyFileSync(path.join(ROOT, 'raw', 'P1230861.jpg'), path.join(tmpRaw(), 'sample-b.jpg'));
  await makePng(path.join(tmpRaw(), 'sample-c.png'));
  // 混进来的 HEIC：应被忽略而不是报错
  writeFileSync(path.join(tmpRaw(), 'skip-me.heic'), 'not a real heic');
}, 300_000);

afterAll(() => {
  // Windows 上 sharp 的文件句柄可能尚未释放，rmSync 会瞬时 EPERM；交给 Node 重试。
  try {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  } catch (err) {
    console.warn(`临时目录清理失败（不影响断言，可手动删）：${tmpRoot} — ${String(err)}`);
  }
});

describe('系列模式端到端：真实 sharp + exifr 管线（任务 3/4/5/6/7）', () => {
  /** @type {Awaited<ReturnType<typeof runImport>>} */
  let result;
  const entryRel = path.join('series', 'tmp-frames');

  beforeAll(async () => {
    result = await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'series',
      identifier: 'tmp-frames',
      date: '2026-09-24',
      title: '临时试验',
      log: () => {},
    });
  }, 300_000);

  it('三张图全部入库，清单报「新增 3 张」，HEIC 被显式忽略', () => {
    expect(result.manifest.addedCount).toBe(3);
    expect(result.manifest.skippedCount).toBe(0);
    const text = result.manifest.lines.join('\n');
    expect(text).toContain('结果：新增 3 张、跳过 0 张。');
    expect(text).toContain('已忽略 1 个不支持的文件');
    expect(text).toContain('skip-me.heic');
  });

  it('展示版与缩略图落在同一 photos/ 目录，格式为 WebP（§2 落位约定）', () => {
    for (const base of ['sample-a', 'sample-b', 'sample-c']) {
      expect(readdirSorted(contentPath(entryRel, 'photos'))).toContain(`${base}.${IMAGE_FORMAT}`);
      expect(readdirSorted(contentPath(entryRel, 'photos'))).toContain(`${base}.thumb.${IMAGE_FORMAT}`);
    }
  });

  it('展示图长边 2560、缩略图长边 800、都是 webp；小图不放大（§4 规格）', async () => {
    for (const [base, expectLongEdge] of [
      ['sample-a', DISPLAY_LONG_EDGE],
      ['sample-b', DISPLAY_LONG_EDGE],
      ['sample-c', 1200], // 原图长边 1200 < 2560 → withoutEnlargement 生效
    ]) {
      const meta = await sharp(contentPath(entryRel, 'photos', `${base}.${IMAGE_FORMAT}`)).metadata();
      expect(meta.format, base).toBe('webp');
      expect(Math.max(/** @type {number} */ (meta.width), /** @type {number} */ (meta.height)), base).toBe(
        expectLongEdge,
      );
    }
    for (const base of ['sample-a', 'sample-b']) {
      const meta = await sharp(contentPath(entryRel, 'photos', `${base}.thumb.${IMAGE_FORMAT}`)).metadata();
      expect(meta.format).toBe('webp');
      expect(Math.max(/** @type {number} */ (meta.width), /** @type {number} */ (meta.height))).toBe(THUMB_LONG_EDGE);
    }
    // 缩略图对小图同样不放大：1200×800 → 800×533
    const thumbC = await sharp(contentPath(entryRel, 'photos', `sample-c.thumb.${IMAGE_FORMAT}`)).metadata();
    expect([thumbC.width, thumbC.height]).toEqual([800, 533]);
  });

  it('体积守住 §6 预算：展示图 ≤2MB、缩略图 ≤160KB（对齐 SIZE_BUDGET），且清单报的字节数就是盘上的数', () => {
    for (const [index, base] of ['sample-a', 'sample-b', 'sample-c'].entries()) {
      const displayBytes = statSync(contentPath(entryRel, 'photos', `${base}.${IMAGE_FORMAT}`)).size;
      const thumbBytes = statSync(contentPath(entryRel, 'photos', `${base}.thumb.${IMAGE_FORMAT}`)).size;
      expect(displayBytes, `${base} 展示图`).toBeLessThanOrEqual(SIZE_BUDGET.displayBytes);
      expect(thumbBytes, `${base} 缩略图`).toBeLessThanOrEqual(SIZE_BUDGET.thumbBytes);
      // 清单里的数字来自编码输出的 buffer 长度 —— 必须与写盘结果一致
      expect(result.added[index].basename).toBe(base);
      expect(result.added[index].bytes, `${base} 清单展示图字节`).toBe(displayBytes);
      expect(result.added[index].thumbBytes, `${base} 清单缩略图字节`).toBe(thumbBytes);
    }
  });

  it('缩略图先经 thumbs/ 暂存区再进内容夹（design §4）', () => {
    expect(readdirSorted(tmpThumbs())).toContain(`sample-a.thumb.${IMAGE_FORMAT}`);
  });

  it('sidecar 形状合法：file/thumb/宽高/exif 齐全，宽高与盘上产物一致', async () => {
    const sidecar = readSidecarFile(contentPath(entryRel, 'photos.meta.json'));
    expect(Array.isArray(sidecar)).toBe(true);
    expect(sidecar.map((e) => e.file)).toEqual([
      'photos/sample-a.webp',
      'photos/sample-b.webp',
      'photos/sample-c.webp',
    ]);
    for (const entry of sidecar) {
      expect(Object.keys(entry).sort()).toEqual([
        'exif',
        'file',
        'height',
        'thumb',
        'thumbHeight',
        'thumbWidth',
        'width',
      ]);
      const display = await sharp(contentPath(entryRel, entry.file)).metadata();
      const thumb = await sharp(contentPath(entryRel, entry.thumb)).metadata();
      expect([entry.width, entry.height]).toEqual([display.width, display.height]);
      expect([entry.thumbWidth, entry.thumbHeight]).toEqual([thumb.width, thumb.height]);
      expect(typeof entry.exif).toBe('object');
    }
  });

  it('EXIF 映射到真图字段（机型/镜头/焦距/光圈/快门/ISO/日期）', () => {
    const sidecar = readSidecarFile(contentPath(entryRel, 'photos.meta.json'));
    const exifA = sidecar[0].exif;
    expect(exifA.camera).toBe('Panasonic DMC-GX85');
    expect(exifA.lens).toBe('LUMIX G 14/F2.5');
    expect(exifA.focalLength).toBe(14);
    expect(exifA.aperture).toBe(5);
    expect(exifA.shutter).toMatch(/^1\/\d+$/);
    expect(exifA.iso).toBe(200);
    expect(exifA.dateTaken).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('无 EXIF 的 PNG：exif 七个键都在且全为 null，管线不报错（缺字段容错）', () => {
    const sidecar = readSidecarFile(contentPath(entryRel, 'photos.meta.json'));
    expect(sidecar[2].exif).toEqual({
      camera: null,
      lens: null,
      focalLength: null,
      aperture: null,
      shutter: null,
      iso: null,
      dateTaken: null,
    });
    expect(sidecar[2].width).toBeGreaterThan(0);
  });

  it('条目 index.md 被当场新建，draft:true 且过真实 seriesSchema（任务 10）', () => {
    const md = readFileSync(contentPath(entryRel, 'index.md'), 'utf8');
    const data = parseFrontmatter(md);
    expect(data.draft).toBe(true);
    expect(data.title).toBe('临时试验');
    expect(data.date).toBe('2026-09-24');
    expect(data.cover).toBe('photos/sample-a.webp');
    expect(data.order).toBe(1);
    expect(seriesSchema.safeParse(data).success).toBe(true);
  });

  it('已存在的条目 Markdown 一个字都不改（文字归人/后台）', async () => {
    const keepMd = contentPath('series', 'keep-mine', 'index.md');
    mkdirSync(path.dirname(keepMd), { recursive: true });
    const original = ['---', 'title: 我自己写的', 'date: 2026-01-01', 'cover: photos/x.webp', 'tags: [城市]', 'order: 9', 'draft: false', '---', '', '正文。', ''].join('\n');
    writeFileSync(keepMd, original, 'utf8');
    await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'series',
      identifier: 'keep-mine',
      only: ['sample-b'],
      log: () => {},
    });
    expect(readFileSync(keepMd, 'utf8')).toBe(original);
    const sidecar = readSidecarFile(path.join(path.dirname(keepMd), 'photos.meta.json'));
    expect(sidecar.map((e) => e.file)).toEqual(['photos/sample-b.webp']);
  });
});

describe('幂等：同一批输入二次运行全部跳过（任务 2 / 验收「重复运行幂等」）', () => {
  const entryRel = path.join('series', 'twice-run');

  it('第二次运行：新增 0 张、跳过 3 张，产物与 sidecar 完全未变', async () => {
    const first = await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'series',
      identifier: 'twice-run',
      date: '2026-09-24',
      log: () => {},
    });
    expect(first.manifest.addedCount).toBe(3);

    const sidecarPath = contentPath(entryRel, 'photos.meta.json');
    const sidecarBefore = readFileSync(sidecarPath, 'utf8');
    const photoDir = contentPath(entryRel, 'photos');
    const mtimesBefore = readdirSorted(photoDir).map(
      (n) => statSync(path.join(photoDir, n)).mtimeMs,
    );

    const second = await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'series',
      identifier: 'twice-run',
      date: '2026-09-24',
      log: () => {},
    });
    expect(second.manifest.addedCount).toBe(0);
    expect(second.manifest.skippedCount).toBe(3);
    expect(second.manifest.allSkipped).toBe(true);
    const text = second.manifest.lines.join('\n');
    expect(text).toContain('结果：新增 0 张、跳过 3 张。');
    expect(text).toContain('sample-a.jpg（已导入，产物与原图均未改动）');

    expect(readFileSync(sidecarPath, 'utf8')).toBe(sidecarBefore);
    expect(readdirSorted(photoDir)).toHaveLength(6);
    expect(readdirSorted(photoDir).map((n) => statSync(path.join(photoDir, n)).mtimeMs)).toEqual(
      mtimesBefore,
    );
  }, 300_000);

  it('分批导入按发生顺序累积，不重排照片流（sidecar 顺序 = 灯箱帧序列）', async () => {
    const identifier = 'ordered';
    await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'series',
      identifier,
      date: '2026-09-24',
      only: ['sample-c'],
      log: () => {},
    });
    const second = await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'series',
      identifier,
      date: '2026-09-24',
      only: ['sample-a'],
      log: () => {},
    });
    expect(second.manifest.addedCount).toBe(1);
    expect(second.manifest.skippedCount).toBe(0);
    const sidecar = readSidecarFile(contentPath('series', identifier, 'photos.meta.json'));
    expect(sidecar.map((e) => e.file)).toEqual(['photos/sample-c.webp', 'photos/sample-a.webp']);
  }, 300_000);
});

describe('随笔模式落位（任务 8：--post 与系列同通道）', () => {
  const identifier = '2026-09-23-tmp-walk';

  /** @type {Awaited<ReturnType<typeof runImport>>} */
  let result;

  beforeAll(async () => {
    result = await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'posts',
      identifier,
      only: ['sample-b'],
      log: () => {},
    });
  }, 300_000);

  it('产物写进同名资源夹 posts/<标识>/photos/，sidecar 同夹', () => {
    expect(result.target.entryDir).toBe(`posts/${identifier}`);
    expect(result.target.markdownPath).toBe(`posts/${identifier}.md`);
    expect(readdirSorted(contentPath('posts', identifier, 'photos')).sort()).toEqual([
      `sample-b.thumb.${IMAGE_FORMAT}`,
      `sample-b.${IMAGE_FORMAT}`,
    ]);
    expect(existsSync(contentPath('posts', identifier, 'photos.meta.json'))).toBe(true);
  });

  it('<标识>.md 不存在时生成草稿骨架，日期取标识前缀且过真实 postsSchema', () => {
    const md = readFileSync(contentPath('posts', `${identifier}.md`), 'utf8');
    const data = parseFrontmatter(md);
    expect(data.draft).toBe(true);
    expect(data.date).toBe('2026-09-23');
    expect(data.title).toBe('Tmp Walk');
    expect(data.cover).toBe('photos/sample-b.webp');
    expect(postsSchema.safeParse(data).success).toBe(true);
  });

  it('随笔模式不会在 series/ 里留下任何东西（两模式互不串门）', () => {
    expect(readdirSorted(contentPath('series'))).not.toContain(identifier);
    expect(existsSync(contentPath('series', identifier))).toBe(false);
  });

  it('二次跑随笔模式同样幂等', async () => {
    const again = await runImport({
      root: tmpRoot,
      rawDir: tmpRaw(),
      thumbsDir: tmpThumbs(),
      collection: 'posts',
      identifier,
      only: ['sample-b'],
      log: () => {},
    });
    expect(again.manifest.allSkipped).toBe(true);
    expect(again.manifest.addedCount).toBe(0);
  }, 300_000);
});

describe('原图保护：raw/ 只读（任务 11 + §7 硬约束）', () => {
  it('临时 raw/ 与原仓库 raw/ 在一次真实导入后逐文件 name/size/mtime 不变', async () => {
    const tmpBefore = snapshotRawDir(tmpRaw());
    const realRawDir = path.join(ROOT, 'raw');
    const realBefore = snapshotRawDir(realRawDir);

    // 直接拿仓库真图跑一次（写盘仍进临时根，绝不动 src/content）
    const result = await runImport({
      root: path.join(tmpRoot, 'real-raw-root'),
      rawDir: realRawDir,
      thumbsDir: path.join(tmpRoot, 'real-raw-thumbs'),
      collection: 'series',
      identifier: 'from-real-raw',
      date: '2026-09-24',
      only: ['P1230869'],
      log: () => {},
    });
    expect(result.manifest.addedCount).toBe(1);
    expect(result.paths.rawDir).toBe(realRawDir);

    expect(snapshotRawDir(tmpRaw())).toEqual(tmpBefore);
    expect(snapshotRawDir(realRawDir)).toEqual(realBefore);
    // 真图确实产出了展示图（顺带证长边口径）
    const meta = await sharp(
      path.join(tmpRoot, 'real-raw-root', 'src/content/series/from-real-raw/photos/P1230869.webp'),
    ).metadata();
    expect(Math.max(/** @type {number} */ (meta.width), /** @type {number} */ (meta.height))).toBe(
      DISPLAY_LONG_EDGE,
    );
  }, 300_000);

  it('--only 指向不存在的文件时报错而不是静默跳过', async () => {
    await expect(
      runImport({
        root: tmpRoot,
        rawDir: tmpRaw(),
        thumbsDir: tmpThumbs(),
        collection: 'series',
        identifier: 'nope',
        only: ['does-not-exist.jpg'],
        log: () => {},
      }),
    ).rejects.toThrow(/不在 raw\//);
  });

  it('raw/ 目录不存在时给出人话错误', async () => {
    await expect(
      runImport({
        root: tmpRoot,
        rawDir: path.join(tmpRoot, 'missing-raw'),
        collection: 'series',
        identifier: 'nope',
        log: () => {},
      }),
    ).rejects.toThrow(/找不到原图目录/);
  });
});

describe('全仓 sidecar 口径统一（种子内容已回填宽高，灯箱/页面可直接取数）', () => {
  /** 递归收集 src/content 下所有 photos.meta.json。 */
  function findSidecars(dir, acc = []) {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) findSidecarList(abs, acc);
      else if (dirent.name === 'photos.meta.json') acc.push(abs);
    }
    return acc;
  }

  function findSidecarList(dir, acc) {
    findSidecars(dir, acc);
    return acc;
  }

  const sidecarFiles = findSidecars(path.join(ROOT, 'src', 'content'));

  it('至少覆盖两处种子条目（city-lights 与 morning-fog）', () => {
    expect(sidecarFiles.length).toBeGreaterThanOrEqual(2);
    const rel = sidecarFiles.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(rel).toContain('src/content/series/city-lights/photos.meta.json');
    expect(rel).toContain('src/content/posts/2026-09-21-morning-fog/photos.meta.json');
  });

  it.each(sidecarFiles.map((f) => [path.relative(ROOT, f).split(path.sep).join('/')]))(
    '%s 的每条记录都带 file/thumb/四项宽高/exif 七键，且宽高与盘上产物一致',
    async (rel) => {
      const abs = path.join(ROOT, rel);
      const entryDir = path.dirname(abs);
      const sidecar = readSidecarFile(abs);
      expect(Array.isArray(sidecar)).toBe(true);
      for (const entry of sidecar) {
        expect(Object.keys(entry).sort()).toEqual([
          'exif',
          'file',
          'height',
          'thumb',
          'thumbHeight',
          'thumbWidth',
          'width',
        ]);
        expect(Object.keys(entry.exif).sort()).toEqual([
          'aperture',
          'camera',
          'dateTaken',
          'focalLength',
          'iso',
          'lens',
          'shutter',
        ]);
        const display = await sharp(path.join(entryDir, entry.file)).metadata();
        const thumb = await sharp(path.join(entryDir, entry.thumb)).metadata();
        expect([entry.width, entry.height]).toEqual([display.width, display.height]);
        expect([entry.thumbWidth, entry.thumbHeight]).toEqual([thumb.width, thumb.height]);
      }
    },
  );
});

describe('脚本产物能被下游 contentImages 解析成可服务 URL（glob 不漏收）', () => {
  it('真实导入的系列与随笔产物都在构建期映射表里', () => {
    for (const [entryDir, rel] of [
      ['series/daily-frames', 'photos/P1230857.webp'],
      ['series/daily-frames', 'photos/P1230857.thumb.webp'],
      ['posts/2026-08-10-foggy-morning', 'photos/P1230857.webp'],
      ['posts/2026-08-10-foggy-morning', 'photos/P1230857.thumb.webp'],
    ]) {
      expect(resolveContentImage(entryDir, rel), `${entryDir}/${rel}`).toBeTypeOf('string');
      const url = contentImageUrl(entryDir, rel, { base: 'https://cdn.example/' });
      expect(url.startsWith('https://cdn.example/')).toBe(true);
      expect(url).not.toContain('cdn.example//');
    }
  });

  it('每条 sidecar 记录的 file/thumb 都能被 entryResourceDir + resolveContentImage 命中', () => {
    const pairs = [
      ['series', 'city-lights/index.md'],
      ['posts', '2026-09-21-morning-fog.md'],
      ['series', 'daily-frames/index.md'],
      ['posts', '2026-08-10-foggy-morning.md'],
    ];
    for (const [collection, id] of pairs) {
      const dir = entryResourceDir(collection, id);
      const sidecar = readSidecarFile(path.join(ROOT, 'src', 'content', `${dir}`, 'photos.meta.json'));
      for (const entry of sidecar) {
        expect(resolveContentImage(dir, entry.file), `${dir}/${entry.file}`).toBeTypeOf('string');
        expect(resolveContentImage(dir, entry.thumb), `${dir}/${entry.thumb}`).toBeTypeOf('string');
      }
    }
  });
});

describe('CLI 入口（npm run import）：错误路径不写盘（任务 9/12）', () => {
  const script = path.join(ROOT, 'scripts', 'import-photos.mjs');
  const contentRoot = path.join(ROOT, 'src', 'content');
  /** 内容目录快照：用于证明「参数报错 / 帮助 / 交互失败」这些路径一个字都没写。 */
  const snapshotContent = () => [
    ...readdirSorted(path.join(contentRoot, 'series')).map((n) => `series/${n}`),
    ...readdirSorted(path.join(contentRoot, 'posts')).map((n) => `posts/${n}`),
  ];

  function runCli(args, options = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 60_000,
      ...options,
    });
  }

  it('--help 打印用法并以 0 退出，不产生任何写入', () => {
    const before = snapshotContent();
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('用法：npm run import -- --series');
    expect(r.stdout).toContain('原图始终留在 raw/ 原地不动');
    expect(snapshotContent()).toEqual(before);
  });

  it.each([
    [['--bogus'], /未识别的参数/],
    [['--series'], /缺少取值/],
    [['--series', '../escape'], /不能包含路径分隔符/],
    [['--series', 'a', '--post', 'b'], /不能同时使用/],
  ])('CLI 参数错误 %j 以 1 退出且不写盘', (args, pattern) => {
    const before = snapshotContent();
    const r = runCli(args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(pattern);
    expect(snapshotContent()).toEqual(before);
  });

  it('无参数且非交互终端（stdin 不是 TTY）→ 以 1 退出并教怎么写，不写盘', () => {
    const before = snapshotContent();
    const r = runCli([], { input: '' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('不是可交互的终端');
    expect(r.stderr).toContain('--series');
    expect(snapshotContent()).toEqual(before);
  });
});

describe('坏图容错：单张解码失败不拖垮整批（清单可见、sidecar 不脏写）', () => {
  const badRaw = () => path.join(tmpRoot, 'raw-bad');
  const badRoot = () => path.join(tmpRoot, 'bad-root');
  const entryDir = () => path.join(badRoot(), 'src', 'content', 'series', 'bad-batch');

  beforeAll(async () => {
    mkdirSync(badRaw(), { recursive: true });
    copyFileSync(path.join(tmpRaw(), 'sample-a.jpg'), path.join(badRaw(), 'good-1.jpg'));
    // 扩展名叫 .jpg、内容却是垃圾：sharp 解码必然失败
    writeFileSync(path.join(badRaw(), 'broken-2.jpg'), 'this is definitely not a jpeg');
  });

  it('好图照常入库、坏图记进清单失败段，sidecar 里没有坏图那条', async () => {
    const result = await runImport({
      root: badRoot(),
      rawDir: badRaw(),
      thumbsDir: path.join(tmpRoot, 'thumbs-bad'),
      collection: 'series',
      identifier: 'bad-batch',
      date: '2026-09-24',
      log: () => {},
    });
    expect(result.manifest.addedCount).toBe(1);
    expect(result.manifest.failedCount).toBe(1);
    expect(result.failed[0].file).toBe('broken-2.jpg');
    expect(result.manifest.lines.join('\n')).toContain('处理失败 1 张');

    const sidecar = readSidecarFile(path.join(entryDir(), 'photos.meta.json'));
    expect(sidecar.map((e) => e.file)).toEqual(['photos/good-1.webp']);
    expect(existsSync(path.join(entryDir(), 'photos', 'broken-2.webp'))).toBe(false);
    // 骨架仍以那张好图当封面
    expect(parseFrontmatter(readFileSync(path.join(entryDir(), 'index.md'), 'utf8')).cover).toBe(
      'photos/good-1.webp',
    );
  }, 300_000);

  it('重跑时坏图仍会被重试（它没进 sidecar，幂等判定当它是新图）', async () => {
    const again = await runImport({
      root: badRoot(),
      rawDir: badRaw(),
      thumbsDir: path.join(tmpRoot, 'thumbs-bad'),
      collection: 'series',
      identifier: 'bad-batch',
      log: () => {},
    });
    expect(again.manifest.addedCount).toBe(0);
    expect(again.manifest.skippedCount).toBe(1);
    expect(again.manifest.failedCount).toBe(1);
    expect(again.manifest.allSkipped).toBe(false);
  }, 300_000);

  it('整批都坏时报错说清「没照片可当封面」，且不留半成品 sidecar', async () => {
    const allBadRaw = path.join(tmpRoot, 'raw-all-bad');
    mkdirSync(allBadRaw, { recursive: true });
    writeFileSync(path.join(allBadRaw, 'broken-1.jpg'), 'nope');
    await expect(
      runImport({
        root: path.join(tmpRoot, 'all-bad-root'),
        rawDir: allBadRaw,
        collection: 'series',
        identifier: 'all-bad',
        log: () => {},
      }),
    ).rejects.toThrow(/处理失败/);
    expect(existsSync(path.join(tmpRoot, 'all-bad-root', 'src', 'content', 'series', 'all-bad', 'photos.meta.json'))).toBe(
      false,
    );
  }, 300_000);
});

describe('脏 sidecar 自愈：外部误写的内容被过滤或重建（任务 6 口径）', () => {
  const root = () => path.join(tmpRoot, 'dirty-root');
  const entry = () => path.join(root(), 'src', 'content', 'series', 'dirty');

  beforeAll(() => {
    mkdirSync(entry(), { recursive: true });
    writeFileSync(
      path.join(entry(), 'photos.meta.json'),
      '[null, 42, {"file":"photos/ghost.webp"}, "nope"]',
      'utf8',
    );
    writeFileSync(
      path.join(entry(), 'index.md'),
      ['---', 'title: 已有条目', 'date: 2026-01-01', 'cover: photos/x.webp', 'tags: []', 'order: 5', 'draft: false', '---', '', '别抖。', ''].join('\n'),
      'utf8',
    );
  });

  it('非 PhotoEntry 形状的条目被丢掉，产物缺失的 ghost 记录被重导替换', async () => {
    const result = await runImport({
      root: root(),
      rawDir: tmpRaw(),
      thumbsDir: path.join(tmpRoot, 'thumbs-dirty'),
      collection: 'series',
      identifier: 'dirty',
      only: ['sample-a'],
      log: () => {},
    });
    expect(result.manifest.addedCount).toBe(1);
    const sidecar = readSidecarFile(path.join(entry(), 'photos.meta.json'));
    expect(sidecar.map((e) => e.file)).toEqual(['photos/sample-a.webp']);
    // 已存在的 index.md 没被动过
    expect(readFileSync(path.join(entry(), 'index.md'), 'utf8')).toContain('别抖。');
  }, 300_000);

  it('顶层不是数组的 JSON 也被当作空重来，不炸', async () => {
    writeFileSync(path.join(entry(), 'photos.meta.json'), '{"oops":true}', 'utf8');
    const result = await runImport({
      root: root(),
      rawDir: tmpRaw(),
      thumbsDir: path.join(tmpRoot, 'thumbs-dirty'),
      collection: 'series',
      identifier: 'dirty',
      only: ['sample-a'],
      log: () => {},
    });
    // photos/ 里产物虽在，但记录被按空处理 → 当新图重导一次，sidecar 随之自愈重建
    expect(result.manifest.addedCount).toBe(1);
    expect(result.manifest.skippedCount).toBe(0);
    expect(readSidecarFile(path.join(entry(), 'photos.meta.json')).map((e) => e.file)).toEqual([
      'photos/sample-a.webp',
    ]);
  }, 300_000);
});

describe('raw/ 里的目录与非图片文件被跳过（清单不受影响）', () => {
  it('子目录不算图，txt 也不算图', async () => {
    mkdirSync(path.join(tmpRaw(), 'a-subdir'), { recursive: true });
    writeFileSync(path.join(tmpRaw(), 'notes.txt'), 'hi');
    const result = await runImport({
      root: path.join(tmpRoot, 'skip-dirs-root'),
      rawDir: tmpRaw(),
      thumbsDir: path.join(tmpRoot, 'thumbs-skipdirs'),
      collection: 'series',
      identifier: 'skip-dirs',
      date: '2026-09-24',
      log: () => {},
    });
    expect(result.manifest.addedCount).toBe(3);
    expect(result.manifest.failedCount).toBe(0);
    expect(existsSync(path.join(tmpRaw(), 'a-subdir'))).toBe(true);
  }, 300_000);
});
