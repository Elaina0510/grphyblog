// =============================================================================
// postIllustrations —— 随笔「正文内联插图」的构建期管线（posts-pages 任务 4）
//
// 要解决的问题：随笔 .md 正文里以 `![说明](photo:照片ID)` 引用的池内照片，
// 在最终 HTML 里必须同时满足三件事——
//   ① src 解析成可服务 URL（走 contentImageUrl 单一出口，边界③），绝不留 `photo:` 协议头
//      或 `photos/…` 相对路径；
//   ② 注入该照池 sidecar 条目的**真实** width/height（§6 显式宽高防布局抖动）；缺 sidecar
//      条目就记构建期告警、跳过它的灯箱，**不伪造尺寸**；
//   ③ 包成灯箱图版：data-lightbox / data-lightbox-gallery="post-<slug>" / data-lightbox-index，
//      并进入归属该随笔的 frames JSON 岛（§2 灯箱数据契约）。
//
// ---- 插图语法（admin-v2.md D2a 已定，v0.1.1）----
//   正文写 `![说明](photo:照片ID)`：
//     `photo:`  协议头（本项目自定，仅出现在 markdown 源里，绝不外泄到产物）；
//     照片 ID = 池内完整文件名含 .webp（如 `dawn-01.webp`）；
//     方括号里的说明文字即 alt。
//   旧的相对路径写法（`![…](<资源夹>/photos/dawn-01.webp)`）已退役：不再当插图处理，
//   只发一条构建期告警并把图留在正文里（能解析出 URL 就让它能加载），**不**伪造宽高、
//   **不**接灯箱。迁移由 D5 一次性改写完成，之后新写正文一律用新语法。
//
// 实现方式 = 交付清单里的 (b)「render 得 HTML 后做字符串后处理」，不是 (a) rehype 插件。原因：
//   - Astro 7 的 markdown 管线会把正文里的**本地**图片改写成占位属性
//     `<img __ASTRO_IMAGE_="{&quot;src&quot;:&quot;photos/dawn-01.webp&quot;,…}">`（真 src 被摘掉），
//     只有走 `<Content />` 时才由 astro:content 的 render() 异步回填；`photo:` 这类自定协议
//     不是「本地图片」，Astro 不认、也不会去解析它，正好把引用原样留给本模块；
//   - 而灯箱接线需要 PhotoPlate **组件**（scoped 样式 + PageChip / ExifCard 复用），
//     rehype 插件产出的是 HTML 字符串，既拿不到组件、也拿不到 sidecar 真值。
//   - 所以：取 entry.rendered.html（含占位属性 / 原样的 photo: 引用）→ 本模块切成
//     「文本片段」与「插图引用」交替的 parts → 页面用 set:html 落文本、用 PhotoPlate 落插图。
//     文字与图版同流交替，正是「文字为主、插图为辅」。
//   - 未命中 sidecar 的图：仍当普通 `<img>` 留在文本段里（至多把 src 解析成可服务 URL），
//     但**不**给它 data-lightbox、**不**给它宽高。
//
// 三条既有契约（A/B 组之外的硬红线，改数据来源不许改它们）：
//   ① 不伪造宽高：sidecar 缺条目 → 告警 + 跳过灯箱，绝不猜尺寸；
//   ② 不占空帧：产物不在构建图里 → 也不进 frames（不留「有帧号却没图」的空壳）；
//   ③ 重复引用复用帧号：正文里同一张图出现两次 → 两块图版、一个灯箱帧。
//
// 本文件刻意保持纯函数、零 Astro / 零 Node 依赖（URL 解析与告警都走注入），可在 Vitest 直接跑。
// =============================================================================

import type { Exif, PhotoEntry, PhotoSidecar } from '../types/photoSidecar';

/** 插图引用协议头：`![说明](photo:照片ID)`。 */
export const PHOTO_REF_SCHEME = 'photo:';

/** Astro markdown 管线给本地图片打的占位属性（值是一段被实体转义的 JSON，含 src / alt / index）。 */
const ASTRO_IMAGE_ATTR = /__ASTRO_IMAGE_\s*=\s*"([^"]*)"/i;

/** 整枚 `<img>` 标签（含自闭合斜杠）。 */
const IMG_TAG = /<img\b[^>]*?\/?>/gi;

