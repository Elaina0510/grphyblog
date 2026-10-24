import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { postsSchema, seriesSchema } from '../../src/content/schemas';
import {
  POSTS_KEYS,
  SERIES_KEYS,
  buildEntryMarkdown,
  commitMessage,
  detectEol,
  illustrationSnippet,
  isValidSlug,
  slugFromTitle,
  keysOf,
  normalizeFields,
  parseEntryMarkdown,
  postEntryPath,
  postFileName,
  postSlugOf,
  seriesEntryPath,
  validateFields,
} from '../../public/admin/js/markdown.js';

// =============================================================================
// 后台条目拼装 / 拆解（public/admin/js/markdown.js）单测 —— E4/E5 的纯函数层
//
// 三件事必须钉死：
//   ① 拼出来的 frontmatter 能过 Astro 的 zod（.strict()：多一个键就崩）；
//   ② photos 数组的**顺序**就是前台照片流顺序，序列化 / 反序列化都不能重排；
//   ③ 编辑现有文件时行尾（CRLF）与正文保持原样，别制造假 diff。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 取出 md 的 frontmatter 文本块。 */
function frontmatterBlock(md: string): string {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(md.replace(/^\uFEFF/, ''));
  if (!match) throw new Error('没有 frontmatter');
  return match[1];
}

const seriesFields = {
  title: '夜光 · 城市',
  date: '2026-09-20',
  cover: 'night-02.webp',
  tags: ['城市', '夜景'],
  order: 3,
  draft: false,
  photos: ['night-02.webp', 'night-01.webp'],
};

describe('buildEntryMarkdown · 结构与键序', () => {
  it('系列：frontmatter 键序与仓库现有条目一致', () => {
    const md = buildEntryMarkdown({ collection: 'series', fields: seriesFields, body: '正文一段。' });
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: 夜光 · 城市\ndate: 2026-09-20\ncover: night-02.webp\ntags:\n  - 城市\n  - 夜景\norder: 3\ndraft: false\nphotos:\n  - night-02.webp\n  - night-01.webp');
    expect(md.endsWith('---\n\n正文一段。\n')).toBe(true);
  });

  it('随笔：没有 order 键（schema 里也没有）', () => {
    const md = buildEntryMarkdown({
      collection: 'posts',
      fields: { title: '晨雾', date: '2026-09-21', cover: '', tags: ['风光'], draft: false, photos: [] },
      body: '字。',
    });
    expect(md).toContain("cover: ''");
    expect(md).toContain('tags:\n  - 风光');
    expect(md).toContain('photos: []');
    expect(md).not.toContain('order:');
  });

  it('photos 顺序原样落盘（拖拽顺序 = 数组顺序 = 文件顺序）', () => {
    const md = buildEntryMarkdown({ collection: 'series', fields: seriesFields, body: '' });
    const photosBlock = /photos:\n((?:  - .*\n?)+)/.exec(md);
    expect(photosBlock?.[1].split('\n').filter(Boolean)).toEqual(['  - night-02.webp', '  - night-01.webp']);
  });

  it('中文标题里的冒号 / 引号被正确加引号，且 js-yaml 读得回来', () => {
    const fields = { ...seriesFields, title: '他说:"夜光" 很好' };
    const md = buildEntryMarkdown({ collection: 'series', fields, body: '' });
    const parsed = load(frontmatterBlock(md)) as Record<string, unknown>;
    expect(parsed.title).toBe('他说:"夜光" 很好');
  });

  it('正文首尾空白被裁掉，末尾恰好一个换行', () => {
    const md = buildEntryMarkdown({
      collection: 'posts',
      fields: { title: 't', date: '2026-01-01', cover: '', tags: [], draft: false, photos: [] },
      body: '\n\n  第一行  \n第二行\n\n\n',
    });
    // 行首缩进是 markdown 语义（缩进代码块），只裁行尾空白与首尾空行
    expect(md.endsWith('---\n\n  第一行\n第二行\n')).toBe(true);
  });

  it('CRLF：编辑现有文件时按原文行尾写回', () => {
    const md = buildEntryMarkdown({
      collection: 'series',
      fields: seriesFields,
      body: '第一行\n第二行',
      eol: '\r\n',
    });
    expect(md.split('\r\n').length).toBeGreaterThan(5);
    expect(/[^\r]\n/.test(md), '出现裸 LF：行尾没统一').toBe(false);
  });
});

