import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ALLOWED_PUBLIC_IMAGES,
  IMAGE_EXTENSIONS,
  SIDECAR_FILE,
  auditImageSources,
  isImageFile,
  parseArgs,
  photoOwnershipOf,
  runCheck,
  runCli,
} from '../../scripts/check-image-sources.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// 兜底检查（decap-cms 任务 6）的夹具目录：node_modules/ 已被 .gitignore 排除，不污染工作树。
const FIXTURE = resolve(ROOT, 'node_modules/.tmp/image-check-fixture');

/** 一条合法的 sidecar 记录（形状按 src/types/photoSidecar.ts，只填检查会用到的键）。 */
function photoRecord(base: string) {
  return {
    file: `photos/${base}.webp`,
    thumb: `photos/${base}.thumb.webp`,
    width: 2560,
    height: 1707,
    thumbWidth: 800,
    thumbHeight: 533,
    exif: { camera: 'Panasonic Lumix GX85' },
  };
}

/** 正常仓库状态：照片都在 <条目>/photos/ 下且都被 sidecar 登记。 */
function legitFixture() {
  return {
    files: [
      'src/content/series/alpha/index.md',
      'src/content/series/alpha/photos/night-01.webp',
      'src/content/series/alpha/photos/night-01.thumb.webp',
      'src/content/posts/2026-09-21-fog.md',
      'src/content/posts/2026-09-21-fog/photos/dawn-01.webp',
      'src/content/posts/2026-09-21-fog/photos/dawn-01.thumb.webp',
      'src/content/series/wip/index.md',
      'public/admin/index.html',
      'public/admin/config.yml',
    ],
    sidecars: {
      'series/alpha/photos.meta.json': [photoRecord('night-01')],
      'posts/2026-09-21-fog/photos.meta.json': [photoRecord('dawn-01')],
    },
  };
}

/** 把文件清单写进夹具目录（内容无意义，检查只看路径与 sidecar 内容）。 */
function writeFixture(tree: { files: string[]; sidecars: Record<string, unknown> }) {
  rmSync(FIXTURE, { recursive: true, force: true });
  for (const rel of tree.files) {
    const abs = join(FIXTURE, rel);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, 'x');
  }
  for (const [rel, value] of Object.entries(tree.sidecars)) {
    const abs = join(FIXTURE, 'src/content', rel);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, JSON.stringify(value));
  }
}

/** 跑一次检查并回收日志（runCheck 不写 process.stdout，方便断言）。 */
async function checkAt(root: string, quiet = true) {
  const lines: string[] = [];
  const code = await runCheck({ root, log: (l) => lines.push(l), quietOnPass: quiet });
  return { code, text: lines.join('\n') };
}

// =============================================================================
// 纯函数区：R1~R5 每条规则都要能单独被证明「触发」与「不误伤」
// =============================================================================
describe('check-image-sources · 扩展名与归属判定', () => {
  it('图片扩展名覆盖脚本产物与原图格式，非图片不误判', () => {
    expect(IMAGE_EXTENSIONS).toContain('.webp');
    for (const name of ['a.webp', 'a.thumb.webp', 'B.JPG', 'c.jpeg', 'd.png', 'e.heic']) {
      expect(isImageFile(name), `${name} 应算图片`).toBe(true);
    }
    for (const name of ['index.md', 'photos.meta.json', 'script.ts', '.gitkeep', 'a.css']) {
      expect(isImageFile(name), `${name} 不该算图片`).toBe(false);
    }
  });

  it('系列与随笔的 photos/ 路径都能定到条目目录，键与 sidecar 同口径', () => {
    expect(photoOwnershipOf('src/content/series/city-lights/photos/night-01.webp')).toEqual({
      entryDir: 'series/city-lights',
      relInEntry: 'photos/night-01.webp',
      inPhotosDir: true,
    });
    expect(
      photoOwnershipOf('src/content/posts/2026-09-21-morning-fog/photos/dawn-01.thumb.webp'),
    ).toEqual({
      entryDir: 'posts/2026-09-21-morning-fog',
      relInEntry: 'photos/dawn-01.thumb.webp',
      inPhotosDir: true,
    });
    // Windows 反斜杠同样吃得下（工具链在 Git Bash / PowerShell 两边跑）
    expect(photoOwnershipOf('src\\content\\series\\a\\photos\\x.webp').inPhotosDir).toBe(true);
  });

  it('photos/ 之外的图片与内容外的路径都不算合法落位（R1 的判据）', () => {
    expect(photoOwnershipOf('src/content/series/city-lights/evil.png')).toEqual({
      entryDir: 'series/city-lights',
      relInEntry: 'evil.png',
      inPhotosDir: false,
    });
    expect(photoOwnershipOf('src/content/orphan.png').inPhotosDir).toBe(false);
    expect(photoOwnershipOf('public/uploaded/thing.webp')).toEqual({
      entryDir: '',
      relInEntry: '',
      inPhotosDir: false,
    });
    // photos/ 当目录名出现在中间（不是紧邻文件名）也不算落位
    expect(photoOwnershipOf('src/content/photos/evil/deep.webp').inPhotosDir).toBe(false);
  });
});