/** 普通属性读取：双引号 / 单引号 / 裸值三形皆认。 */
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const ALT_ATTR = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** 占位记号本体：`<!--astro-illus:序号-->`。序号 = 该图在正文中的出现次序（非灯箱帧号）。 */
const ILLUSTRATION_MARK = /<!--astro-illus:(\d+)-->/g;

/** HTML 实体还原（占位属性里的 JSON 串是被转义过的）。 */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#38;/gi, '&')
    .replace(/&amp;/gi, '&');
}

/** 取属性值：命中即返回，未命中返回空串。 */
function attrValue(tag: string, re: RegExp): string {
  const m = re.exec(tag);
  if (!m) return '';
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
}

/** 剥查询串 / 锚点。 */
function stripQuery(path: string): string {
  return path.split('?')[0].split('#')[0];
}

/** 路径最后一段（basename）。 */
function baseName(path: string): string {
  return stripQuery(path).split('/').filter(Boolean).pop() ?? '';
}

/**
 * 把正文里的相对路径归一成「旧 sidecar 口径的形」（收成 `photos/x.webp`）。
 *
 * ⚠️ 保留给 **迁就层** 用（contentImages 的多形查表依赖它），不是新插图语法的入口。
 * 正文写法多样：`photos/x.webp` / `./photos/x.webp` / `/src/content/posts/<slug>/photos/x.webp`
 * / Astro 占位属性里已带目录前缀的串，一律走同一口径。
 */
export function normalizeIllustrationPath(raw: string): string {
  const clean = stripQuery(String(raw ?? '').trim().replace(/\\/g, '/'));
  const parts = clean.split('/').filter(Boolean);
  const photosAt = parts.lastIndexOf('photos');
  const tail = photosAt >= 0 ? parts.slice(photosAt) : parts.slice(-1);
  return tail.join('/');
}

/** 是否是新的 `photo:` 协议引用（大小写不敏感，容忍前导空白）。 */
export function isPhotoRef(raw: string): boolean {
  return /^photo:/i.test(String(raw ?? '').trim());
}

/**
 * `photo:` 引用 → 照片 ID（`dawn-01.webp`）。不是 photo 引用则返回空串。
 * 容忍 ID 前多写的 `photos/`（`photo:photos/dawn-01.webp` 同样取末段）。
 */
export function photoIdOfRef(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!isPhotoRef(value)) return '';
  return baseName(value.replace(/^photo:/i, ''));
}

/** 正文插图引用的来源分类。 */
export type IllustrationSource =
  /** 新语法：`photo:` + 池内照片 ID */
  | { kind: 'photo'; id: string }
  /** 退役写法：旧相对路径（告警 + 不接灯箱） */
  | { kind: 'legacyPath'; rel: string }
  /** 外链 / data: / blob: / 站点绝对路径：不是资源夹插图，原样留着 */
  | { kind: 'external' };

/**
 * 判定一枚 `<img>` 的 src 属于哪一类引用。
 *
 * 判定顺序刻意如此：先认 `photo:`（自定协议，会先被 `外部` 的 scheme 正则命中，必须前置），
 * 再认外链 / 站点绝对路径，最后才落到「旧相对路径」。
 */
export function parseIllustrationSource(raw: string): IllustrationSource {
  const value = String(raw ?? '').trim();
  if (isPhotoRef(value)) {
    const id = photoIdOfRef(value);
    return id ? { kind: 'photo', id } : { kind: 'legacyPath', rel: value };
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)) return { kind: 'external' };
  const rel = normalizeIllustrationPath(value);
  return { kind: 'legacyPath', rel };
}

/**
 * 引用 → 池 sidecar 的匹配键（照片 ID = 末段文件名）。
 * 新语法 `photo:x.webp` 与旧路径 `a/b/photos/x.webp` 都归一到 `x.webp`；
 * 展示图与缩略图（`x.thumb.webp`）是两个不同 ID，不会互相命中。
 */
export function refPhotoId(raw: string): string {
  const value = String(raw ?? '').trim();
  return baseName(value.replace(/^photo:/i, ''));
}

/**
 * 在（全局）池 sidecar 里查这张照片：按照片 ID 精确匹配 file 的末段。
 * 未命中返回 -1 —— 调用方据此告警并跳过灯箱，绝不猜宽高。
 */
export function findSidecarIndex(sidecar: PhotoSidecar, idOrPath: string): number {
  const id = refPhotoId(idOrPath);
  if (!id || !Array.isArray(sidecar)) return -1;
  return sidecar.findIndex((entry) => baseName(entry.file) === id);
}

