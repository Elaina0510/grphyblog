// =============================================================================
// check-image-sources 单测（admin-v2.md C 组：照片池化口径 v0.1.1）
//
// 覆盖 R1~R6 每条规则的「触发」与「不误伤」，外加走盘 / CLI / npm 接线：
//   R1 图片只能位于 src/content/pool/photos/（含 K5：JSON 不算图片）
//   R2 全局 sidecar 存在且是 PhotoEntry 数组、且是全站唯一一份
//   R3 pool/photos/ 里的文件都要被 sidecar 的 file/thumb 登记（含 .thumb.webp）
//   R4 sidecar 登记的 file/thumb 磁盘上必须存在
//   R5 public/ 下不许出现图片
//   R6 frontmatter 的 photos[]/cover 必须是池内已有 ID（cover 空串合法）
//
// 结构：纯函数区（auditImageSources / parseFrontmatterMeta / poolPhotoIdOf）喂内存夹具，
//       I/O 区（runCheck / runCli）真落盘到 node_modules/.tmp 下跑真退出码，
//       最后拿当前仓库根做一次总自检。
// =============================================================================

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ALLOWED_PUBLIC_IMAGES,
  IMAGE_EXTENSIONS,
  POOL_PHOTOS_DIR,
  POOL_SIDECAR_PATH,
  SIDECAR_FILE,
  auditImageSources,
  isEntryMarkdown,
  isImageFile,
  parseArgs,
  parseFrontmatterMeta,
  poolPhotoIdOf,
  runCheck,
  runCli,
  splitFrontmatter,
} from '../../scripts/check-image-sources.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// 夹具目录：node_modules/ 已被 .gitignore 排除，不污染工作树。
const FIXTURE = resolve(ROOT, 'node_modules/.tmp/image-pool-check-fixture');

/** 池内照片路径：展示版 + 缩略图（缩略图是 .thumb.webp 复合后缀）。 */
const poolFiles = (base: string) => [
  `${POOL_PHOTOS_DIR}/${base}.webp`,
  `${POOL_PHOTOS_DIR}/${base}.thumb.webp`,
];

/** 一条合法的 PhotoEntry（形状按 src/types/photoSidecar.ts，只填检查会用到的键）。 */
function photoRecord(base: string, overrides: Record<string, unknown> = {}) {
  return {
    file: `photos/${base}.webp`,
    thumb: `photos/${base}.thumb.webp`,
    width: 2560,
    height: 1707,
    thumbWidth: 800,
    thumbHeight: 533,
    exif: { camera: 'FUJIFILM X-T5' },
    ...overrides,
  };
}

/** 拼一个条目 md（frontmatter 用真实口径：cover 是照片 ID，photos 是块列表）。 */
function entryMd(options: {
  cover?: string;
  photos?: string[];
  eol?: '\n' | '\r\n';
} = {}) {
  const eol = options.eol ?? '\n';
  const cover = options.cover ?? '';
  const photos = options.photos ?? [];
  const lines = [
    '---',
    'title: 测试条目',
    'date: 2026-09-20',
    `cover: ${cover === '' ? "''" : cover}`,
    'tags: []',
  ];
  if (photos.length === 0) lines.push('photos: []');
  else {
    lines.push('photos:');
    for (const id of photos) lines.push(`  - ${id}`);
  }
  lines.push('---', '', '正文一段。', '');
  return lines.join(eol);
}

interface Scenario {
  /** 占位文件（含池内照片与故意放错位置的图），内容无所谓。 */
  images?: string[];
  /** 其他占位文件（html / ts 之类）。 */
  other?: string[];
  /** 条目 md：仓库根相对路径 → 全文。 */
  markdown?: Record<string, string>;
  /** 全局 sidecar 的值；字符串按原文落盘（模拟坏 JSON）。undefined = 不写。 */
  sidecar?: unknown;
  /** 额外 sidecar：键为相对 src/content 的路径。 */
  extraSidecars?: Record<string, unknown>;
}

