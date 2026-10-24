import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page, Route } from '@playwright/test';

// =============================================================================
// 后台 e2e 的 GitHub 替身（admin-v2.md E 组）
//
// 三条硬要求：
//   ① **不打真实 GitHub**：api.github.com 全量拦截，按 Contents API 的形状应答；
//   ② **图片用真文件**：raw.githubusercontent.com 也拦截，直接吐仓库里的 webp
//      （后台预览走原始地址，这样截图/断言的缩略图是真实产物）；
//   ③ **Vditor 的 CDN 主动失败**：本机/CI 常常没有外网，这里显式 abort，
//      让编辑页稳定落到 textarea 兜底 —— 那是真实存在的降级路径，不是测试作弊。
//
// 记录 PUT（保存 / 上传）的请求体，供用例断言 commit 内容。
// =============================================================================

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** 真实池元数据（e2e 用真数据，只有「EXIF 待补」那条是刻意造出来的）。 */
export function realSidecar(): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(resolve(ROOT, 'src/content/pool/photos.meta.json'), 'utf8')) as Array<
    Record<string, unknown>
  >;
}

/** 在真 sidecar 基础上把最后一条标成「浏览器直传产物」（EXIF 全空 + 待补角标）。 */
export function sidecarWithPending(): Array<Record<string, unknown>> {
  const entries = realSidecar();
  const last = entries[entries.length - 1];
  entries[entries.length - 1] = {
    ...last,
    exif: { camera: null, lens: null, focalLength: null, aperture: null, shutter: null, iso: null, dateTaken: null, exifIncomplete: true },
    exifIncomplete: true,
  };
  return entries;
}

export const SERIES_MD = 'src/content/series/city-lights/index.md';
export const POST_MD = 'src/content/posts/2026-09-21-morning-fog.md';

/** 默认的文件表：三个真文件 + 池 sidecar（可在用例里覆盖）。 */
function defaultFiles(sidecar: Array<Record<string, unknown>>): Record<string, string> {
  return {
    'src/content/pool/photos.meta.json': `${JSON.stringify(sidecar, null, 2)}\n`,
    [SERIES_MD]: readFileSync(resolve(ROOT, SERIES_MD), 'utf8'),
    [POST_MD]: readFileSync(resolve(ROOT, POST_MD), 'utf8'),
    'src/content/posts/2026-07-02-alley-light.md': readFileSync(
      resolve(ROOT, 'src/content/posts/2026-07-02-alley-light.md'),
      'utf8',
    ),
  };
}

/** 默认目录表：系列 2 个（daily-frames 故意没有 index.md，验证 404 跳过），随笔 2 个。 */
const DEFAULT_DIRS: Record<string, Array<Record<string, unknown>>> = {
  'src/content/series': [
    { name: 'city-lights', path: 'src/content/series/city-lights', type: 'dir', sha: 'dir-city', size: 0 },
    { name: 'daily-frames', path: 'src/content/series/daily-frames', type: 'dir', sha: 'dir-daily', size: 0 },
  ],
  'src/content/posts': [
    { name: '2026-09-21-morning-fog.md', path: POST_MD, type: 'file', sha: 'blob-post', size: 100 },
    { name: '2026-07-02-alley-light.md', path: 'src/content/posts/2026-07-02-alley-light.md', type: 'file', sha: 'blob-post2', size: 100 },
  ],
};

export interface PutRecord {
  path: string;
  body: Record<string, unknown>;
  /** PUT body 里的 content 解码后的文本（二进制则是字节长度）。 */
  text: string;
  bytes: number;
}

export interface MockOptions {
  /** 池 sidecar（默认 sidecarWithPending）。 */
  sidecar?: Array<Record<string, unknown>>;
  /** 覆盖/追加文件表。 */
  files?: Record<string, string>;
  /** 覆盖/追加目录表。 */
  dirs?: Record<string, Array<Record<string, unknown>>>;
  /** 让所有 GET 返回 401（登录失败路径）。 */
  unauthorized?: boolean;
  /** 缩略图一律 404（预览兜底占位块）。 */
  breakImages?: boolean;
}

export interface DeleteRecord {
  path: string;
  body: Record<string, unknown>;
}

export interface MockHandle {
  puts: PutRecord[];
  /** 记录 DELETE（删条目），供用例断言「删的是哪一篇、带没带 sha」。 */
  deletes: DeleteRecord[];
  /** 清空已记录的 PUT（用例分段断言时用）。 */
  reset(): void;
}

function b64decode(text: string): Buffer {
  return Buffer.from(String(text ?? '').replace(/\s+/g, ''), 'base64');
}

/** 装好三条路由，返回 PUT 记录器。 */
export async function installGitHubMock(page: Page, options: MockOptions = {}): Promise<MockHandle> {
  const sidecar = options.sidecar ?? sidecarWithPending();
  const files = { ...defaultFiles(sidecar), ...(options.files ?? {}) };
  const dirs = { ...DEFAULT_DIRS, ...(options.dirs ?? {}) };
  const puts: PutRecord[] = [];
  const deletes: DeleteRecord[] = [];

  await page.route('https://api.github.com/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(
      url.pathname.replace('/repos/Elaina0510/grphyblog/contents/', '').replace(/^\/+/, ''),
    );

    if (options.unauthorized) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Bad credentials' }),
      });
      return;
    }

    if (request.method() === 'PUT') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      const decoded = b64decode(String(body.content ?? ''));
      puts.push({ path, body, text: decoded.toString('utf8'), bytes: decoded.length });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: { path, sha: `sha-after-${puts.length}` }, commit: { sha: 'commit-0123456789' } }),
      });
      return;
    }

    if (request.method() === 'DELETE') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      deletes.push({ path, body });
      // 真 GitHub 的 DELETE 不带 sha 会 422；这里同样拒绝，好让测试能抓住「忘了带 sha」
      if (!body.sha) {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Invalid request: "sha" wasn\'t supplied.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ commit: { sha: 'commit-deleted-0123456789' } }),
      });
      return;
    }

    if (dirs[path]) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dirs[path]) });
      return;
    }
    if (files[path] !== undefined) {
      const text = files[path];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'file',
          path,
          sha: `sha-of-${path}`,
          size: text.length,
          encoding: 'base64',
          content: Buffer.from(text, 'utf8').toString('base64'),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not Found' }),
    });
  });

  await page.route('https://raw.githubusercontent.com/**', async (route: Route) => {
    if (options.breakImages) {
      await route.fulfill({ status: 404, body: 'no image' });
      return;
    }
    const url = new URL(route.request().url());
    const rel = url.pathname.split('/main/')[1] ?? '';
    const file = join(ROOT, decodeURIComponent(rel));
    if (rel && existsSync(file)) {
      await route.fulfill({ status: 200, contentType: 'image/webp', body: readFileSync(file) });
      return;
    }
    await route.fulfill({ status: 404, body: 'no image' });
  });

  // Vditor 必须 CDN 引入；测试环境按「CDN 不可达」处理（编辑页走 textarea 兜底）
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());

  return {
    puts,
    deletes,
    reset: () => {
      puts.length = 0;
      deletes.length = 0;
    },
  };
}

/** 预置令牌（等价于用户上次勾了「记住」）。 */
export async function seedToken(page: Page, token = 'e2e-token'): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('grphyblog:admin:token', value);
  }, token);
}

/** 走完登录（无预置令牌时）。 */
export async function loginThroughUi(page: Page, token = 'e2e-token'): Promise<void> {
  await page.fill('[data-testid="token-input"]', token);
  await page.click('[data-testid="login-submit"]');
  await page.waitForSelector('[data-testid="pool-grid"]');
}
