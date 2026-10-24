// =============================================================================
// github.js —— GitHub Contents API 客户端（纯逻辑 + 一层 fetch 包装）
//
// 后台与仓库之间只有这一个接口族：
//   GET  /repos/{owner}/{repo}/contents/{path}?ref=main   读文件 / 列目录
//   PUT  /repos/{owner}/{repo}/contents/{path}            写文件（一条 commit）
// 没有 OAuth、没有代理、没有后端：令牌就是全部凭据，只从浏览器内存 / localStorage 来。
//
// 拆法（为了可单测）：URL 构造、响应解析、base64 编解码、PUT 载荷、错误话术
// 全部是纯函数；createGitHubClient 只负责把它们接到 fetch 上。
//
// 单测：tests/unit/admin-github.test.ts（含 UTF-8 / 二进制 base64 往返、目录 JSON 解析、
// 错误码话术；不打真实网络）。
// =============================================================================

import { API_BASE } from './config.js';

/** GitHub 返回体里 base64 的换行（Contents API 会按 60 字符折行）。 */
const BASE64_LINE_BREAKS = /[\r\n\s]+/g;

/** 一次 API 失败：带 HTTP 状态码，上层据此给中文提示、并区分 409 冲突要重读。 */
export class GitHubApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.body = body;
  }
}

/** 拼 Contents API 的 URL（path 为空 = 仓库根）。 */
export function buildContentsUrl({ owner, repo, path = '', ref, apiBase = API_BASE } = {}) {
  const clean = String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const encoded = clean
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const base = `${String(apiBase).replace(/\/+$/, '')}/repos/${owner}/${repo}/contents`;
  const url = encoded ? `${base}/${encoded}` : base;
  return ref ? `${url}?ref=${encodeURIComponent(ref)}` : url;
}

/** Uint8Array → base64（分块，避免大图时 `String.fromCharCode(...)` 撑爆调用栈）。 */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 → Uint8Array（忽略 API 折行产生的空白）。 */
export function base64ToBytes(base64) {
  const clean = String(base64 ?? '').replace(BASE64_LINE_BREAKS, '');
  if (!clean) return new Uint8Array(0);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 文本 → base64（先按 UTF-8 编码，中文标题才不会坏）。 */
export function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(String(text ?? '')));
}

/** base64 → 文本（UTF-8 解码）。 */
export function base64ToText(base64) {
  return new TextDecoder('utf-8').decode(base64ToBytes(base64));
}

/**
 * 解析 `GET contents/<file>` 的返回：取 sha（PUT 要用）、base64 正文与文本。
 * 目录返回（数组）在这里是错用，抛给调用方。
 */
export function parseContentsFile(json) {
  if (!json || Array.isArray(json) || json.type !== 'file') {
    throw new GitHubApiError('这个路径不是文件（可能是个目录）', 0, json);
  }
  const base64 = String(json.content ?? '');
  return {
    path: String(json.path ?? ''),
    sha: String(json.sha ?? ''),
    size: Number(json.size ?? 0),
    base64,
    text: base64 ? base64ToText(base64) : '',
  };
}

/**
 * 解析 `GET contents/<dir>` 的返回（JSON 数组）→ `{name, path, type, sha, size}`。
 * 目录为空时 GitHub 返回 404，由调用方按「空目录」处理；这里只认数组。
 */
export function parseContentsDir(json) {
  if (!Array.isArray(json)) {
    throw new GitHubApiError('这个路径不是目录（可能是个文件）', 0, json);
  }
  return json
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name ?? ''),
      path: String(item.path ?? ''),
      type: String(item.type ?? ''),
      sha: String(item.sha ?? ''),
      size: Number(item.size ?? 0),
    }));
}

/** PUT 的请求体：message（commit 说明）+ content（base64）+ branch（+ 覆盖时的 sha）。 */
export function buildPutPayload({ message, content, branch, sha }) {
  const payload = {
    message: String(message ?? '').trim() || 'content: 后台保存',
    content: String(content ?? ''),
    branch,
  };
  if (sha) payload.sha = String(sha);
  return payload;
}

/** HTTP 状态码 → 面向使用者的中文话术（排障表 doc/admin-login-setup.md 第 6 节同口径）。 */
export function describeHttpError(status, body) {
  const detail = body && typeof body === 'object' ? String(body.message ?? '') : '';
  const suffix = detail ? `（GitHub 原话：${detail}）` : '';
  switch (status) {
    case 401:
      return `401 令牌无效或已过期：回文档第 2 节重新生成一个，整串粘贴${suffix}`;
    case 403:
      return `403 令牌没有这个仓库的写权限（或触发了限流）：确认令牌勾了 repo、账号是仓库属主${suffix}`;
    case 404:
      return `404 路径不存在，或令牌无权访问这个仓库${suffix}`;
    case 409:
    case 412:
      return `409/412 sha 不匹配：你编辑这段时间里文件被改过，刷新重读后再保存${suffix}`;
    case 422:
      return `422 请求被拒（常见于 sha 过期或路径非法）：刷新重读后再试${suffix}`;
    default:
      return `请求失败（HTTP ${status}）${suffix}`;
  }
}

/** 读一段响应体文本并按 JSON 解析（失败给空对象，不让解析错误盖掉真正的 HTTP 错误）。 */
async function readJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/**
 * 建客户端。fetchImpl 可注入（单测 / e2e 都不打真实网络）。
 *
 * 返回的方法都只做「一个 HTTP 往返 + 解析」，业务编排在 api.js：
 *   readFile(path)  → {path, sha, text, base64, size}
 *   readBytes(path) → Uint8Array（读二进制，例如把池里的图取回来做兜底预览）
 *   writeFile(path, text, {message, sha}) → {sha, path}
 *   writeBytes(path, bytes, {message, sha})
 *   listDir(path)   → [{name, path, type, sha, size}]
 */
export function createGitHubClient({
  token,
  owner,
  repo,
  branch = 'main',
  apiBase = API_BASE,
  fetchImpl,
  userAgent = 'grphyblog-admin',
} = {}) {
  if (!token) throw new TypeError('createGitHubClient 需要 token');
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));

  async function request(url, init = {}) {
    const response = await doFetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await readJson(response);
      throw new GitHubApiError(describeHttpError(response.status, body), response.status, body);
    }
    return readJson(response);
  }

  async function readFile(path) {
    const json = await request(buildContentsUrl({ owner, repo, path, ref: branch, apiBase }));
    return parseContentsFile(json);
  }

  async function readBytes(path) {
    const file = await readFile(path);
    return base64ToBytes(file.base64);
  }

  async function listDir(path) {
    const json = await request(buildContentsUrl({ owner, repo, path, ref: branch, apiBase }));
    return parseContentsDir(json);
  }

  async function put(path, contentBase64, { message, sha } = {}) {
    const json = await request(buildContentsUrl({ owner, repo, path, apiBase }), {
      method: 'PUT',
      body: JSON.stringify(buildPutPayload({ message, content: contentBase64, branch, sha })),
    });
    return {
      path: String(json?.content?.path ?? path),
      sha: String(json?.content?.sha ?? ''),
      commit: String(json?.commit?.sha ?? ''),
    };
  }

  return {
    owner,
    repo,
    branch,
    readFile,
    readBytes,
    listDir,
    writeFile: (path, text, options) => put(path, textToBase64(text), options),
    writeBytes: (path, bytes, options) => put(path, bytesToBase64(bytes), options),
  };
}

export default createGitHubClient;