describe('parseEntryMarkdown · 往返', () => {
  it('parse(build(x)) 得到同一份字段与正文', () => {
    const body = '第一段\n\n![晨雾](photo:night-01.webp)\n\n第二段';
    const md = buildEntryMarkdown({ collection: 'series', fields: seriesFields, body });
    const parsed = parseEntryMarkdown(md, 'series');
    expect(parsed.fields).toEqual(seriesFields);
    expect(parsed.body).toBe(body);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.unknownKeys).toEqual([]);
  });

  it('真实条目：解析 → 重新拼装 → 再解析，字段稳定', () => {
    for (const rel of [
      'src/content/series/city-lights/index.md',
      'src/content/series/wip-empty/index.md',
      'src/content/posts/2026-09-21-morning-fog.md',
      'src/content/posts/2026-07-02-alley-light.md',
    ]) {
      const source = readFileSync(resolve(ROOT, rel), 'utf8');
      const collection = rel.includes('/series/') ? 'series' : 'posts';
      const first = parseEntryMarkdown(source, collection);
      const rebuilt = buildEntryMarkdown({
        collection,
        fields: first.fields,
        body: first.body,
        eol: first.eol,
      });
      const second = parseEntryMarkdown(rebuilt, collection);
      expect(second.fields, rel).toEqual(first.fields);
      expect(second.body, rel).toBe(first.body);
    }
  });

  it('行内数组写法（tags: [风光, 晨雾]）读得回来', () => {
    const parsed = parseEntryMarkdown(
      '---\ntitle: t\ndate: 2026-09-21\ncover: \'\'\ntags: [风光, 晨雾]\ndraft: false\nphotos: [dawn-01.webp]\n---\n\n正文\n',
      'posts',
    );
    expect(parsed.fields.tags).toEqual(['风光', '晨雾']);
    expect(parsed.fields.photos).toEqual(['dawn-01.webp']);
    expect(parsed.body).toBe('正文');
  });

  it('未知键会被点名（不会静默丢字段）', () => {
    const parsed = parseEntryMarkdown(
      '---\ntitle: t\ndate: 2026-09-21\ncover: \'\'\ntags: []\ndraft: false\nphotos: []\nslug: legacy\n---\n\n',
      'posts',
    );
    expect(parsed.unknownKeys.join('\n')).toContain('slug');
  });

  it('没有 frontmatter 的文件不炸：整份当正文', () => {
    const parsed = parseEntryMarkdown('就是一段字。', 'posts');
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.body).toBe('就是一段字。');
    expect(parsed.fields.photos).toEqual([]);
  });

  it('行尾识别：CRLF 优先', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
  });
});

