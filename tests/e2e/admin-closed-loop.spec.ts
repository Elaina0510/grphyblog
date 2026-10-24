import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { postsSchema, seriesSchema } from '../../src/content/schemas';
import { installGitHubMock, POST_MD, SERIES_MD, sidecarWithPending } from './helpers/admin-mock';

// ============================================================================
// 闭环验收：后台保存的 md 真的能被前台渲染（admin-v2.md 验收标准 6/7）
//
// 现有 admin e2e 只验到「PUT 的 body 长什么样」，这条链路是断的：
//   后台拼出 md → PUT → （人工 push）→ 前台渲染
// 中间「前台能不能吃下这份 md」没有任何自动化覆盖，而它恰恰是最容易出错的一环
// （键名写错、photos 不是合法 ID、cover 指向池里没有的图、YAML 转义失误）。
//
// 本文件把断掉的链接上：从后台 PUT 记录里取出 md 全文，喂给**真实的** zod schema
// 与真实的照片池，断言它能过 schema、photos 每项都是池内展示版 ID、cover 也能解析。
// 全程不碰真实 GitHub（mock 层照旧），不写盘。
//
// 剩下的「push → Cloudflare 重建 → 线上渲染」需要真实 PAT 与部署，属外部动作，
// 由人工按 doc/admin-login-setup.md 走完。
// ============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 极简 frontmatter 解析（与 admin-yaml 单测同口径，只为取键值对）。 */
function parseFrontmatter(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error('缺少 frontmatter');
  const out: Record<string, unknown> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const k = kv[1];
    const raw = kv[2].trim();
    const items: string[] = [];
    let j = i + 1;
    while (j < lines.length && /^\s+- /.test(lines[j])) {
      items.push(lines[j].replace(/^\s+- /, '').trim());
      j += 1;
    }
    if (items.length) {
      out[k] = items;
      i = j - 1;
      continue;
    }
    if (raw === "''" || raw === '""') out[k] = '';
    else if (raw.startsWith('[')) {
      out[k] = raw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (/^-?\d+$/.test(raw)) out[k] = Number(raw);
    else if (raw === 'true' || raw === 'false') out[k] = raw === 'true';
    else out[k] = raw;
  }
  return out;
}

/** 池内展示版 ID 集合（前台 findPoolPhoto 只按 sidecar 的 file 末段匹配）。 */
function poolDisplayIds(): Set<string> {
  const sidecar = JSON.parse(
    readFileSync(resolve(ROOT, 'src/content/pool/photos.meta.json'), 'utf8'),
  ) as Array<{ file: string }>;
  return new Set(sidecar.map((e) => e.file.split('/').pop() ?? ''));
}

async function login(page: Page): Promise<void> {
  await page.goto('/admin/');
  await page.fill('[data-testid="token-input"]', 'e2e-token');
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
}

async function openSeries(page: Page): Promise<void> {
  await page.click('[data-testid="nav-series"]');
  await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
  await page.click('[data-testid="entry-edit"]');
  await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();
}

async function openPost(page: Page): Promise<void> {
  await page.click('[data-testid="nav-posts"]');
  await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
  await page.click('[data-testid="entry-edit"]');
  await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();
}

