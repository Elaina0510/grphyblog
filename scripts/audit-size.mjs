#!/usr/bin/env node
// =============================================================================
// audit-size —— 性能预算的构建期/验收期抽检（performance-acceptance 任务 1 + 2）
//
// 两件事：
//   A. 图片体积红线：缩略图 ≤ 160KB、展示图 ≤ 2MB（design §6 / PRODUCT 预算，与 import 的 SIZE_BUDGET 一致）。
//      遍历 src/content 下所有 .webp，超标的列出来，任一超标即 exit 1。
//   B. 图片属性审计（需先 npm run build，dist/ 存在时才做）：构建后 HTML 里每个
//      <img> 都必须有显式 width+height（防布局抖动）且带 loading 提示（lazy，或首屏
//      LCP 用 eager/fetchpriority）。缺任一项即 exit 1。
//
// 口径来源：阈值默认与 import 的 SIZE_BUDGET（§6）保持一致；此处仍写死是为了验收时可临时收紧。
// 用法：npm run audit:size   （只查体积）
//       npm run audit:size -- --html   （额外查 dist/ 里的 <img> 属性）
// =============================================================================
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONTENT = join(ROOT, 'src', 'content');
const DIST = join(ROOT, 'dist');

const THUMB_MAX = 160 * 1024; // 160KB
const DISPLAY_MAX = 2048 * 1024; // 2MB
const KB = (n) => (n / 1024).toFixed(1) + 'KB';
const wantHtml = process.argv.includes('--html');

/** 递归收集目录下所有 .webp 文件路径。 */
function walkWebp(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkWebp(p));
    else if (entry.isFile() && p.toLowerCase().endsWith('.webp')) out.push(p);
  }
  return out;
}

// ── A. 体积红线 ──────────────────────────────────────────────────────────────
const files = walkWebp(CONTENT);
const oversize = [];
let thumbCount = 0;
let displayCount = 0;
let maxThumb = 0;
let maxDisplay = 0;
for (const f of files) {
  const size = statSync(f).size;
  const isThumb = /\.thumb\.webp$/i.test(f);
  const cap = isThumb ? THUMB_MAX : DISPLAY_MAX;
  if (isThumb) { thumbCount++; maxThumb = Math.max(maxThumb, size); }
  else { displayCount++; maxDisplay = Math.max(maxDisplay, size); }
  if (size > cap) oversize.push({ f: relative(ROOT, f), size, cap, isThumb });
}

console.log('=== 图片体积抽检（design §6：缩略图 ≤160KB / 展示图 ≤2MB）===');
console.log(`缩略图 ${thumbCount} 张，最大 ${KB(maxThumb)} / 上限 ${KB(THUMB_MAX)}`);
console.log(`展示图 ${displayCount} 张，最大 ${KB(maxDisplay)} / 上限 ${KB(DISPLAY_MAX)}`);
if (oversize.length) {
  console.log(`\n✗ 超标 ${oversize.length} 张：`);
  for (const o of oversize) console.log(`   ${KB(o.size)} > ${KB(o.cap)}  ${o.f}`);
} else {
  console.log('✓ 全部在预算内');
}

let failed = oversize.length > 0;

// ── B. 构建后 <img> 属性审计 ─────────────────────────────────────────────────
if (wantHtml) {
  console.log('\n=== <img> 属性审计（需 dist/；显式宽高 + loading 提示）===');
  if (!existsSync(DIST)) {
    console.log('! 未找到 dist/，跳过（先 npm run build）');
  } else {
    const htmlFiles = [];
    (function walkHtml(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkHtml(p);
        else if (e.isFile() && p.endsWith('.html')) htmlFiles.push(p);
      }
    })(DIST);
    let imgs = 0;
    const bad = [];
    for (const h of htmlFiles) {
      const src = readFileSync(h, 'utf8');
      for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
        const tag = m[0];
        // 跳过后台页里的占位示例（若有）；只审计真实内容页
        imgs++;
        const hasW = /\swidth="\d+"/.test(tag);
        const hasH = /\sheight="\d+"/.test(tag);
        const hasLoading = /\sloading="(lazy|eager)"/.test(tag) || /\sfetchpriority="high"/.test(tag);
        if (!(hasW && hasH && hasLoading)) {
          bad.push({ f: relative(ROOT, h), why: !hasW && !hasH ? '缺宽或高' : !hasW ? '缺 width' : !hasH ? '缺 height' : '缺 loading/fetchpriority', tag: tag.replace(/\s+/g, ' ').slice(0, 120) });
        }
      }
    }
    console.log(`扫描 ${htmlFiles.length} 个 HTML，共 ${imgs} 个 <img>`);
    if (bad.length) {
      console.log(`\n✗ ${bad.length} 个 <img> 不合规：`);
      for (const b of bad) console.log(`   [${b.why}] ${b.f}\n      ${b.tag}`);
      failed = true;
    } else {
      console.log('✓ 每个 <img> 都有显式宽高 + loading 提示');
    }
  }
}

process.exit(failed ? 1 : 0);
