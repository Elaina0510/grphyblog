// =============================================================================
// storage.js —— 令牌的存放（勾「记住」进 localStorage，否则只在当前标签页的 sessionStorage）
//
// 红线（由后台的「退役契约」单测做令牌扫描 + 本模块的注入式设计共同守住）：
//   · 令牌**只**活在浏览器；仓库里任何文件都不许出现令牌字面量；
//   · 这里不 import 任何东西、不在模块顶层碰 window —— 单测可以直接传假 storage。
//
// 只存一个键：TOKEN_KEY。退出 = 两个 storage 都清掉（避免「勾了记住又勾掉」留下残影）。
// =============================================================================

import { TOKEN_KEY } from './config.js';

/**
 * 读令牌。localStorage 优先（记住过），其次 sessionStorage（本次标签页）。
 * 存储不可用（隐私模式 / 被禁用）时静默返回空串 —— 后台仍能用手动粘贴的方式工作。
 */
export function readToken(local, session) {
  for (const store of [local, session]) {
    try {
      const value = store?.getItem?.(TOKEN_KEY);
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // 存储被禁用：当作没有令牌
    }
  }
  return '';
}

/** 写令牌：remember=true 进 localStorage 并清掉 sessionStorage 的副本；否则反过来。 */
export function writeToken(token, remember, local, session) {
  const value = String(token ?? '').trim();
  clearToken(local, session);
  if (!value) return '';
  try {
    if (remember) local?.setItem?.(TOKEN_KEY, value);
    else session?.setItem?.(TOKEN_KEY, value);
  } catch {
    // 存储写不进去也不影响本次会话（内存里已经有一份）
  }
  return value;
}

/** 清令牌（退出）。 */
export function clearToken(local, session) {
  for (const store of [local, session]) {
    try {
      store?.removeItem?.(TOKEN_KEY);
    } catch {
      // 忽略
    }
  }
}

/**
 * 面向 app.js 的门面：把 window 的存储注入进来，其余保持纯函数。
 * @param {{local?: Storage, session?: Storage}} stores
 */
export function createTokenStore({ local, session } = {}) {
  return {
    read: () => readToken(local, session),
    save: (token, remember) => writeToken(token, remember, local, session),
    clear: () => clearToken(local, session),
  };
}

export default createTokenStore;
