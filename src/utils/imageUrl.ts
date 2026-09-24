// =============================================================================
// imageUrl —— 全站图片 URL 的「唯一出口」（design §3 边界③）
//
// 目标：本地开发与未来整体迁移到 R2 / 图床，只改这一个 base（本文件或一个环境变量），
// 组件里不出现任何手写的图片绝对/相对前缀。
//
// 这是一个「不依赖 Astro 运行时的纯函数」：给定 path 与可选 base，产出最终 URL 字符串，
// 便于在 Node 环境下直接单测（本地路径拼接 + base 可切换）。
//
// 真实资源 URL 由调用方传入后再交本函数统一加 base：
//   - 内容相对路径（经 contentImages 解析成构建期可服务 URL 后）；
//   - 或 Astro image()/glob ?url 得到的 "/_astro/xxx.webp"；
//   - 或已经是绝对的 http(s) 链接（原样返回）。
// =============================================================================

/** 绝对 URL：以 http:// 或 https:// 开头（大小写不敏感）。 */
const ABSOLUTE_URL = /^https?:\/\//i;

export interface ImageUrlOptions {
  /**
   * 前缀 base。省略时回落到 `import.meta.env.PUBLIC_IMAGE_BASE`，
   * 再省略则取同源根 '/'。迁移图床时只需改这一处来源。
   */
  base?: string;
}

/**
 * 读取默认 base。
 * 首选 `import.meta.env.PUBLIC_IMAGE_BASE`（Astro 构建期从 .env / 进程环境注入 PUBLIC_ 变量的正典通道）；
 * 再兜底 `process.env.PUBLIC_IMAGE_BASE`：纯静态站的 imageUrl 在构建期（Node 侧）被调用，
 * 该兜底让「同一个 base 开关」在 Node/CI 与单测里也可用，且不引入第二处配置来源
 * （仍是同一个 PUBLIC_IMAGE_BASE 变量名，只是环境读取路径）。浏览器包里 process 不存在时自动跳过。
 */
function readEnvBase(): string | undefined {
  const metaEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const fromMeta = metaEnv?.PUBLIC_IMAGE_BASE;
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromProc = proc?.env?.PUBLIC_IMAGE_BASE;
  return typeof fromProc === 'string' && fromProc.length > 0 ? fromProc : undefined;
}

/**
 * 把 base 与相对 path 拼接成最终 URL，规整多余的斜杠：
 *  - base 结尾与 path 开头的斜杠合并为单个 '/'；
 *  - base 为同源根 '/' 时退化为以单个 '/' 打头的路径。
 */
function joinBase(base: string, path: string): string {
  const cleanPath = path.replace(/^\/+/, '');
  // 去掉 base 末尾的斜杠后决定分隔符，避免 '//example//path' 之类。
  const trimmed = base.replace(/\/+$/, '');
  if (trimmed === '') {
    // base 本质是同源根：结果恒以单个 '/' 开头。
    return '/' + cleanPath;
  }
  return trimmed + '/' + cleanPath;
}

/**
 * 全站图片 URL 唯一生成函数。
 *
 * @param path  图片路径：绝对 http(s) URL 或（相对/绝对站点）路径。
 * @param opts  可选 { base }，覆盖默认 base。
 * @returns     最终 URL 字符串。
 *
 * 规则：
 *  1. `path` 已是绝对 URL（http/https）→ 原样返回，绝不加 base。
 *  2. 否则用 base 前缀拼接并规整斜杠；base 优先级：opts.base > env PUBLIC_IMAGE_BASE > '/'。
 */
export function imageUrl(path: string, opts: ImageUrlOptions = {}): string {
  if (typeof path !== 'string' || path.length === 0) {
    return path as string;
  }
  if (ABSOLUTE_URL.test(path)) {
    return path;
  }
  const base = opts.base ?? readEnvBase() ?? '/';
  return joinBase(base, path);
}

export default imageUrl;