describe('check-image-sources · auditImageSources 五条规则', () => {
  it('脚本产物（成对 + 已登记）零违规，且真的数到图片数', () => {
    const { files, sidecars } = legitFixture();
    const result = auditImageSources({ files, sidecars });
    expect(result.violations).toEqual([]);
    expect(result.checkedImages).toBe(4);
  });

  it('R1：条目目录里直接躺着一张图 → 报「非脚本来源」', () => {
    const { files, sidecars } = legitFixture();
    files.push('src/content/series/alpha/sneaked-in.png');
    const { violations } = auditImageSources({ files, sidecars });
    expect(violations.some((v) => v.startsWith('R1') && v.includes('sneaked-in.png'))).toBe(true);
  });

  it('R2：有 photos/ 却没 photos.meta.json → 报缺 sidecar', () => {
    const { violations } = auditImageSources({
      files: ['src/content/series/beta/photos/x.webp'],
      sidecars: {},
    });
    expect(violations.some((v) => v.startsWith('R2') && v.includes(SIDECAR_FILE))).toBe(true);
  });

  it('R2：sidecar 不是 PhotoEntry 数组（含解析失败）→ 报契约不符', () => {
    const bad = auditImageSources({
      files: ['src/content/series/beta/photos/x.webp'],
      sidecars: { 'series/beta/photos.meta.json': { __parseError: true } },
    });
    expect(bad.violations.some((v) => v.startsWith('R2') && v.includes('PhotoEntry'))).toBe(true);
  });

  it('R3：photos/ 里的文件没被 sidecar 登记 → 报「不是 npm run import 的产物」', () => {
    const { files, sidecars } = legitFixture();
    // 模拟后台/手工塞进 photos/ 的一张图（sidecar 里没有它）
    files.push('src/content/series/alpha/photos/admin-upload.webp');
    const { violations } = auditImageSources({ files, sidecars });
    expect(
      violations.some((v) => v.startsWith('R3') && v.includes('admin-upload.webp')),
    ).toBe(true);
  });

  it('R4：sidecar 登记的文件磁盘上没有 → 报回填缺失（含 ./ 前缀容忍）', () => {
    const { violations } = auditImageSources({
      files: ['src/content/series/gamma/photos/a.webp'],
      sidecars: {
        'series/gamma/photos.meta.json': [
          { ...photoRecord('a'), file: './photos/a.webp', thumb: 'photos/gone.thumb.webp' },
        ],
      },
    });
    // ./photos/a.webp 归一后与磁盘上的 photos/a.webp 是同一个键 → 不该报 R4
    expect(violations.some((v) => v.startsWith('R4') && v.includes('photos/a.webp'))).toBe(false);
    expect(violations.some((v) => v.startsWith('R4') && v.includes('gone.thumb.webp'))).toBe(true);
  });

  it('R5：public/ 下出现图片就报（白名单为空，站点图标需显式点名）', () => {
    expect(ALLOWED_PUBLIC_IMAGES).toEqual([]);
    const { files, sidecars } = legitFixture();
    files.push('public/uploads/pasted-image.webp');
    const { violations } = auditImageSources({ files, sidecars });
    expect(violations.some((v) => v.startsWith('R5') && v.includes('public/uploads/'))).toBe(true);
  });

  it('没有 photos/ 的空条目（草稿只写了字）不该被误报', () => {
    const { violations } = auditImageSources({
      files: ['src/content/series/wip/index.md'],
      sidecars: {},
    });
    expect(violations).toEqual([]);
  });
});