/** 干净场景：两张照片在池里、被全局 sidecar 登记、两个条目引用都合法。 */
function cleanScenario(): Scenario {
  return {
    images: [...poolFiles('night-01'), ...poolFiles('dawn-01')],
    other: ['public/admin/index.html', 'src/content/schemas.ts'],
    markdown: {
      'src/content/series/alpha/index.md': entryMd({
        cover: 'night-01.webp',
        photos: ['night-01.webp', 'dawn-01.webp'],
      }),
      'src/content/posts/2026-09-21-fog.md': entryMd({
        cover: 'dawn-01.webp',
        photos: ['dawn-01.webp'],
      }),
    },
    sidecar: [photoRecord('night-01'), photoRecord('dawn-01')],
  };
}

/** 纯函数夹具：把场景换成 auditImageSources 的三份入参（不碰磁盘）。 */
function auditInput(scenario: Scenario) {
  const files: string[] = [...(scenario.images ?? []), ...(scenario.other ?? [])];
  const sidecars: Record<string, unknown> = {};
  const isBadJson = typeof scenario.sidecar === 'string';

  if (scenario.sidecar !== undefined) {
    files.push(POOL_SIDECAR_PATH);
    sidecars['pool/photos.meta.json'] = isBadJson
      ? { __parseError: true, message: 'Unexpected token' }
      : scenario.sidecar;
  }
  for (const [rel, value] of Object.entries(scenario.extraSidecars ?? {})) {
    files.push(`src/content/${rel}`);
    sidecars[rel] = typeof value === 'string' ? { __parseError: true } : value;
  }

  const entries = Object.entries(scenario.markdown ?? {}).map(([path, text]) => ({
    path,
    ...parseFrontmatterMeta(text),
  }));

  return { files, sidecars, entries };
}

