import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// =============================================================================
// src/data/site.json 的形状契约 + 「站点级事实只此一处」
//
// 这份 JSON 是 visual-system 引入、下游 Base 导航 / 关于页共用的数据源：
// 形状一旦定下来，home / series / posts / about / lightbox 都照它组装。
// 因此这里把字段、类型与「示例数据必须打标」的约定钉死（DESIGN.md §8.2 是同表）。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const site = JSON.parse(readFileSync(resolve(ROOT, 'src/data/site.json'), 'utf8'));
const designMd = readFileSync(resolve(ROOT, 'DESIGN.md'), 'utf8');

describe('site.json · 顶层形状（DESIGN.md §8.2）', () => {
  it('必备分组齐备', () => {
    for (const key of [
      'locale',
      'name',
      'bookName',
      'description',
      'nav',
      'footer',
      'colophon',
      'social',
      'contact',
      'intro',
      'indexNote',
      'featured',
      '$comments',
    ]) {
      expect(site, `缺字段 ${key}`).toHaveProperty(key);
    }
    expect(site.locale).toBe('zh-CN'); // 中文为主 + 英文点缀
  });

  it('品牌锁死：柚 / Justyou 并用（PRODUCT.md Brand Commitments）', () => {
    expect(site.name.cjk).toBe('柚');
    expect(site.name.latin).toBe('Justyou');
    expect(site.name.latinUpper).toBe('JUSTYOU');
    expect(site.name.spine).toBe('柚影集'); // 视觉稿落地形态（surface-brief 记录）
    expect(site.name.display).toBe('柚 · Justyou');
    expect(typeof site.bookName.cjk).toBe('string');
    expect(typeof site.bookName.latin).toBe('string');
  });
});

describe('site.json · 书脊导航四项', () => {
  it('正好四项：首页 / 系列 / 随笔 / 关于', () => {
    expect(Array.isArray(site.nav)).toBe(true);
    expect(site.nav.map((n: { key: string }) => n.key)).toEqual(['home', 'series', 'posts', 'about']);
    expect(site.nav.map((n: { href: string }) => n.href)).toEqual(['/', '/series/', '/posts/', '/about/']);
  });

  it('每项都有 key/href/label，label 是中文界面词', () => {
    for (const item of site.nav) {
      expect(Object.keys(item).sort()).toEqual(['href', 'key', 'label']);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.label).toMatch(/[\u4e00-\u9fa5]/);
    }
  });
});

describe('site.json · 页脚 / 版权页 / 联系与社交', () => {
  it('页脚两句：署名 + 版权', () => {
    expect(typeof site.footer.note).toBe('string');
    expect(site.footer.copyright).toContain('柚');
  });

  it('版权页制作信息是 term/value 对（colophon dl 用）', () => {
    expect(Array.isArray(site.colophon)).toBe(true);
    expect(site.colophon.length).toBeGreaterThanOrEqual(4);
    for (const row of site.colophon) {
      expect(Object.keys(row).sort()).toEqual(['term', 'value']);
      expect(row.value.length).toBeGreaterThan(0);
    }
    // 设备事实必须与 PRODUCT.md 的 Evidence 一致（GX85 / Photoshop），不得凭空写
    const camera = site.colophon.find((r: { term: string }) => r.term === '相机');
    expect(camera?.value).toMatch(/GX85/);
  });

  it('社交与联系都显式标 placeholder —— 未标真值不得直接上线', () => {
    for (const s of site.social) {
      expect(s).toHaveProperty('key');
      expect(s).toHaveProperty('label');
      expect(s).toHaveProperty('href');
      expect(s.placeholder).toBe(true);
    }
    expect(site.contact.placeholder).toBe(true);
  });

  it('示例文案必须打 sample 标（渲染时配 ※示例）', () => {
    expect(site.intro.sample).toBe(true);
    expect(typeof site.intro.text).toBe('string');
    expect(site.indexNote.sample).toBe(true);
    expect(Array.isArray(site.indexNote.lines)).toBe(true);
  });

  it('精选区已由 home-page 填充：每项 {collection,id,file,title} 且指向已发布（非 draft）系列', () => {
    const { photos } = site.featured;
    expect(Array.isArray(photos)).toBe(true);
    expect(photos.length).toBeGreaterThan(0);
    for (const p of photos) {
      for (const key of ['collection', 'id', 'file', 'title']) {
        expect(p, `精选项缺 ${key}`).toHaveProperty(key);
        expect(typeof p[key]).toBe('string');
        expect(p[key].length).toBeGreaterThan(0);
      }
      expect(p.collection).toBe('series');
      // 公开精选不得引用草稿条目（daily-frames 是 draft:true）
      expect(p.id).not.toBe('daily-frames');
      // file 是内容相对展示图（过 imageUrl 出口用）
      expect(p.file).toMatch(/^photos\/.+\.(webp)$/);
    }
  });
});

describe('站点级事实只此一处（避免各页硬编码）', () => {
  const pages = readdirSync(resolve(ROOT, 'src/pages'))
    .filter((f) => f.endsWith('.astro'))
    .map((f) => readFileSync(resolve(ROOT, 'src/pages', f), 'utf8'));

  it('页面里没有第二处导航（书脊导航只由 Base.astro 提供）', () => {
    for (const code of pages) {
      expect(code).not.toContain('spine-nav');
    }
    const base = readFileSync(resolve(ROOT, 'src/layouts/Base.astro'), 'utf8');
    expect(base).toContain('spine-nav');
  });

  it('页面不重复硬编码品牌串（要靠 SiteMark 或 site.json）', () => {
    for (const code of pages) {
      expect(code).not.toContain('柚影集');
    }
  });

  it('Base 与 SiteMark 都从 site.json 取数据', () => {
    expect(readFileSync(resolve(ROOT, 'src/layouts/Base.astro'), 'utf8')).toContain(
      "import site from '../data/site.json'",
    );
    expect(readFileSync(resolve(ROOT, 'src/components/SiteMark.astro'), 'utf8')).toContain(
      "import site from '../data/site.json'",
    );
  });

  it('DESIGN.md 记录了 site.json 的形状与 placeholder 约定', () => {
    for (const needle of ['site.json', '"nav"', 'placeholder', 'featured', '※示例']) {
      expect(designMd, `DESIGN.md 未记录 ${needle}`).toContain(needle);
    }
  });
});
