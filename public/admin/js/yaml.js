// =============================================================================
// yaml.js —— frontmatter 的 YAML 子集：拼装 + 解析（纯函数，零依赖）
//
// 为什么手写而不用库：后台是纯静态页，第三方库只允许 Vditor（且必须 CDN），
// 而 js-yaml 这类解析器一旦 CDN 挂了整页就废。我们只需要 frontmatter 那一小块
// YAML（顶层 mapping + 标量 + 标量列表），写出一个**可单测、可被 js-yaml 交叉验证**
// 的子集实现，比引库更可控。
//
// 支持（足够覆盖 src/content/schemas.ts 的全部字段）：
//   key: 标量             —— 裸串 / 单引号 / 双引号（JSON 转义）/ true / false / 数字 / null
//   key: [a, b]           —— 行内列表（迁移期就有的写法，要能读回来）
//   key:
//     - a                 —— 块序列（仓库现有条目的写法，写出去也用它）
//
// 不支持（也不需要）：嵌套 mapping、多行折叠标量、anchor/alias、注释保留。
// 遇到认不出的行不抛错，收进 unknownKeys 交给上层提示——后台只改已知字段，
// 静默吞掉未知字段比报错更危险，所以 parse 必须把这件事说出来。
//
// 单测：tests/unit/admin-yaml.test.ts（含 js-yaml 往返交叉验证 + Astro schema 验收）。
// =============================================================================

/** YAML 里会被解释成别的东西的裸串（必须加引号才保持字符串语义）。 */
const RESERVED_SCALARS = /^(?:true|false|null|~|yes|no|on|off|y|n)$/i;

/** 数字形状（含科学计数法）；YAML 会把它们读成 number，所以字符串形态必须加引号。 */
const NUMBER_SHAPED = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/** 日期形状（YAML 时间戳）；同理加引号，免得字符串变成 Date。 */
const DATE_SHAPED = /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ].*)?$/;

/** 控制字符（含换行、制表）——不能裸出。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 标量是否需要加引号。
 *
 * 判定分四类：空串、首尾空白/控制字符、YAML 指示符开头、语义歧义（布尔/数字/日期/null）、
 * 以及裸串里出现的 `: `（键值分隔歧义）与行尾 `:`。
 */
export function needsQuotes(text) {
  const value = String(text ?? '');
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true;
  if (CONTROL_CHARS.test(value)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  // 引号出现在裸串里虽然合法，但容易让人误读成已加引号；统一加引号，读回来仍是同一串
  if (/["']/.test(value)) return true;
  if (/:\s/.test(value) || value.endsWith(':')) return true;
  if (/\s#/.test(value)) return true;
  if (RESERVED_SCALARS.test(value)) return true;
  if (NUMBER_SHAPED.test(value)) return true;
  if (DATE_SHAPED.test(value)) return true;
  return false;
}

/**
 * 标量 → YAML 文本。需要引号时统一用双引号 + JSON 转义
 * （JSON 的转义序列是 YAML 双引号标量的合法子集，js-yaml 逐字读回）。
 */
export function formatScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`frontmatter 不接受非有限数字：${value}`);
    return String(value);
  }
  if (value === null || value === undefined) return "''";
  const text = String(value);
  // 空串写成 `''`（与仓库现有条目的封面写法一致，diff 才不会因为引号风格而红）
  if (text === '') return "''";
  return needsQuotes(text) ? JSON.stringify(text) : text;
}

/** 去掉行尾注释（引号内的 `#` 不算注释；`#` 前必须有空白才是 YAML 注释）。 */
export function stripComment(raw) {
  const text = String(raw ?? '');
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

/** 标量文本 → JS 值（裸串 / 引号串 / 布尔 / null / 数字；认不出的一律当字符串）。 */
export function parseScalar(raw) {
  const token = String(raw ?? '').trim();
  if (token === '') return '';
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    try {
      return JSON.parse(token);
    } catch {
      return token.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(?:true|false)$/i.test(token)) return token.toLowerCase() === 'true';
  if (/^(?:null|~)$/i.test(token)) return null;
  if (NUMBER_SHAPED.test(token)) return Number(token);
  return token;
}

/** 行内列表 `[a, b]` 的内部分割（尊重引号，逗号在引号内不分割）。 */
export function splitFlowList(inner) {
  // 直接传整段 `[a, b]` 也认（parseFrontmatter 内部传的是已剥掉方括号的片段）
  const text = String(inner ?? '').trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!text) return [];
  const items = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        if (i + 1 < text.length) {
          current += text[i + 1];
          i += 1;
        }
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(current);
  return items.map((item) => parseScalar(item)).filter((item) => item !== '');
}

/**
 * frontmatter 文本块（不含首尾 `---`）→ `{ data, unknownKeys, duplicates }`。
 *
 * 只做本后台需要的那一小块 YAML：顶层 key、标量、块序列、行内列表。
 * 认不出的行（嵌套、多行标量）收进 unknownKeys —— 上层据此提示「这条目里有后台不认识
 * 的字段，保存会丢」，而不是假装一切正常。
 */
export function parseFrontmatter(block) {
  const data = {};
  const unknownKeys = [];
  const duplicates = [];
  const lines = String(block ?? '').split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*#/.test(line)) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      unknownKeys.push(line.trim());
      continue;
    }

    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(data, key)) duplicates.push(key);
    const rest = stripComment(match[2]).trim();

    if (rest === '') {
      // 块序列：紧随其后的 `- item` 行；遇到第一个非列表行即结束
      const items = [];
      let cursor = i + 1;
      for (; cursor < lines.length; cursor += 1) {
        const item = /^\s*-\s?(.*)$/.exec(lines[cursor]);
        if (!item) break;
        const value = parseScalar(stripComment(item[1]));
        if (value !== '') items.push(value);
      }
      data[key] = items.length > 0 ? items : null;
      i = cursor - 1;
      continue;
    }

    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) {
        unknownKeys.push(line.trim());
        continue;
      }
      data[key] = splitFlowList(rest.slice(1, -1));
      continue;
    }

    data[key] = parseScalar(rest);
  }

  return { data, unknownKeys, duplicates };
}

/**
 * 按固定键序拼 frontmatter 文本块（不含 `---`）。
 *
 * @param {Record<string, unknown>} fields 已归一的字段（string / number / boolean / string[]）
 * @param {string[]} keys 输出键序（collection 决定；与仓库现有 md 的书写顺序一致）
 */
export function serializeFrontmatter(fields, keys) {
  const lines = [];
  for (const key of keys) {
    const value = fields[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${formatScalar(item)}`);
      continue;
    }
    if (key === 'date') {
      // 日期一律裸出 YYYY-MM-DD：zod 的 z.coerce.date() 与 js-yaml 都认这个形
      lines.push(`${key}: ${String(value)}`);
      continue;
    }
    lines.push(`${key}: ${formatScalar(value)}`);
  }
  return lines.join('\n');
}

/**
 * 把任意用户输入归一成 `YYYY-MM-DD`（失败返回空串，让校验层报错而不是偷偷换成今天）。
 */
export function normalizeDateInput(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) return '';
  const [, year, month, day] = match;
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  const probe = new Date(`${year}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(probe.getTime())) return '';
  if (probe.toISOString().slice(0, 10) !== `${year}-${mm}-${dd}`) return '';
  return `${year}-${mm}-${dd}`;
}

export default { parseFrontmatter, serializeFrontmatter, needsQuotes, formatScalar, parseScalar };
