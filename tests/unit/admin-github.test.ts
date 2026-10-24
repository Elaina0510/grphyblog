import { describe, expect, it, vi } from 'vitest';

import {
  GitHubApiError,
  base64ToBytes,
  base64ToText,
  buildContentsUrl,
  buildPutPayload,
  bytesToBase64,
  createGitHubClient,
  describeHttpError,
  parseContentsDir,
  parseContentsFile,
  textToBase64,
} from '../../public/admin/js/github.js';

// =============================================================================
// GitHub Contents API 客户端（public/admin/js/github.js）单测 —— E1 的纯函数层
//
// 只有四类事实要钉住：
//   ① URL / 载荷形状正确（GET 带 ref=main、PUT 带 message+content+branch+sha）；
//   ② base64 编解码对 UTF-8 文本与二进制字节都无损（Contents API 会按行折 base64）；
//   ③ 目录 / 文件响应解析，且错用（把文件当目录）会明确报错；
//   ④ 401/403/404/409/422 的口径与文档排障表一致。
// 全部用注入的 fetchImpl，不打真实网络。
// =============================================================================

const OWNER = 'Elaina0510';
const REPO = 'grphyblog';
const BRANCH = 'main';

/** 造一个最小的 Response 替身（只用到 ok/status/text）。 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('buildContentsUrl', () => {
  it('文件路径 + ref=main（后台所有读都钉在 main）', () => {
    expect(
      buildContentsUrl({ owner: OWNER, repo: REPO, path: 'src/content/pool/photos.meta.json', ref: BRANCH }),
    ).toBe(
      'https://api.github.com/repos/Elaina0510/grphyblog/contents/src/content/pool/photos.meta.json?ref=main',
    );
  });

  it('空路径 = 仓库根；写文件时不带 ref（分支在 body 里）', () => {
    expect(buildContentsUrl({ owner: OWNER, repo: REPO, path: '' })).toBe(
      'https://api.github.com/repos/Elaina0510/grphyblog/contents',
    );
  });

  it('规整前后斜杠与反斜杠，中文/空格逐段编码', () => {
    expect(
      buildContentsUrl({ owner: OWNER, repo: REPO, path: '/src/content/series/城市 光/index.md' }),
    ).toBe(
      'https://api.github.com/repos/Elaina0510/grphyblog/contents/src/content/series/%E5%9F%8E%E5%B8%82%20%E5%85%89/index.md',
    );
    expect(buildContentsUrl({ owner: OWNER, repo: REPO, path: 'a\\b\\c.webp' })).toContain('/contents/a/b/c.webp');
  });
});

describe('base64 编解码', () => {
  it('中文 / emoji / 引号往返无损', () => {
    for (const text of ['晨雾里的第一束光', 'title: "x" · f/1.2', '🙂 混排 abc', '']) {
      expect(base64ToText(textToBase64(text))).toBe(text);
    }
  });

  it('二进制 0..255 全字节往返（图片上传走这条）', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('容忍 API 折行的 base64（GitHub 每 60 字符插一个 \\n）', () => {
    const wrapped = '5Lit5paH\n5YaF5a65\n';
    expect(base64ToText(wrapped)).toBe('中文内容');
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });
});

describe('响应解析', () => {
  it('文件：取 sha / base64 / 文本', () => {
    const file = parseContentsFile({
      type: 'file',
      path: 'src/content/posts/a.md',
      sha: 'abc123',
      size: 42,
      encoding: 'base64',
      content: textToBase64('---\ntitle: 标题\n---\n'),
    });
    expect(file.sha).toBe('abc123');
    expect(file.text).toContain('title: 标题');
    expect(file.size).toBe(42);
  });

  it('目录：解析 JSON 数组，过滤脏元素', () => {
    const items = parseContentsDir([
      { name: 'city-lights', path: 'src/content/series/city-lights', type: 'dir', sha: '1', size: 0 },
      null,
      { name: 'index.md', path: 'src/content/series/city-lights/index.md', type: 'file', sha: '2', size: 9 },
    ]);
    expect(items).toEqual([
      { name: 'city-lights', path: 'src/content/series/city-lights', type: 'dir', sha: '1', size: 0 },
      { name: 'index.md', path: 'src/content/series/city-lights/index.md', type: 'file', sha: '2', size: 9 },
    ]);
  });

  it('把文件当目录解析 / 把目录当文件解析 → 明确报错', () => {
    expect(() => parseContentsDir({ type: 'file' })).toThrow(GitHubApiError);
    expect(() => parseContentsFile([{ name: 'x' }])).toThrow(/不是文件/);
  });
});

describe('PUT 载荷与错误话术', () => {
  it('载荷固定 message + content + branch，覆盖时补 sha', () => {
    expect(buildPutPayload({ message: 'content(series): 测试', content: 'YQ==', branch: BRANCH })).toEqual({
      message: 'content(series): 测试',
      content: 'YQ==',
      branch: 'main',
    });
    expect(buildPutPayload({ message: '', content: 'YQ==', branch: BRANCH, sha: 'abc' })).toEqual({
      message: 'content: 后台保存',
      content: 'YQ==',
      branch: 'main',
      sha: 'abc',
    });
  });

  it('状态码 → 中文排障话术（与 doc/admin-login-setup.md 第 6 节同口径）', () => {
    expect(describeHttpError(401, { message: 'Bad credentials' })).toMatch(/401.*令牌无效/);
    expect(describeHttpError(403, { message: 'Resource not accessible' })).toMatch(/403.*repo/);
    expect(describeHttpError(404, {})).toMatch(/404.*路径不存在/);
    expect(describeHttpError(409, {})).toMatch(/409\/412.*sha/);
    expect(describeHttpError(422, {})).toMatch(/422/);
    expect(describeHttpError(500, { message: 'boom' })).toContain('boom');
  });
});

describe('createGitHubClient（注入 fetch，不打网络）', () => {
  it('readFile：GET + Bearer 头 + ref=main，返回文本与 sha', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        type: 'file',
        path: 'src/content/pool/photos.meta.json',
        sha: 'sha-1',
        size: 2,
        encoding: 'base64',
        content: textToBase64('[]'),
      }),
    );
    const client = createGitHubClient({ token: 'tkn', owner: OWNER, repo: REPO, branch: BRANCH, fetchImpl });
    const file = await client.readFile('src/content/pool/photos.meta.json');

    expect(file.text).toBe('[]');
    expect(file.sha).toBe('sha-1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/repos/Elaina0510/grphyblog/contents/src/content/pool/photos.meta.json?ref=main');
    expect(init.headers.Authorization).toBe('Bearer tkn');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('listDir：GET 目录，解析成数组', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ name: 'city-lights', path: 'src/content/series/city-lights', type: 'dir', sha: '1', size: 0 }]),
    );
    const client = createGitHubClient({ token: 'tkn', owner: OWNER, repo: REPO, fetchImpl });
    const items = await client.listDir('src/content/series');
    expect(items.map((item: { name: string }) => item.name)).toEqual(['city-lights']);
  });

  it('writeFile：PUT + JSON body（message/content/branch），返回新 sha', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: { path: 'src/content/posts/x.md', sha: 'new-sha' }, commit: { sha: 'commit-sha' } }),
    );
    const client = createGitHubClient({ token: 'tkn', owner: OWNER, repo: REPO, fetchImpl });
    const result = await client.writeFile('src/content/posts/x.md', '正文', { message: 'content(posts): 测试' });

    expect(result.sha).toBe('new-sha');
    expect(result.commit).toBe('commit-sha');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).not.toContain('?ref=');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      message: 'content(posts): 测试',
      content: textToBase64('正文'),
      branch: BRANCH,
    });
  });

  it('writeBytes：图片二进制走同一条 PUT', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: { path: 'src/content/pool/photos/a.webp', sha: 's' }, commit: { sha: 'c' } }),
    );
    const client = createGitHubClient({ token: 'tkn', owner: OWNER, repo: REPO, fetchImpl });
    await client.writeBytes('src/content/pool/photos/a.webp', new Uint8Array([1, 2, 3]), { message: 'm' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).content).toBe(bytesToBase64(new Uint8Array([1, 2, 3])));
  });

  it('4xx → GitHubApiError（带 status，供上层区分 sha 冲突）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'sha does not match' }, 409));
    const client = createGitHubClient({ token: 'tkn', owner: OWNER, repo: REPO, fetchImpl });
    await expect(client.writeFile('a.md', 'x', { message: 'm', sha: 'old' })).rejects.toMatchObject({
      name: 'GitHubApiError',
      status: 409,
    });
  });

  it('没有 token 直接拒绝（令牌是唯一凭据，不能裸奔）', () => {
    expect(() => createGitHubClient({ owner: OWNER, repo: REPO })).toThrow(/需要 token/);
  });
});