/** 把场景真落盘（md 与 sidecar 也写，走盘用例靠它）。 */
function writeFixture(scenario: Scenario) {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(join(FIXTURE, 'src/content'), { recursive: true });
  mkdirSync(join(FIXTURE, 'public'), { recursive: true });

  /** @param {string} rel @param {string} text */
  const put = (rel: string, text: string) => {
    const abs = join(FIXTURE, rel);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  };

  for (const rel of scenario.images ?? []) put(rel, 'x');
  for (const rel of scenario.other ?? []) put(rel, 'x');
  for (const [rel, text] of Object.entries(scenario.markdown ?? {})) put(rel, text);

  if (scenario.sidecar !== undefined) {
    put(
      POOL_SIDECAR_PATH,
      typeof scenario.sidecar === 'string'
        ? scenario.sidecar
        : JSON.stringify(scenario.sidecar, null, 2),
    );
  }
  for (const [rel, value] of Object.entries(scenario.extraSidecars ?? {})) {
    put(`src/content/${rel}`, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

/** 跑一次检查并回收日志（runCheck 不写 stdout，方便断言）。 */
async function checkAt(root: string, quiet = false) {
  const lines: string[] = [];
  const code = await runCheck({ root, log: (line: string) => lines.push(line), quietOnPass: quiet });
  return { code, text: lines.join('\n') };
}

// =============================================================================
// 纯函数区
// =============================================================================
describe('check-image-sources · 扩展名与池内落位判定', () => {
  it('图片扩展名覆盖脚本产物与原图格式，非图片不误判（K5：JSON 不算图片）', () => {
    expect(IMAGE_EXTENSIONS).toContain('.webp');
    for (const name of [
      'a.webp',
      'a.thumb.webp',
      'B.JPG',
      'c.jpeg',
      'd.png',
      'e.avif',
      'f.heic',
      'g.svg',
      'h.ico',
      'i.tiff',
    ]) {
      expect(isImageFile(name), `${name} 应算图片`).toBe(true);
    }
    for (const name of [
      'index.md',
      SIDECAR_FILE,
      'src/content/pool/photos.meta.json',
      'schemas.ts',
      '.gitkeep',
      'a.css',
      'a.json',
    ]) {
      expect(isImageFile(name), `${name} 不该算图片`).toBe(false);
    }
  });

  it('池内照片路径能取到照片 ID（含 .thumb.webp），旧布局与其他位置一律返回 null', () => {
    expect(poolPhotoIdOf('src/content/pool/photos/night-01.webp')).toBe('night-01.webp');
    expect(poolPhotoIdOf('src/content/pool/photos/night-01.thumb.webp')).toBe(
      'night-01.thumb.webp',
    );
    // Windows 反斜杠也要吃得下（工具链在 Git Bash / PowerShell 两边跑）
    expect(poolPhotoIdOf('src\\content\\pool\\photos\\a.webp')).toBe('a.webp');

    // 旧布局（池化前）：<集合>/<条目>/photos/
    expect(poolPhotoIdOf('src/content/series/city-lights/photos/night-01.webp')).toBeNull();
    // 条目目录根 / 内容根 / public 下的图都不算池内
    expect(poolPhotoIdOf('src/content/series/city-lights/evil.png')).toBeNull();
    expect(poolPhotoIdOf('src/content/orphan.png')).toBeNull();
    expect(poolPhotoIdOf('public/uploads/thing.webp')).toBeNull();
    // sidecar 本身不是「照片目录下的文件」
    expect(poolPhotoIdOf('src/content/pool/photos.meta.json')).toBeNull();
  });

  it('只把条目 md 当引用来源：series/<标识>/index.md 与 posts/<日期-标题>.md', () => {
    expect(isEntryMarkdown('src/content/series/alpha/index.md')).toBe(true);
    expect(isEntryMarkdown('src/content/posts/2026-09-21-fog.md')).toBe(true);
    expect(isEntryMarkdown('src/content/posts/2026-09-21-fog/photos/x.md')).toBe(false);
    expect(isEntryMarkdown('src/content/pool/notes.md')).toBe(false);
    expect(isEntryMarkdown('src/content/pool/photos.meta.json')).toBe(false);
    expect(isEntryMarkdown('public/admin/index.html')).toBe(false);
  });
});

describe('check-image-sources · frontmatter 轻量解析', () => {
  it('块列表 photos + 引号 cover 都能取到（LF）', () => {
    const meta = parseFrontmatterMeta(
      entryMd({ cover: 'night-01.webp', photos: ['night-01.webp', 'dawn-01.webp'] }),
    );
    expect(meta).toEqual({
      hasFrontmatter: true,
      cover: 'night-01.webp',
      photos: ['night-01.webp', 'dawn-01.webp'],
    });
  });

  it('CRLF 与 LF 混排（现有 md 的真实形状）也解析得对', () => {
    // 复刻仓库里的混排：正文/多数键 CRLF，最后一两条 photos 项是 LF
    const mixed =
      '---\r\n' +
      'title: 晨雾里的第一束光\r\n' +
      'date: 2026-09-21\r\n' +
      "cover: 'dawn-01.webp'\r\n" +
      'tags: [风光, 晨雾]\r\n' +
      'draft: false\r\n' +
      'photos:\r\n' +
      '  - dawn-01.webp\n' +
      '  - night-01.webp\r\n' +
      '---\r\n' +
      '正文。\r\n';
    expect(parseFrontmatterMeta(mixed)).toEqual({
      hasFrontmatter: true,
      cover: 'dawn-01.webp',
      photos: ['dawn-01.webp', 'night-01.webp'],
    });
  });

  it('photos: [] / 行内 [a, b] / 空 cover 串都按契约读取', () => {
    expect(parseFrontmatterMeta(entryMd({ cover: '', photos: [] }))).toEqual({
      hasFrontmatter: true,
      cover: '',
      photos: [],
    });

    const inline = ['---', "cover: ''", 'photos: [a.webp, "b.webp"]', '---', ''].join('\r\n');
    expect(parseFrontmatterMeta(inline).photos).toEqual(['a.webp', 'b.webp']);

    // photos 后面紧跟别的块列表（tags），不该被吃进 photos
    const withTags = [
      '---',
      "cover: ''",
      'photos:',
      '  - a.webp',
      'tags:',
      '  - 街拍',
      '---',
      '',
    ].join('\n');
    expect(parseFrontmatterMeta(withTags).photos).toEqual(['a.webp']);
  });

  it('没有 frontmatter / 空 frontmatter 的边界：不抛错，返回空引用', () => {
    expect(splitFrontmatter('正文而已\n')).toBeNull();
    expect(splitFrontmatter('---\n---\n正文\n')).toBe('');
    expect(parseFrontmatterMeta('正文而已\n')).toEqual({
      hasFrontmatter: false,
      cover: '',
      photos: [],
    });
    expect(parseFrontmatterMeta('---\n---\n正文\n')).toEqual({
      hasFrontmatter: true,
      cover: '',
      photos: [],
    });
  });
});

describe('check-image-sources · auditImageSources 六条规则', () => {
  it('池化后的正常状态零违规，且真的数到内容图片张数', () => {
    const { files, sidecars, entries } = auditInput(cleanScenario());
    const result = auditImageSources({ files, sidecars, entries });
    expect(result.violations).toEqual([]);
    expect(result.checkedImages).toBe(4);
  });

  it('K5 回归：pool/photos.meta.json 与 src/content 下的其他 JSON 不被当成图片', () => {
    const scenario = cleanScenario();
    scenario.other = [
      ...(scenario.other ?? []),
      'src/content/pool/photos.meta.json',
      'src/content/pool/notes.json',
      'src/content/schemas.ts',
    ];
    const { files, sidecars, entries } = auditInput(scenario);
    expect(auditImageSources({ files, sidecars, entries }).violations).toEqual([]);
  });

  it('R1：条目目录里直接躺着一张图 → 报落位不对', () => {
    const scenario = cleanScenario();
    scenario.images = [...(scenario.images ?? []), 'src/content/series/alpha/sneaked-in.png'];
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    expect(
      violations.some((v: string) => v.startsWith('R1') && v.includes('sneaked-in.png')),
    ).toBe(true);
  });

  it('R1：旧布局 <集合>/<条目>/photos/ 下的图也被拦（池化后只剩一个合法位置）', () => {
    const scenario = cleanScenario();
    scenario.images = [
      ...(scenario.images ?? []),
      'src/content/series/alpha/photos/legacy-01.webp',
      'src/content/posts/2026-09-21-fog/photos/legacy-02.webp',
      'src/content/orphan.webp',
    ];
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    const r1 = violations.filter((v: string) => v.startsWith('R1'));
    expect(r1).toHaveLength(3);
    for (const name of ['legacy-01.webp', 'legacy-02.webp', 'orphan.webp']) {
      expect(r1.some((v: string) => v.includes(name))).toBe(true);
    }
  });

  it('R2：池里有照片却没有全局 sidecar → 报缺 sidecar', () => {
    const scenario = cleanScenario();
    delete scenario.sidecar;
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    expect(
      violations.some(
        (v: string) => v.startsWith('R2') && v.includes(POOL_SIDECAR_PATH) && v.includes('4 个文件'),
      ),
    ).toBe(true);
  });

  it('R2：sidecar 解析失败 / 不是数组 / 旧的逐条目 sidecar 残留都报契约不符', () => {
    const badJson = cleanScenario();
    badJson.sidecar = '{"file": "photos/x.webp",,}';
    const parseError = auditImageSources(auditInput(badJson));
    expect(
      parseError.violations.some(
        (v: string) => v.startsWith('R2') && v.includes('PhotoEntry') && v.includes('解析失败'),
      ),
    ).toBe(true);

    const notArray = cleanScenario();
    notArray.sidecar = { photos: [] };
    const objectSidecar = auditImageSources(auditInput(notArray));
    expect(
      objectSidecar.violations.some((v: string) => v.startsWith('R2') && v.includes('PhotoEntry')),
    ).toBe(true);

    // 池化后只有一份 sidecar：旧的 <条目>/photos.meta.json 残留要清掉
    const legacy = cleanScenario();
    legacy.extraSidecars = { 'series/alpha/photos.meta.json': [photoRecord('night-01')] };
    const legacySidecar = auditImageSources(auditInput(legacy));
    expect(
      legacySidecar.violations.some(
        (v: string) => v.startsWith('R2') && v.includes('series/alpha/photos.meta.json'),
      ),
    ).toBe(true);
  });

  it('R3：池里多出一张没登记的图 → 报「不是 npm run import 的产物」', () => {
    const scenario = cleanScenario();
    scenario.images = [...(scenario.images ?? []), `${POOL_PHOTOS_DIR}/admin-upload.webp`];
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    expect(
      violations.some((v: string) => v.startsWith('R3') && v.includes('admin-upload.webp')),
    ).toBe(true);
  });

  it('R3：缩略图（.thumb.webp）没被 thumb 字段登记也算没认领', () => {
    const scenario = cleanScenario();
    // 只登记展示版、丢了 thumb 字段：磁盘上的 .thumb.webp 就成了孤儿
    scenario.sidecar = [
      photoRecord('night-01', { thumb: '' }),
      photoRecord('dawn-01'),
    ];
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    expect(
      violations.some((v: string) => v.startsWith('R3') && v.includes('night-01.thumb.webp')),
    ).toBe(true);
  });

  it('R4：sidecar 指向池里没有的文件 → 报死链（含 thumb；./ 前缀不算死链）', () => {
    const scenario = cleanScenario();
    scenario.sidecar = [
      photoRecord('night-01', { file: './photos/night-01.webp' }),
      photoRecord('dawn-01', { thumb: 'photos/gone.thumb.webp' }),
    ];
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    // ./photos/night-01.webp 归一后与磁盘同一个键 → 不报 R4
    expect(
      violations.some((v: string) => v.startsWith('R4') && v.includes('photos/night-01.webp')),
    ).toBe(false);
    expect(
      violations.some((v: string) => v.startsWith('R4') && v.includes('gone.thumb.webp')),
    ).toBe(true);
  });

  it('R5：public/ 下出现图片就报（白名单为空，站点图标需显式点名）', () => {
    expect(ALLOWED_PUBLIC_IMAGES).toEqual([]);
    const scenario = cleanScenario();
    scenario.images = [...(scenario.images ?? []), 'public/uploads/pasted-image.webp'];
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    expect(
      violations.some((v: string) => v.startsWith('R5') && v.includes('public/uploads/')),
    ).toBe(true);
  });

  it('R6：photos 里的 ID 不在池内 → 点名条目与下标', () => {
    const scenario = cleanScenario();
    scenario.markdown = {
      'src/content/series/alpha/index.md': entryMd({
        cover: 'night-01.webp',
        photos: ['night-01.webp', 'ghost-99.webp'],
      }),
    };
    const { files, sidecars, entries } = auditInput(scenario);
    const { violations } = auditImageSources({ files, sidecars, entries });
    expect(
      violations.some(
        (v: string) =>
          v.startsWith('R6') &&
          v.includes('src/content/series/alpha/index.md') &&
          v.includes('photos[1]') &&
          v.includes('ghost-99.webp'),
      ),
    ).toBe(true);
  });

  it('R6：cover 非空但不是池内 ID → 报；cover 空串合法（A5 三级回退）', () => {
    const badCover = cleanScenario();
    badCover.markdown = {
      'src/content/series/wip-empty/index.md': entryMd({
        cover: 'tbd.webp',
        photos: ['night-01.webp'],
      }),
    };
    const bad = auditImageSources(auditInput(badCover));
    expect(
      bad.violations.some((v: string) => v.startsWith('R6') && v.includes('cover') && v.includes('tbd.webp')),
    ).toBe(true);

    // 空串 = 不指定封面，且 photos 也为空：合法（前台整块封面区不渲染）
    const emptyCover = cleanScenario();
    emptyCover.markdown = {
      'src/content/series/wip-empty/index.md': entryMd({ cover: '', photos: [] }),
      'src/content/posts/2026-07-02-alley-light.md': entryMd({ cover: '', photos: [] }),
    };
    expect(auditImageSources(auditInput(emptyCover)).violations).toEqual([]);
  });

  it('R6：ID 写成带 photos/ 前缀或误填缩略图时，报错里给出改法提示', () => {
    const prefixed = cleanScenario();
    prefixed.markdown = {
      'src/content/posts/2026-08-10-foggy-morning.md': entryMd({
        cover: 'photos/night-01.webp',
        photos: ['photos/night-01.webp'],
      }),
    };
    const { violations } = auditImageSources(auditInput(prefixed));
    const r6 = violations.filter((v: string) => v.startsWith('R6'));
    expect(r6).toHaveLength(2);
    expect(r6.every((v: string) => v.includes('"night-01.webp"'))).toBe(true);

    const thumbId = cleanScenario();
    thumbId.markdown = {
      'src/content/posts/2026-08-10-foggy-morning.md': entryMd({
        cover: 'night-01.thumb.webp',
        photos: ['night-01.thumb.webp'],
      }),
    };
    // 缩略图 ID 必须被拦：前台 findPoolPhoto 只按 sidecar 的 file 末段匹配，
    // 引用 .thumb.webp 会静默查不到（封面/照片流消失且不报错），比构建失败更坏。
    const thumbViolations = auditImageSources(auditInput(thumbId)).violations;
    const thumbR6 = thumbViolations.filter((v: string) => v.startsWith('R6'));
    expect(thumbR6).toHaveLength(2);
    expect(thumbR6.every((v: string) => v.includes('展示版 ID'))).toBe(true);
  });

  it('sidecar 本身不合法时 R6 不级联报错（一份坏 JSON 只报一条 R2）', () => {
    const scenario = cleanScenario();
    scenario.sidecar = '{ 坏掉的 JSON';
    const { violations } = auditImageSources(auditInput(scenario));
    expect(violations.filter((v: string) => v.startsWith('R2'))).toHaveLength(1);
    expect(violations.filter((v: string) => v.startsWith('R6'))).toHaveLength(0);
  });

  it('池里没照片、条目也没照片的草稿不该被误报', () => {
    const { violations } = auditImageSources({
      files: [
        'src/content/series/wip-empty/index.md',
        'src/content/pool/photos.meta.json',
      ],
      sidecars: { 'pool/photos.meta.json': [] },
      entries: [
        {
          path: 'src/content/series/wip-empty/index.md',
          ...parseFrontmatterMeta(entryMd({ cover: '', photos: [] })),
        },
      ],
    });
    expect(violations).toEqual([]);
  });
});

// =============================================================================
// I/O 编排 + CLI
// =============================================================================
describe('check-image-sources · runCheck 走盘与退出码', () => {
  afterAll(() => {
    rmSync(FIXTURE, { recursive: true, force: true });
  });

  it('合法夹具 → 退出码 0（--quiet 不打印通过行）', async () => {
    writeFixture(cleanScenario());
    const { code, text } = await checkAt(FIXTURE, true);
    expect(code).toBe(0);
    expect(text).toBe('');
  });

  it('通过时打印一行说明（点名池目录与全局 sidecar）', async () => {
    writeFixture(cleanScenario());
    const { code, text } = await checkAt(FIXTURE, false);
    expect(code).toBe(0);
    expect(text).toContain('4 张内容图片');
    expect(text).toContain(POOL_PHOTOS_DIR);
    expect(text).toContain(POOL_SIDECAR_PATH);
  });

  it('在错误位置放一张图（旧布局）→ 退出码 1 且日志点名该文件与 R1', async () => {
    const scenario = cleanScenario();
    scenario.images = [...(scenario.images ?? []), 'src/content/series/alpha/photos/from-admin.webp'];
    writeFixture(scenario);
    const { code, text } = await checkAt(FIXTURE);
    expect(code).toBe(1);
    expect(text).toContain('from-admin.webp');
    expect(text).toContain('R1');
  });

  it('池里少一张缩略图 → 退出码 1 且报 R4（真实落盘 + 真实 JSON）', async () => {
    const scenario = cleanScenario();
    scenario.images = [`${POOL_PHOTOS_DIR}/night-01.webp`];
    scenario.sidecar = [photoRecord('night-01')];
    scenario.markdown = { 'src/content/series/alpha/index.md': entryMd({ cover: 'night-01.webp', photos: ['night-01.webp'] }) };
    writeFixture(scenario);
    const { code, text } = await checkAt(FIXTURE);
    expect(code).toBe(1);
    expect(text).toContain('R4');
    expect(text).toContain('night-01.thumb.webp');
  });

  it('sidecar 是坏 JSON → 退出码 1 且走真实解析失败分支', async () => {
    const scenario = cleanScenario();
    scenario.sidecar = '{ 不是合法 JSON';
    writeFixture(scenario);
    const { code, text } = await checkAt(FIXTURE);
    expect(code).toBe(1);
    expect(text).toContain('R2');
    expect(text).toContain('解析失败');
  });

  it('条目 frontmatter 走真实文件（CRLF）：照片都在池里 → 0；写错 ID → 1', async () => {
    const scenario = cleanScenario();
    scenario.markdown = {
      'src/content/series/alpha/index.md': entryMd({
        cover: 'dawn-01.webp',
        photos: ['dawn-01.webp', 'night-01.webp'],
        eol: '\r\n',
      }),
    };
    writeFixture(scenario);
    expect((await checkAt(FIXTURE)).code).toBe(0);

    const broken = cleanScenario();
    broken.markdown = {
      'src/content/series/alpha/index.md': entryMd({
        cover: 'dawn-01.webp',
        photos: ['dawn-01.webp', 'missing.webp'],
        eol: '\r\n',
      }),
    };
    writeFixture(broken);
    const { code, text } = await checkAt(FIXTURE);
    expect(code).toBe(1);
    expect(text).toContain('R6');
    expect(text).toContain('missing.webp');
  });

  it('当前仓库真实内容全部通过（照片只在池里、sidecar 与磁盘成对、引用都在池内）', async () => {
    const { code, text } = await checkAt(ROOT, false);
    expect(code).toBe(0);
    expect(text).toContain('156 张内容图片');
  });
});

describe('check-image-sources · CLI 与接线', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

  it('--help 退出码 0 并列出 R1~R6', async () => {
    const lines: string[] = [];
    const code = await runCli(['--help'], { log: (line: string) => lines.push(line) });
    expect(code).toBe(0);
    const text = lines.join('\n');
    for (const tag of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) expect(text).toContain(tag);
    expect(text).toContain(POOL_PHOTOS_DIR);
    expect(text).toContain('--quiet');
  });

  it('参数解析：--root / --quiet 认，未知参数忽略', () => {
    expect(parseArgs(['--quiet']).quiet).toBe(true);
    expect(parseArgs(['-q']).quiet).toBe(true);
    expect(parseArgs(['--root', 'tmp/x']).root).toContain(join('tmp', 'x'));
    const unknown = parseArgs(['--nope']);
    expect(unknown.help).toBe(false);
    expect(unknown.errors).toEqual([]);
  });

  it('参数错误分支：--root 缺值 → 退出码 2 并提示 --help', async () => {
    const lines: string[] = [];
    const code = await runCli(['--root'], { log: (line: string) => lines.push(line) });
    expect(code).toBe(2);
    const text = lines.join('\n');
    expect(text).toContain('参数错误');
    expect(text).toContain('--help');
  });

  it('npm 脚本已接线：prebuild 挡在 astro build 前面，check-images 可单独跑', () => {
    expect(pkg.scripts['check-images']).toBe('node scripts/check-image-sources.mjs');
    expect(pkg.scripts.prebuild).toContain('check-image-sources.mjs');
    expect(pkg.scripts.prebuild).toContain('--quiet');
    // build 本体仍是裸 astro build（Pages 的 Build command 也是它）
    expect(pkg.scripts.build).toBe('astro build');
  });

  it('脚本只读不写：不出现删除/改名/写入调用（与 import-photos 同一条红线）', () => {
    const source = readFileSync(resolve(ROOT, 'scripts/check-image-sources.mjs'), 'utf8');
    expect(source).not.toMatch(/\b(unlinkSync|rmSync|rmdirSync|removeSync|renameSync|writeFile)\s*\(/);
    expect(source).not.toMatch(/fsp\.(rm|unlink|rename|writeFile|mkdir)/);
  });

  it('Sveltia 退役后 public/admin 不再有 config.yml（自建后台无配置文件）', () => {
    expect(existsSync(resolve(ROOT, 'scripts/check-image-sources.mjs'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'public/admin/config.yml'))).toBe(false);
  });
});