describe('产出的 frontmatter 必须过 Astro 的 zod schema', () => {
  it('系列通过 seriesSchema（.strict()：多一个键就崩）', () => {
    const md = buildEntryMarkdown({ collection: 'series', fields: seriesFields, body: '' });
    const data = load(frontmatterBlock(md)) as Record<string, unknown>;
    const result = seriesSchema.safeParse(data);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('随笔通过 postsSchema', () => {
    const md = buildEntryMarkdown({
      collection: 'posts',
      fields: { title: '晨雾', date: '2026-09-21', cover: 'dawn-01.webp', tags: [], draft: true, photos: ['dawn-01.webp'] },
      body: '正文',
    });
    const data = load(frontmatterBlock(md)) as Record<string, unknown>;
    expect(postsSchema.safeParse(data).success).toBe(true);
  });

  it('空 cover + 空 photos 合法（K1 的两个坏封面条目就是这种形态）', () => {
    const md = buildEntryMarkdown({
      collection: 'series',
      fields: { title: '留白', date: '2026-07-01', cover: '', tags: [], order: 1, draft: false, photos: [] },
      body: '',
    });
    const data = load(frontmatterBlock(md)) as Record<string, unknown>;
    expect(seriesSchema.safeParse(data).success).toBe(true);
  });
});

describe('normalizeFields / validateFields', () => {
  it('标签支持中文逗号与首尾空白，空项被丢掉', () => {
    const fields = normalizeFields({ title: ' t ', date: '2026-9-1', tags: '城市， 夜景 ,, ' }, 'posts');
    expect(fields.title).toBe('t');
    expect(fields.date).toBe('2026-09-01');
    expect(fields.tags).toEqual(['城市', '夜景']);
  });

  it('缺标题 / 日期不合法 / 封面不在已选照片里 / 照片不在池里 → 逐条报错', () => {
    const fields = normalizeFields(
      { title: '', date: '2026-13-01', cover: 'ghost.webp', photos: ['night-01.webp'] },
      'series',
    );
    const errors = validateFields(fields, { collection: 'series', poolIds: ['night-01.webp'] });
    const text = errors.join('\n');
    expect(text).toContain('标题不能为空');
    expect(text).toContain('日期需为 YYYY-MM-DD');
    expect(text).toContain('封面必须是已勾选照片里的一张');
    // 池校验是独立一条：勾了池里没有的 ID 时也要报
    const poolErrors = validateFields(
      normalizeFields({ title: 'a', date: '2026-01-01', photos: ['ghost.webp'] }, 'posts'),
      { collection: 'posts', poolIds: ['night-01.webp'] },
    );
    expect(poolErrors.join('\n')).toContain('照片不在池中：ghost.webp');
  });

  it('正常字段零报错；封面留空也合法', () => {
    expect(validateFields(normalizeFields(seriesFields, 'series'), { collection: 'series' })).toEqual([]);
    expect(
      validateFields(
        normalizeFields({ title: 'a', date: '2026-01-01', cover: '', photos: [] }, 'posts'),
        { collection: 'posts', poolIds: [] },
      ),
    ).toEqual([]);
  });

  it('未知 collection 直接抛错（防写错 schema）', () => {
    expect(() => normalizeFields({}, 'notes' as unknown as 'posts')).toThrow(/未知 collection/);
    expect(() => keysOf('notes' as unknown as 'posts')).not.toThrow();
    expect(keysOf('series')).toBe(SERIES_KEYS);
    expect(keysOf('posts')).toBe(POSTS_KEYS);
  });
});

describe('路径 / 文件名 / 提交信息', () => {
  it('系列路径 = series/<slug>/index.md；随笔 = posts/<日期-标识>.md', () => {
    expect(seriesEntryPath('city-lights')).toBe('src/content/series/city-lights/index.md');
    expect(postFileName('2026-09-21', 'morning-fog')).toBe('2026-09-21-morning-fog.md');
    expect(postEntryPath('2026-09-21-morning-fog.md')).toBe('src/content/posts/2026-09-21-morning-fog.md');
    expect(postSlugOf('2026-09-21-morning-fog.md')).toBe('morning-fog');
  });

  it('标识允许中文（标题直接派生），但绝不允许路径危险字符', () => {
    // 允许：ASCII 与中文都行，连字符做分隔
    for (const ok of ['city-lights', 'a', 'abc123', '夜光城市', '夜光-城市', '霓虹夜市20'])
      expect(isValidSlug(ok), ok).toBe(true);

    // 拒绝的重点不是「非 ASCII」，而是能拼出危险路径的东西
    for (const bad of ['a b', '-a', 'a-', '', 'a_b', '..', '../etc', 'a/b', 'a.b', 'C:\\x', 'a\u0000b'])
      expect(isValidSlug(bad), bad).toBe(false);
  });

  it('标题派生标识：中文原样、空格转连字符、标点丢掉', () => {
    expect(slugFromTitle('夜光 · 城市')).toBe('夜光-城市');
    expect(slugFromTitle('Morning Fog')).toBe('morning-fog');
    expect(slugFromTitle('夜光 · 城市666')).toBe('夜光-城市666');
    expect(slugFromTitle('  我的 系列  ')).toBe('我的-系列');
    expect(slugFromTitle('a/b 测试')).toBe('ab-测试'); // 斜杠必须消失，不能拼出 a/b
    expect(slugFromTitle('霓虹夜市 2')).toBe('霓虹夜市-2');
    // 纯标点派生不出标识，调用方据此报错
    expect(slugFromTitle('！！！')).toBe('');
  });

  it('提交信息点明集合与标题', () => {
    expect(commitMessage('series', { title: '夜光' }, { created: true })).toBe(
      'content(series): 新建系列「夜光」',
    );
    expect(commitMessage('posts', { title: '' })).toBe('content(posts): 更新随笔「（无题）」');
  });

  it('插图引用按已定语法生成（D2a：photo: + 照片 ID）', () => {
    expect(illustrationSnippet('dawn-01.webp', '晨雾落在田埂上')).toBe(
      '![晨雾落在田埂上](photo:dawn-01.webp)',
    );
    expect(illustrationSnippet('dawn-01.webp')).toBe('![](photo:dawn-01.webp)');
    expect(illustrationSnippet('')).toBe('');
  });
});