/**
 * 一张正文插图的引用：sidecar 位置 + 出现次序 + 灯箱帧号 + 解析好的 URL。
 * 页面渲染图版所需的一切都在这里，不必再回头查表。
 */
export interface IllustrationRef {
  /** 在正文里的出现次序（0 起）；占位记号与 parts 用它配对 */
  ordinal: number;
  /** frames 岛下标 = data-lightbox-index；正文内重复引用同一张图时指向它的首帧号 */
  frameIndex: number;
  /** sidecar 下标 */
  sidecarIndex: number;
  /** sidecar 条目本体（真宽高 / thumb / exif 的唯一出处） */
  photo: PhotoEntry;
  /** 正文里的 alt（可能为空串，空则页面按题名兜底） */
  alt: string;
  /** 展示图 URL（resolveUrl 注入的产物；未注入时是归一化相对路径） */
  src: string;
  /** 缩略图 URL（同上） */
  thumb: string;
  /** 正文内重复引用同一张 sidecar 图：true → 图版仍出现，但不再占一个新灯箱帧 */
  duplicate: boolean;
}

/** frames 岛里一帧的形状（与 series 侧契约同字段）。 */
export interface IllustrationFrame {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  title?: string;
  exif: Exif;
}

/** 正文被切出来的一段：要么是可直接 set:html 的 HTML，要么是一张插图图版。 */
export type PostBodyPart =
  | { kind: 'html'; html: string }
  | { kind: 'illustration'; ref: IllustrationRef };

export interface ProcessedPostBody {
  /** 页面据此渲染：文本片段与插图图版交替，保持正文顺序 */
  parts: PostBodyPart[];
  /** 灯箱帧序列（= frames JSON 岛顺序）：每张命中插图恰好一帧，重复引用不重复占帧 */
  frames: IllustrationRef[];
  /** 命中的插图图版总数（含重复引用） */
  plateCount: number;
  /** 未命中 / 写法退役、按普通 <img> 留在文本里的引用（已记告警） */
  skipped: string[];
}

export interface ProcessIllustrationsOptions {
  /** Astro 渲染好的正文 HTML（entry.rendered.html，可能含 __ASTRO_IMAGE_ 占位属性） */
  html: string;
  /**
   * 全局池 sidecar（src/content/pool/photos.meta.json）。缺省视为空表 ——
   * 于是所有插图走「缺条目」告警分支，正文照出不炸。
   */
  sidecar?: PhotoSidecar | null;
  /**
   * 照片 ID / 相对路径 -> 展示图可服务 URL（页面注入 contentImageUrl + resolveContentImage 的结果）。
   * **契约：解析不出（产物不在构建图里）必须返回空串**，本模块据此判断要不要接线；
   * 不注入时留归一化相对路径，便于单测断言。
   */
  resolveUrl?: (relPath: string) => string;
  /** 相对路径 -> 缩略图可服务 URL；缺省复用 resolveUrl。 */
  resolveThumbUrl?: (relPath: string) => string;
  /** 构建期告警出口（页面注入 console.warn）。 */
  onWarn?: (message: string) => void;
}

/**
 * 主入口：把正文 HTML 切成 parts + 抽出插图帧序列。
 *
 * 步骤：
 *   1. 扫每枚 `<img>`：优先从 __ASTRO_IMAGE_ 占位属性取 src/alt（Astro 会把本地图的 src 摘掉），
 *      退化才读普通 src/alt；
 *   2. 认 `photo:` → 按照片 ID 问池 sidecar；命中则把整枚标签换成 `<!--astro-illus:N-->` 记号
 *      并登记 ref；未命中 / 旧写法 / 外链则原样留在这段的 HTML 里（不伪造宽高、不接灯箱）；
 *   3. 命中记号若独占一个 `<p>`（正文里图片常单独成段），剥掉那对空段落，避免残留 `<p></p>`；
 *   4. 按记号把 HTML 切成 parts（文本段 / 插图交替），回填 frameIndex（重复引用复用首帧号）。
 */
