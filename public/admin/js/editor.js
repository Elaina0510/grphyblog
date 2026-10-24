// =============================================================================
// editor.js —— 正文编辑器：Vditor（CDN）优先，拉不到就退回原生 textarea
//
// 为什么允许退化：Vditor 是唯一允许的第三方库、必须 CDN 引入（不入库、无构建），
// 于是「CDN 不可达」是必须处理的状态：后台不能因为一个编辑器脚本拿不到就整页不可用。
// 退化后仍是完整的 markdown 文本编辑（后台保存的是原文，不需要渲染器）。
//
// 统一接口（app.js 只认这三件事）：
//   { kind: 'vditor'|'textarea', getValue(), setValue(text), focus() }
// =============================================================================

import { VEDITOR } from './config.js';

/** 已注入的脚本 promise（重复进编辑页不重复拉 CDN）。 */
let scriptPromise = null;

function injectStyle(href) {
  if (document.querySelector(`link[data-vditor="1"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.vditor = '1';
  document.head.append(link);
}

/** 拉 Vditor 脚本；CDN 不通 / 超时 → reject（上层退化）。 */
export function loadVditor(timeoutMs = 6000) {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    injectStyle(VEDITOR.style);
    const script = document.createElement('script');
    script.src = VEDITOR.script;
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Vditor CDN 超时'));
    }, timeoutMs);
    script.onload = () => {
      clearTimeout(timer);
      if (typeof window.Vditor === 'function') resolve(window.Vditor);
      else reject(new Error('Vditor 脚本已加载但没有挂到 window'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Vditor CDN 加载失败'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

/** 原生 textarea 适配器（也是 e2e 的稳定落点：data-testid="body"）。 */
function textareaAdapter(container, value) {
  const note = document.createElement('p');
  note.className = 'fallback-note';
  note.textContent = '富文本编辑器（Vditor）没加载到：现在是纯文本 markdown 模式，保存的内容一样。';
  const area = document.createElement('textarea');
  area.dataset.testid = 'body';
  area.setAttribute('data-testid', 'body');
  area.value = value ?? '';
  area.spellcheck = false;
  container.replaceChildren(note, area);
  return {
    kind: 'textarea',
    getValue: () => area.value,
    setValue: (text) => {
      area.value = text ?? '';
    },
    focus: () => area.focus(),
  };
}

/**
 * 挂载编辑器。
 * @param {HTMLElement} container
 * @param {{value?:string, placeholder?:string}} options
 */
export async function mountEditor(container, { value = '' } = {}) {
  let Vditor;
  try {
    Vditor = await loadVditor();
  } catch {
    return textareaAdapter(container, value);
  }

  return new Promise((resolve) => {
    let instance;
    let settled = false;
    const settle = (adapter) => {
      if (settled) return;
      settled = true;
      resolve(adapter);
    };
    const host = document.createElement('div');
    container.replaceChildren(host);
    try {
      instance = new Vditor(host, {
        mode: 'sv',
        value,
        height: 420,
        cache: { enable: false },
        preview: { hljs: { style: 'native' }, markdown: { toc: false } },
        toolbar: [
          'headings',
          'bold',
          'italic',
          'strike',
          '|',
          'quote',
          'list',
          'ordered-list',
          '|',
          'link',
          'upload',
          '|',
          'undo',
          'redo',
        ],
        after: () => {
          settle({
            kind: 'vditor',
            getValue: () => instance.getValue(),
            setValue: (text) => instance.setValue(text ?? ''),
            focus: () => instance.focus(),
          });
        },
      });
    } catch {
      settle(textareaAdapter(container, value));
    }
    // Vditor 初始化异常时不回调 after：兜一个超时，避免编辑页永远空白
    setTimeout(() => {
      if (!settled) settle(textareaAdapter(container, value));
    }, 8000);
  });
}
