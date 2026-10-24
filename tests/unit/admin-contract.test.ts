import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DISPLAY_LONG_EDGE as CFG_DISPLAY_LONG_EDGE,
  THUMB_LONG_EDGE as CFG_THUMB_LONG_EDGE,
  DISPLAY_QUALITY as CFG_DISPLAY_QUALITY,
  THUMB_QUALITY as CFG_THUMB_QUALITY,
} from '../../astro.config.mjs';
import {
  POOL_PHOTOS_DIR as CHECK_POOL_PHOTOS_DIR,
  POOL_SIDECAR_PATH as CHECK_POOL_SIDECAR_PATH,
} from '../../scripts/check-image-sources.mjs';
import {
  API_BASE,
  BRANCH,
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  OWNER,
  POOL_PHOTOS_DIR,
  POOL_SIDECAR_PATH,
  POSTS_DIR,
  REPO,
  SERIES_DIR,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  TOKEN_KEY,
  VEDITOR,
} from '../../public/admin/js/config.js';
import { clearToken, createTokenStore, readToken, writeToken } from '../../public/admin/js/storage.js';

// =============================================================================
// 后台的「契约层」测试（admin-v2.md E1–E6 + F 组的红线在后台这一侧）
//
// 单测覆盖不了的部分（构建期常量对不对、后台是不是偷偷引了框架/CDN 之外的库、
// 令牌有没有被写进别的键、入口页接线对不对）在这里用源码扫描 + 常量比对钉住。
//
// 设计决策（见交付报告）：
//   纯函数**只有一份**实现——就放在 public/admin/js/*.js（原生 ESM）。
//   Vitest 直接 import 这些 .js（Node 24 原生 ESM），所以不需要「TS 一份 + JS 一份」
//   的双份镜像，也就不需要「两份口径一致」的对比测试；这里反过来钉「它们与前台
//   TS 口径 / 构建配置同源」，那才是真正会漂移的地方。
// =============================================================================

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ADMIN = resolve(ROOT, 'public/admin');
const JS_DIR = resolve(ADMIN, 'js');
const JS_FILES = readdirSync(JS_DIR)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, path: resolve(JS_DIR, name), text: readFileSync(resolve(JS_DIR, name), 'utf8') }));

describe('常量与前台构建配置同源（不自己发明一套数值）', () => {
  it('照片池路径与构建期检查脚本一致', () => {
    expect(POOL_PHOTOS_DIR).toBe(CHECK_POOL_PHOTOS_DIR);
    expect(POOL_SIDECAR_PATH).toBe(CHECK_POOL_SIDECAR_PATH);
  });

  it('长边与质量与 astro.config.mjs 一致（后台直传不能和本地导入两套规格）', () => {
    expect(DISPLAY_LONG_EDGE).toBe(CFG_DISPLAY_LONG_EDGE);
    expect(THUMB_LONG_EDGE).toBe(CFG_THUMB_LONG_EDGE);
    // astro.config 用 0~100，Canvas 用 0~1
    expect(Math.round(DISPLAY_QUALITY * 100)).toBe(CFG_DISPLAY_QUALITY);
    expect(Math.round(THUMB_QUALITY * 100)).toBe(CFG_THUMB_QUALITY);
  });

  it('仓库 / 分支 / 内容目录与文档口径一致', () => {
    expect(OWNER).toBe('Elaina0510');
    expect(REPO).toBe('grphyblog');
    expect(BRANCH).toBe('main');
    expect(API_BASE).toBe('https://api.github.com');
    expect(SERIES_DIR).toBe('src/content/series');
    expect(POSTS_DIR).toBe('src/content/posts');
    expect(POOL_SIDECAR_PATH).toBe('src/content/pool/photos.meta.json');
  });
});