export function processPostIllustrations(
  options: ProcessIllustrationsOptions,
): ProcessedPostBody {
  const { html, sidecar = null, resolveUrl, resolveThumbUrl, onWarn } = options;
  const table: PhotoSidecar = Array.isArray(sidecar) ? sidecar : [];
  const src = String(html ?? '');
  const resolve = resolveUrl ?? ((p: string) => p);
  const resolveThumb = resolveThumbUrl ?? resolve;

  const refs: IllustrationRef[] = [];
  const skipped: string[] = [];
  /** sidecarIndex -> 首次出现的 ref；重复引用据此复用帧号 */
  const firstBySidecar = new Map<number, IllustrationRef>();
  let ordinal = 0;

  /** 属性值转义（只处理会破坏属性边界的字符）。 */
  const escAttr = (value: string) => String(value ?? '').replace(/"/g, '&quot;');

  /** 剥掉构建期占位属性：__ASTRO_IMAGE_ 只属于 Astro 的内部管线，不许进 dist。 */
  const dropPlaceholder = (tag: string) =>
    tag.replace(ASTRO_IMAGE_ATTR, '').replace(/\s{2,}/g, ' ');

  /**
   * 把一枚未接灯箱的 <img> 的 src 换成解析后的 URL。
   * 占位那形要特别对待：Astro 的 image-marker 把 alt 一并塞进了占位属性（普通属性被清空），
   * 所以这里用 src + alt 顶替占位属性，免得无障碍描述在产物里丢掉。
   */
  const withSrc = (tag: string, url: string, alt = '') => {
    if (ASTRO_IMAGE_ATTR.test(tag)) {
      const injected = `src="${escAttr(url)}"${alt ? ` alt="${escAttr(alt)}"` : ''}`;
      return tag.replace(ASTRO_IMAGE_ATTR, injected).replace(/\s{2,}/g, ' ');
    }
    const clean = dropPlaceholder(tag);
    return /\bsrc\s*=/.test(clean)
      ? clean.replace(SRC_ATTR, `src="${escAttr(url)}"`)
      : clean.replace(/^<img/i, `<img src="${escAttr(url)}"`);
  };

  const marked = src.replace(IMG_TAG, (tag) => {
    // Astro 的本地图占位：__ASTRO_IMAGE_="{&quot;src&quot;:&quot;photos/x.webp&quot;,…}"
    const placeholder = ASTRO_IMAGE_ATTR.exec(tag);
    let rawSrc = '';
    let alt = '';
    if (placeholder) {
      try {
        const props = JSON.parse(decodeEntities(placeholder[1])) as {
          src?: string;
          alt?: string;
        };
        rawSrc = String(props?.src ?? '');
        alt = String(props?.alt ?? '');
      } catch {
        /* 占位属性读不懂：退回普通属性路径 */
      }
    }
    if (!rawSrc) rawSrc = attrValue(tag, SRC_ATTR);
    if (!alt) alt = attrValue(tag, ALT_ATTR);

    const source = parseIllustrationSource(rawSrc);

    // 外链 / data: / blob: / 站点绝对路径：不是池里的插图，原样留着（只剥 Astro 占位属性）
    if (source.kind === 'external') return dropPlaceholder(tag);

    // 退役的相对路径写法：不再当插图（不计帧、不伪造宽高），但尽量让图还能加载。
    if (source.kind === 'legacyPath') {
      const rel = source.rel;
      if (!rel || !/\.[a-z0-9]+$/i.test(rel)) return dropPlaceholder(tag);
      onWarn?.(
        `[posts] 正文插图「${rel}」是旧相对路径写法，已退役：请改成 ![说明](photo:照片ID)` +
          `（照片 ID = 池内文件名，如 dawn-01.webp）。本次已跳过它的灯箱帧且不伪造宽高。`,
      );
      skipped.push(rel);
      const fallback = resolve(rel);
      return fallback ? withSrc(tag, fallback, alt) : dropPlaceholder(tag);
    }

    // ---- 新语法 photo:<ID> ----
    const id = source.id;
    const index = table.length === 0 ? -1 : findSidecarIndex(table, id);

    if (index < 0) {
      // 缺 sidecar 条目：没有真实宽高可注入，也就不接灯箱（不伪造尺寸契约）。
      onWarn?.(
        `[posts] 正文插图 photo:${id} 在照片池 sidecar（pool/photos.meta.json）里没有对应条目：` +
          ` 已跳过它的灯箱帧且不伪造宽高。请把这张图导入照片池：\`npm run import --pool\`。`,
      );
      skipped.push(id);
      // 尽量让图还能加载：产物在构建图里就把 src 换成可服务 URL，否则剥掉不可加载的协议头。
      const fallback = resolve(id);
      return fallback ? withSrc(tag, fallback, alt) : withSrc(tag, `photos/${id}`, alt);
    }

    // 命中 sidecar：再确认产物真在构建图里（URL 解析得出），否则整张退回普通 <img>，
    // 不留一个「有帧号却没图」的空壳（不占空帧契约）。
    const photo = table[index];
    const srcUrl = resolve(photo.file);
    if (!srcUrl) {
      onWarn?.(
        `[posts] 正文插图 photo:${id} 在池 sidecar 里有记录，但构建产物里找不到该文件：` +
          ` 已跳过它的灯箱帧，请重跑 \`npm run import --pool\`。`,
      );
      skipped.push(id);
      return withSrc(tag, photo.file, alt);
    }

    const first = firstBySidecar.get(index);
    const current = ordinal;
    ordinal += 1;
    const ref: IllustrationRef = {
      ordinal: current,
      // frameIndex 先按出现次序占位，下面按正文首现顺序统一回填
      frameIndex: current,
      sidecarIndex: index,
      photo,
      alt,
      src: srcUrl,
      thumb: resolveThumb(photo.thumb) || srcUrl,
      duplicate: first !== undefined, // 正文里第二次引用同一张：不再占一个新帧
    };
    refs.push(ref);
    if (!first) firstBySidecar.set(index, ref);
    return `<!--astro-illus:${current}-->`;
  });

  // 命中记号独占一段时剥掉 <p>：正文里插图常单独成段，否则切完会留下空段落。
  const cleaned = marked
    .replace(/<p>\s*(<!--astro-illus:\d+-->)\s*<\/p>/g, '$1')
    // 剥完只剩空段落的（连续图片写法）一并清掉，免得多余段间距。
    .replace(/<p>\s*<\/p>/g, '');

  /* ---- 按记号切分成 parts ---- */
  const parts: PostBodyPart[] = [];
  let cursor = 0;
  ILLUSTRATION_MARK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ILLUSTRATION_MARK.exec(cleaned)) !== null) {
    const before = cleaned.slice(cursor, m.index);
    if (before.trim()) parts.push({ kind: 'html', html: before });
    const ref = refs[Number(m[1])];
    if (ref) parts.push({ kind: 'illustration', ref });
    cursor = m.index + m[0].length;
  }
  const tail = cleaned.slice(cursor);
  if (tail.trim()) parts.push({ kind: 'html', html: tail });

  // 帧序列：每张命中插图恰好一帧（重复引用不重复占帧）。
  // 顺序 = **正文首现顺序**（池化后不再有「条目自己的 sidecar 顺序」可依；
  // 读者点开灯箱时前后翻的是这篇的阅读顺序，与系列页「按 photos[] 顺序」同一精神）。
  // refs 本来就是按扫 HTML 的先后 push 的，未重复的那些即首现顺序。
  const frames = refs.filter((r) => !r.duplicate);
  frames.forEach((r, i) => {
    r.frameIndex = i;
  });
  // 重复引用指向它首帧的号（号在上面才最终确定）
  for (const ref of refs) {
    if (!ref.duplicate) continue;
    const first = frames.find((f) => f.sidecarIndex === ref.sidecarIndex);
    ref.frameIndex = first ? first.frameIndex : -1;
  }

  return {
    parts,
    frames,
    plateCount: refs.length,
    skipped,
  };
}

/**
 * 灯箱 frames JSON 岛本体（§2 契约，与 series 侧同形状、同转义口径）。
 * 返回**已把 '<' 转义**的字符串，可直接交给 `set:html`，杜绝 </script> 提前闭合。
 */
export function buildIllustrationFramesJson(
  refs: readonly IllustrationRef[],
  options: { title?: string } = {},
): string {
  const frames: IllustrationFrame[] = refs.map((ref) => {
    const frame: IllustrationFrame = {
      src: ref.src,
      thumb: ref.thumb,
      width: ref.photo.width,
      height: ref.photo.height,
      alt: ref.alt || options.title || '',
      exif: ref.photo.exif,
    };
    if (options.title) frame.title = options.title;
    return frame;
  });
  return JSON.stringify({ frames }).replace(/</g, '\\u003c');
}

export default processPostIllustrations;
