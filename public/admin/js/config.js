// =============================================================================
// config.js —— 后台的固定事实（仓库 / 分支 / 照片池路径 / 直传规格）
//
// 为什么单独一个文件：后台是纯静态页（无构建步骤、无打包），所有「常量」必须显式写死，
// 并且要能被单测钉住与 astro.config.mjs、scripts/check-image-sources.mjs 同口径
// （见 tests/unit/admin-contract.test.ts：2560 / 800 / quality 从 astro.config.mjs import 比对）。
//
// 红线：
//   · 这里**没有**任何凭据；令牌只活在浏览器 localStorage / sessionStorage（见 storage.js）。
//   · 仓库与分支是公开事实（登录文档 doc/admin-login-setup.md 同步交代）。
// =============================================================================

/** GitHub 仓库属主。 */
export const OWNER = 'Elaina0510';

/** GitHub 仓库名。 */
export const REPO = 'grphyblog';

/** 内容分支（后台所有读写都钉在这个分支上）。 */
export const BRANCH = 'main';

/** GitHub REST API 基地址（只有这一个接口族：Contents API）。 */
export const API_BASE = 'https://api.github.com';

/** 公开仓的原始文件基地址：只用于照片预览（src/content 下的图片由 Astro 处理，站点不给原始路径）。 */
export const RAW_BASE = 'https://raw.githubusercontent.com';

/** 照片池：唯一照片目录（与 scripts/check-image-sources.mjs 的 POOL_PHOTOS_DIR 同口径）。 */
export const POOL_PHOTOS_DIR = 'src/content/pool/photos';

/** 照片池：唯一元数据 sidecar（全局一份）。 */
export const POOL_SIDECAR_PATH = 'src/content/pool/photos.meta.json';

/** 系列条目目录（每条目一个子目录，正文在 index.md）。 */
export const SERIES_DIR = 'src/content/series';

/** 随笔条目目录（每条目一个 .md 文件）。 */
export const POSTS_DIR = 'src/content/posts';

/** 展示版长边像素（astro.config.mjs 的 DISPLAY_LONG_EDGE，由单测比对）。 */
export const DISPLAY_LONG_EDGE = 2560;

/** 缩略图长边像素（astro.config.mjs 的 THUMB_LONG_EDGE，由单测比对）。 */
export const THUMB_LONG_EDGE = 800;

/** 展示版编码质量（0~1，Canvas toBlob 口径；astro.config.mjs 用 0~100，单测按 /100 比对）。 */
export const DISPLAY_QUALITY = 0.82;

/** 缩略图编码质量（0~1）。 */
export const THUMB_QUALITY = 0.64;

/** 「记住令牌」时落 localStorage 的键。 */
export const TOKEN_KEY = 'grphyblog:admin:token';

/** Vditor 的 CDN 资源（唯一允许的第三方库，必须 CDN 引入，不进仓库）。 */
export const VEDITOR = Object.freeze({
  version: '3.10.9',
  script: 'https://cdn.jsdelivr.net/npm/vditor@3.10.9/dist/index.min.js',
  style: 'https://cdn.jsdelivr.net/npm/vditor@3.10.9/dist/index.css',
});

/** 直传文件名基（不加扩展名）的合法形状：小写字母数字与连字符，避免 URL 里出现怪字符。 */
export const PHOTO_BASENAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** 系列标识（= 目录名）的合法形状。 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
