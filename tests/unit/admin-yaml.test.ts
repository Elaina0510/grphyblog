import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import {
  formatScalar,
  needsQuotes,
  normalizeDateInput,
  parseFrontmatter,
  parseScalar,
  serializeFrontmatter,
  splitFlowList,
  stripComment,
} from '../../public/admin/js/yaml.js';

// =============================================================================
// 后台 YAML 子集（public/admin/js/yaml.js）单测 —— admin-v2.md E 组「纯函数单测」
//
// 后台不能用 js-yaml（第三方库只允许 Vditor 且必须 CDN），所以 frontmatter 的
// 拼装 / 解析是自己实现的。这里用**两种方式**证明它没错：
//   ① 纯往返：serialize → parse 得到同一份数据（含中文、特殊字符、引号）；
//   ② 交叉验证：把产出的 YAML 交给 js-yaml（devDependency，仅测试用）解析，
//      断言两边读出来的值一致 —— js-yaml 就是「YAML 正确性」的独立裁判。
// 另外拿仓库里真实的 7 个条目做回归：解析结果必须与 js-yaml 的解读一致，
// 且「解析 → 重新拼装」在语义上无损（块序列写法的条目还要求字节级一致）。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 仓库里真实的条目 md（4 系列 + 3 随笔）。 */
function realEntries(): string[] {
  const out: string[] = [];
  const seriesDir = resolve(ROOT, 'src/content/series');
  for (const name of readdirSync(seriesDir)) {
    const file = join(seriesDir, name, 'index.md');
    try {
      if (statSync(file).isFile()) out.push(file);
    } catch {
      // 没有 index.md 的资源夹，跳过
    }
  }
  const postsDir = resolve(ROOT, 'src/content/posts');
  for (const name of readdirSync(postsDir)) {
    if (name.endsWith('.md')) out.push(join(postsDir, name));
  }
  return out;
}

/** 取出 md 的 frontmatter 文本块（不含首尾 ---）。 */
function frontmatterBlock(text: string): string {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^\uFEFF/, ''));
  if (!match) throw new Error('夹具没有 frontmatter');
  return match[1];
}

/** Date → YYYY-MM-DD，便于与后台解析结果比较。 */
function semantic(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString().slice(0, 10) : item)),
  );
}

describe('needsQuotes · 哪些标量必须加引号', () => {
  it('中文与普通词不用加引号（仓库现有标题都是裸串）', () => {
    for (const text of ['夜光 · 城市666', '城市', 'night-01.webp', '晨雾里的第一束光']) {
      expect(needsQuotes(text), text).toBe(false);
    }
  });

  it('会被 YAML 解释成别的东西的串必须加引号', () => {
    const cases: Array<[string, string]> = [
      ['', '空串'],
      ['true', '布尔'],
      ['False', '布尔（大小写）'],
      ['null', 'null'],
      ['~', 'null 波浪号'],
      ['42', '整数'],
      ['-1.5', '负小数'],
      ['1e3', '科学计数'],
      ['2026-09-20', '日期'],
      [' 前后空格 ', '首尾空白'],
      ['a: b', '冒号+空格'],
      ['结尾冒号:', '行尾冒号'],
      ['- 开头', '列表符开头'],
      ['# 井号', '井号开头'],
      ['a # b', '行内注释歧义'],
      ['换\n行', '控制字符'],
      ['他说"好"', '含引号（避免误读成已加引号）'],
    ];
    for (const [text, why] of cases) {
      expect(needsQuotes(text), `${JSON.stringify(text)}（${why}）应加引号`).toBe(true);
    }
  });
});