describe('技术栈红线：原生 JS + 唯一第三方库 Vditor（CDN）', () => {
  it('后台目录有入口页、样式与 ES 模块（纯静态，无构建步骤）', () => {
    for (const rel of ['index.html', 'app.css', '.gitkeep', 'js/app.js', 'js/config.js', 'js/yaml.js']) {
      expect(existsSync(resolve(ADMIN, rel)), `缺 public/admin/${rel}`).toBe(true);
    }
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as Record<string, string>;
    expect(pkg.scripts.build).not.toMatch(/admin/);
  });

  it('没有任何前端框架 / 打包器 / 第三方库 import', () => {
    const banned = /(react|vue|svelte|solid-js|preact|jquery|lodash|js-yaml|marked|showdown|bundle|webpack|vite)/i;
    const hits: string[] = [];
    for (const file of JS_FILES) {
      for (const match of file.text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        if (banned.test(match[1])) hits.push(`${file.name} → ${match[1]}`);
      }
    }
    expect(hits).toEqual([]);
    // index.html 里也不许出现外链脚本（Vditor 由 editor.js 动态加载）
    const html = readFileSync(resolve(ADMIN, 'index.html'), 'utf8');
    const scriptSrcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(scriptSrcs).toEqual(['./js/app.js']);
  });

  it('所有模块 import 都是相对路径（静态部署，没有裸包名）', () => {
    for (const file of JS_FILES) {
      for (const match of file.text.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)) {
        expect(match[1].startsWith('./'), `${file.name} 里出现了非相对 import：${match[1]}`).toBe(true);
      }
    }
  });

  it('Vditor 只以 https CDN 引入，且不在仓库里放副本', () => {
    expect(VEDITOR.script.startsWith('https://cdn.jsdelivr.net/npm/vditor@')).toBe(true);
    expect(VEDITOR.style.startsWith('https://cdn.jsdelivr.net/npm/vditor@')).toBe(true);
    const editor = JS_FILES.find((file) => file.name === 'editor.js');
    expect(editor?.text).toContain('VEDITOR.script');
    expect(editor?.text).toContain('textarea'); // CDN 不可达时的兜底
    const stray = readdirSync(ADMIN, { withFileTypes: true }).filter((entry) => /vditor/i.test(entry.name));
    expect(stray.map((entry) => entry.name)).toEqual([]);
  });

  it('没有回到「配置文件」形态：后台靠页面里填的令牌连仓库', () => {
    const html = readFileSync(resolve(ADMIN, 'index.html'), 'utf8');
    // frontmatter 的 YAML 子集是代码（js/yaml.js），不是「配置入口」；这里只钉配置文件名不出现
    expect(html).not.toMatch(/config\.ya?ml/i);
    for (const file of JS_FILES) {
      expect(file.text, `${file.name} 提到了配置入口文件名`).not.toMatch(/config\.ya?ml/i);
    }
  });
});

describe('令牌红线：只在浏览器存储里，且只有一个键', () => {
  /** 假 storage（Map 实现），顺带记录所有写入。 */
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('勾「记住」→ localStorage；不勾 → 只进 sessionStorage', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    writeToken('tkn-1', true, local, session);
    expect(local.map.get(TOKEN_KEY)).toBe('tkn-1');
    expect(session.map.size).toBe(0);

    writeToken('tkn-2', false, local, session);
    expect(local.map.size).toBe(0);
    expect(session.map.get(TOKEN_KEY)).toBe('tkn-2');
  });

  it('读：localStorage 优先，其次 sessionStorage', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    session.setItem(TOKEN_KEY, 'from-session');
    expect(readToken(local, session)).toBe('from-session');
    local.setItem(TOKEN_KEY, 'from-local');
    expect(readToken(local, session)).toBe('from-local');
  });

  it('退出清两个 storage；存空串等于清空', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    writeToken('tkn', true, local, session);
    clearToken(local, session);
    expect(local.map.size).toBe(0);
    expect(session.map.size).toBe(0);

    writeToken('tkn', true, local, session);
    writeToken('', true, local, session);
    expect(local.map.size).toBe(0);
  });

  it('令牌键就一个，不会顺手写下别的持久信息', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    writeToken('tkn', true, local, session);
    expect([...local.map.keys()]).toEqual([TOKEN_KEY]);
    expect(TOKEN_KEY).toBe('grphyblog:admin:token');
  });

  it('存储被禁用（getItem 抛错）也不炸，退化成「没令牌」', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readToken(broken, undefined)).toBe('');
    expect(() => writeToken('tkn', true, broken, undefined)).not.toThrow();
    expect(() => clearToken(broken, undefined)).not.toThrow();
    const store = createTokenStore({ local: broken });
    expect(store.read()).toBe('');
  });
});

describe('照片通道：后台上传只往池里写', () => {
  it('所有写路径都从 POOL_PHOTOS_DIR / POOL_SIDECAR_PATH 派生', () => {
    const photosModule = JS_FILES.find((file) => file.name === 'photos.js')?.text ?? '';
    const apiModule = JS_FILES.find((file) => file.name === 'api.js')?.text ?? '';
    expect(photosModule).toContain('${POOL_PHOTOS_DIR}/${id}');
    expect(apiModule).toContain('poolPhotoPath(');
    expect(apiModule).toContain('POOL_SIDECAR_PATH');
  });

  it('后台源码里不出现 public/ 写路径（图片只能进 src/content/pool/photos/）', () => {
    for (const file of JS_FILES) {
      expect(/(['"])public\//.test(file.text), `${file.name} 里出现了 public/ 路径`).toBe(false);
    }
  });
});