// =============================================================================
// I/O 编排 + CLI：夹具真落盘、真退出码；最后拿当前仓库做一次总自检
// =============================================================================
describe('check-image-sources · runCheck 走盘与退出码', () => {
  afterAll(() => {
    rmSync(FIXTURE, { recursive: true, force: true });
  });

  it('合法夹具 → 退出码 0（--quiet 时不打印通过行）', async () => {
    writeFixture(legitFixture());
    const { code, text } = await checkAt(FIXTURE);
    expect(code).toBe(0);
    expect(text).toBe('');
  });

  it('通过时打印一行说明（非 quiet）', async () => {
    writeFixture(legitFixture());
    const { code, text } = await checkAt(FIXTURE, false);
    expect(code).toBe(0);
    expect(text).toContain('4 张内容图片');
  });

  it('塞一张「非脚本来源图片」→ 退出码 1 且日志点名该文件', async () => {
    const tree = legitFixture();
    tree.files.push('src/content/posts/2026-09-21-fog/photos/from-admin.webp');
    writeFixture(tree);
    const { code, text } = await checkAt(FIXTURE, false);
    expect(code).toBe(1);
    expect(text).toContain('from-admin.webp');
    expect(text).toContain('R3');
  });

  it('当前仓库真实内容全部通过兜底检查（照片确实只出自 import 脚本）', async () => {
    const { code, text } = await checkAt(ROOT, false);
    expect(text).toContain('npm run import');
    expect(code).toBe(0);
  });
});

describe('check-image-sources · CLI 与接线', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

  it('--help 退出码 0 并列出五条规则', async () => {
    const lines: string[] = [];
    const code = await runCli(['--help'], { log: (l: string) => lines.push(l) });
    expect(code).toBe(0);
    const text = lines.join('\n');
    for (const tag of ['R1', 'R2', 'R3', 'R4', 'R5']) expect(text).toContain(tag);
  });

  it('参数解析：--root / --quiet 认，未知参数忽略', () => {
    expect(parseArgs(['--quiet']).quiet).toBe(true);
    expect(parseArgs(['--root', 'tmp/x']).root).toContain(join('tmp', 'x'));
    expect(parseArgs(['--nope']).help).toBe(false);
  });

  it('npm 脚本已接线：prebuild 会挡在 astro build 前面，check-images 可单独跑', () => {
    expect(pkg.scripts['check-images']).toBe('node scripts/check-image-sources.mjs');
    expect(pkg.scripts.prebuild).toContain('check-image-sources.mjs');
    // build 本体仍是裸 astro build（package-config 用例钉着，Pages 的 Build command 也是它）
    expect(pkg.scripts.build).toBe('astro build');
  });

  it('脚本只读不写：不出现删除/改名调用（与 import-photos 同一条红线）', () => {
    const source = readFileSync(resolve(ROOT, 'scripts/check-image-sources.mjs'), 'utf8');
    expect(source).not.toMatch(/\b(unlinkSync|rmSync|rmdirSync|removeSync|renameSync|writeFile)\s*\(/);
    expect(source).not.toMatch(/fsp\.(rm|unlink|rename|writeFile|mkdir)/);
  });

  it('兜底脚本存在且被 public/admin 的配置注释指认（三处口径一致）', () => {
    expect(existsSync(resolve(ROOT, 'scripts/check-image-sources.mjs'))).toBe(true);
    const cmsConfig = readFileSync(resolve(ROOT, 'public/admin/config.yml'), 'utf8');
    expect(cmsConfig).toContain('check-image-sources');
    expect(cmsConfig).toContain('npm run check-images');
  });
});