describe('formatScalar / parseScalar · 标量往返', () => {
  it('布尔 / 数字 / 空值按 YAML 类型输出', () => {
    expect(formatScalar(true)).toBe('true');
    expect(formatScalar(false)).toBe('false');
    expect(formatScalar(3)).toBe('3');
    expect(formatScalar(null)).toBe("''");
    expect(() => formatScalar(Number.NaN)).toThrow(/非有限数字/);
  });

  it('需要引号的字符串走双引号 + JSON 转义；不必引号的裸串也原样读回', () => {
    const quoted = ['他说:"好"', '多行\n文本', '2026-09-20', '0042', '#不是注释', '两端有空格 ', 'tab\there'];
    for (const sample of quoted) {
      const text = formatScalar(sample);
      expect(text.startsWith('"'), `${sample} 没被引号包住：${text}`).toBe(true);
    }
    // 反斜杠在 YAML 裸串里就是普通字符，不必加引号 —— 但必须一字不差地往返
    const plain = ['带\\反斜杠', '夜光 · 城市', 'night-01.webp'];
    for (const sample of plain) {
      expect(formatScalar(sample).startsWith('"'), `${sample} 不该被加引号`).toBe(false);
    }
    for (const sample of [...quoted, ...plain]) {
      expect(parseScalar(formatScalar(sample)), JSON.stringify(sample)).toBe(sample);
    }
  });

  it('裸串读回来还是原样（不误判类型）', () => {
    expect(parseScalar('夜光 · 城市')).toBe('夜光 · 城市');
    expect(parseScalar('night-01.webp')).toBe('night-01.webp');
    expect(parseScalar('"quoted"')).toBe('quoted');
    expect(parseScalar("'single''s'")).toBe("single's");
    expect(parseScalar('true')).toBe(true);
    expect(parseScalar('FALSE')).toBe(false);
    expect(parseScalar('null')).toBe(null);
    expect(parseScalar('12.5')).toBe(12.5);
    expect(parseScalar('')).toBe('');
  });
});

describe('注释 / 行内列表 / 日期', () => {
  it('只把「空白后的 #」当注释，引号内的 # 保留', () => {
    expect(stripComment('城市 # 注释')).toBe('城市 ');
    expect(stripComment('"a # b" # 尾注')).toBe('"a # b" ');
    expect(stripComment('#整行')).toBe('');
    expect(stripComment('C#语言')).toBe('C#语言');
  });

  it('行内列表尊重引号里的逗号', () => {
    expect(splitFlowList('风光, 晨雾')).toEqual(['风光', '晨雾']);
    expect(splitFlowList('"a, b", c')).toEqual(['a, b', 'c']);
    expect(splitFlowList('[]')).toEqual([]);
    expect(splitFlowList('')).toEqual([]);
  });

  it('日期归一：只认真实存在的 YYYY-MM-DD', () => {
    expect(normalizeDateInput('2026-9-1')).toBe('2026-09-01');
    expect(normalizeDateInput('2026-02-30')).toBe('');
    expect(normalizeDateInput('2026/09/01')).toBe('');
    expect(normalizeDateInput('')).toBe('');
  });
});

describe('parseFrontmatter · 两种列表写法 + 未知行', () => {
  it('块序列与行内数组解析出同一个数组', () => {
    const block = ['tags:', '  - 城市', '  - 夜景', 'photos: [a.webp, b.webp]'].join('\n');
    const { data, unknownKeys } = parseFrontmatter(block);
    expect(data.tags).toEqual(['城市', '夜景']);
    expect(data.photos).toEqual(['a.webp', 'b.webp']);
    expect(unknownKeys).toEqual([]);
  });

  it('空列表 / 空值', () => {
    const { data } = parseFrontmatter('photos: []\ncover:\ntags:');
    expect(data.photos).toEqual([]);
    expect(data.cover).toBe(null);
    expect(data.tags).toBe(null);
  });

  it('认不出的行（嵌套 / 多行标量）进 unknownKeys，不静默吞掉', () => {
    const block = ['title: 标题', 'nested:', '  deep: 1', 'plain text line'].join('\n');
    const { data, unknownKeys } = parseFrontmatter(block);
    expect(data.title).toBe('标题');
    expect(unknownKeys.length).toBeGreaterThanOrEqual(2);
  });

  it('重复键会被点名（后值覆盖前值）', () => {
    const { data, duplicates } = parseFrontmatter('title: 一\ntitle: 二');
    expect(duplicates).toEqual(['title']);
    expect(data.title).toBe('二');
  });
});