test.describe('闭环：后台保存 → 前台能渲染', () => {
  test('系列：勾选后保存，PUT 出来的 md 过 schema 且每张图都在池里', async ({ page }) => {
    const mock = await installGitHubMock(page, { sidecar: sidecarWithPending() });
    await login(page);
    await openSeries(page);

    // 勾一张当前没被引用的池内照片
    const poolIds = poolDisplayIds();
    const currentPhotos = (parseFrontmatter(readFileSync(resolve(ROOT, SERIES_MD), 'utf8')).photos ??
      []) as string[];
    const candidate = [...poolIds].find((id) => !currentPhotos.includes(id));
    expect(candidate, '池里应该有一张该系列还没引用的图').toBeTruthy();

    // 照片网格默认收起（2026-10-24 的 UI 调整），先展开
    await page.click('[data-testid="picker-toggle"]');
    await page.click(`[data-testid="pick-tile"][data-photo-id="${candidate}"]`);
    await expect(
      page.locator(`[data-testid="pick-box"][data-photo-id="${candidate}"]`),
    ).toBeChecked();

    // 保存 → 取 PUT 的 md 全文
    await page.click('[data-testid="save"]');
    await expect.poll(() => mock.puts.length).toBeGreaterThan(0);
    const put = mock.puts.at(-1)!;
    expect(put.path).toBe(SERIES_MD);

    // ① 过真实 schema（strict：多一个键、少一个键都红）
    const data = parseFrontmatter(put.text);
    const parsed = seriesSchema.safeParse(data);
    expect(
      parsed.success,
      `后台保存的 md 过不了 seriesSchema：${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`,
    ).toBe(true);

    // ② photos 每项都是池内展示版 ID（不是缩略图、不是路径、不是野 ID）
    const photos = data.photos as string[];
    expect(photos.length).toBeGreaterThan(0);
    expect(photos).toContain(candidate);
    for (const id of photos) {
      expect(poolIds.has(id), `photos 里的 ${id} 不是池内展示版 ID`).toBe(true);
    }

    // ③ cover 非空时也必须是池内 ID（空串合法：A5 三级回退）
    const cover = String(data.cover ?? '');
    if (cover !== '') expect(poolIds.has(cover), `cover ${cover} 不在池里`).toBe(true);

    // ④ 行尾保持 CRLF（与仓库现有内容一致，不制造假 diff）
    expect(put.text.includes('\r\n'), '保存结果应保持 CRLF').toBe(true);
  });

  test('随笔：保存后过 postsSchema，插图引用走 photo: 语法且 ID 在池里', async ({ page }) => {
    const mock = await installGitHubMock(page, { sidecar: sidecarWithPending() });
    await login(page);
    await openPost(page);

    await page.click('[data-testid="save"]');
    await expect.poll(() => mock.puts.length).toBeGreaterThan(0);
    const put = mock.puts.at(-1)!;
    expect(put.path).toBe(POST_MD);

    const data = parseFrontmatter(put.text);
    const parsed = postsSchema.safeParse(data);
    expect(
      parsed.success,
      `后台保存的 md 过不了 postsSchema：${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`,
    ).toBe(true);

    const poolIds = poolDisplayIds();
    for (const id of (data.photos ?? []) as string[]) {
      expect(poolIds.has(id), `photos 里的 ${id} 不是池内展示版 ID`).toBe(true);
    }

    // 正文里已有的 photo: 引用必须原样保留，且 ID 都在池里、alt 非空。
    // 只认 ID 以 .webp 结尾的：正文说明文字里也写着 `![说明](photo:照片ID)` 这种示例，
    // 那是给人看的文档，不是真实引用（见 2026-09-21-morning-fog.md 第 20 行）。
    const refs = [...put.text.matchAll(/!\[([^\]]*)\]\(photo:([^)\s]+\.webp)\)/g)];
    expect(refs.length, '正文应保留至少一条 photo: 插图引用').toBeGreaterThan(0);
    for (const [, alt, id] of refs) {
      expect(poolIds.has(id.trim()), `插图引用的 ${id} 不在池里`).toBe(true);
      expect(alt.trim().length, '插图 alt 不该为空（alt 即说明文字）').toBeGreaterThan(0);
    }
  });

  test('浏览器直传：PUT 的 sidecar 新条目带 exifIncomplete 与真实宽高', async ({ page }) => {
    const mock = await installGitHubMock(page, { sidecar: sidecarWithPending() });
    await login(page);

    // 造一张 3000×2000 的 PNG 喂给上传输入框
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3000;
      canvas.height = 2000;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, 3000, 2000);
      grad.addColorStop(0, '#c8102e');
      grad.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 3000, 2000);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.setInputFiles('[data-testid="upload-input"]', {
      name: 'e2e-close-loop.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });

    // 等 sidecar 的 PUT 出现（上传是三次 PUT：展示版 → 缩略图 → sidecar）
    await expect
      .poll(() => mock.puts.filter((p) => p.path.endsWith('photos.meta.json')).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect(page.locator('[data-testid="upload-status"]')).toContainText('已直传 1 张', {
      timeout: 30_000,
    });

    const sidecarPut = mock.puts.find((p) => p.path.endsWith('photos.meta.json'))!;
    const entries = JSON.parse(sidecarPut.text) as Array<Record<string, any>>;
    // 后台自己生成文件名（web-<时间戳>-<hex>.webp），直传项追加在末尾
    const added = entries[entries.length - 1];

    expect(String(added.file), '直传项应落在池内').toMatch(/^photos\/web-[\w-]+\.webp$/);
    // E6：浏览器读不到 EXIF → 打待补标记，条目级与 exif 内镜像各一份
    expect(added!.exifIncomplete, '条目级应标 exifIncomplete').toBe(true);
    expect(added!.exif?.exifIncomplete, 'exif 内镜像也要有（渲染侧拿得到）').toBe(true);
    // 宽高从 Canvas 产物读真值（不是按常量推算）：
    // 3000×2000 压到长边 2560 → 2560×1707（2000 按 2560/3000 缩放后**向上取整到 1707**，
    // 与 sharp 的 fit:inside + 等比缩放口径一致）。这里钉真实值，防止它退回按常量猜。
    expect(added!.width).toBe(2560);
    expect(added!.height).toBe(1707);
    // 缩略图长边 800，同比例
    expect(added!.thumbWidth).toBe(800);
    expect(added!.thumbHeight).toBe(533);
    // file/thumb 是池内相对路径
    expect(String(added!.file).startsWith('photos/')).toBe(true);
    expect(String(added!.thumb).startsWith('photos/')).toBe(true);
  });
});