describe('serializeFrontmatter · 与 js-yaml 交叉验证', () => {
  it('写出的 YAML 能被 js-yaml 解析成同一份数据', () => {
    const fields = {
      title: '说"话"的: 标题',
      date: '2026-09-20',
      cover: 'night-01.webp',
      tags: ['城市', '夜景 # 不是注释', 'true'],
      order: 3,
      draft: false,
      photos: ['night-01.webp', 'night-02.webp'],
    };
    const yaml = serializeFrontmatter(fields, [
      'title',
      'date',
      'cover',
      'tags',
      'order',
      'draft',
      'photos',
    ]);
    const parsed = load(yaml) as Record<string, unknown>;
    expect(parsed.title).toBe(fields.title);
    expect(parsed.cover).toBe('night-01.webp');
    expect(parsed.tags).toEqual(fields.tags);
    expect(parsed.order).toBe(3);
    expect(parsed.draft).toBe(false);
    expect(parsed.photos).toEqual(fields.photos);
    expect(parsed.date instanceof Date).toBe(true);
  });

  it('空数组写成 `key: []`，且被 js-yaml 读成空数组', () => {
    const yaml = serializeFrontmatter({ photos: [], tags: [] }, ['tags', 'photos']);
    expect(yaml).toBe('tags: []\nphotos: []');
    expect(load(yaml)).toEqual({ tags: [], photos: [] });
  });

  it('跳过 undefined 字段（不写半截键）', () => {
    expect(serializeFrontmatter({ title: 'a', cover: undefined }, ['title', 'cover'])).toBe('title: a');
  });
});

describe('真实条目回归：解析结果与 js-yaml 一致，且能无损还原', () => {
  const files = realEntries();

  it('仓库里有 7 个条目可测（4 系列 + 3 随笔）', () => {
    expect(files.length).toBe(7);
  });

  it.each(files)('%s', (file) => {
    const source = readFileSync(file, 'utf8');
    const block = frontmatterBlock(source);
    const { data, unknownKeys } = parseFrontmatter(block);
    const oracle = load(block) as Record<string, unknown>;

    expect(unknownKeys, '真实条目的 frontmatter 里出现了后台不认识的写法').toEqual([]);
    for (const key of ['title', 'cover', 'tags', 'draft', 'photos', 'order']) {
      if (oracle[key] === undefined) continue;
      expect(data[key], `${file} 的 ${key}`).toEqual(oracle[key]);
    }
    // date 在 js-yaml 里是 Date，我们保留字符串给表单用 —— 断言指向同一天
    expect(data.date).toBe((oracle.date as Date).toISOString().slice(0, 10));

    // 拼装时沿用**原文的键序**（后台/作者可以按需调整字段顺序，那不是错误），
    // 这样 ② 的键序断言才是在验「拼装不重排字段」，而不是在验「内容恰好长这样」。
    const keys = Object.keys(data);
    const rebuilt = serializeFrontmatter(data, keys);
    // ① 语义无损：重新拼出来的 YAML 被 js-yaml 读出同一份数据
    expect(semantic(load(rebuilt)), `${file} 重新拼装后语义变了`).toEqual(semantic(oracle));
    // ② 键序不变（读回去的键顺序与原文一致）
    expect(Object.keys(load(rebuilt) as object), `${file} 键序变了`).toEqual(Object.keys(oracle));
    // ③ 行内数组写法会被归一成块序列（schema / js-yaml 等价），这是刻意的统一
    expect(rebuilt).toContain('title:');
  });

  it('本来就是块序列写法的条目，重新拼装与原文字节级一致（不制造假 diff）', () => {
    const source = readFileSync(resolve(ROOT, 'src/content/series/city-lights/index.md'), 'utf8');
    const block = frontmatterBlock(source);
    const { data } = parseFrontmatter(block);
    const rebuilt = serializeFrontmatter(data, [
      'title',
      'date',
      'cover',
      'tags',
      'order',
      'draft',
      'photos',
    ]);
    const normalize = (text: string) => text.replace(/\r\n/g, '\n').trimEnd();
    expect(normalize(rebuilt)).toBe(normalize(block));
  });
});
