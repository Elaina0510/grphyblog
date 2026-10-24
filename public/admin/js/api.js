// =============================================================================
// api.js —— 把「一次内容操作」编排成若干 Contents API 往返（业务层，无 DOM）
//
// 分层：
//   github.js  一次 HTTP
//   api.js     一个业务动作（读池 / 列条目 / 读条目 / 存条目 / 直传一张照片）
//   app.js     DOM 与交互
//
// 直传的提交顺序（E6）：先落展示版与缩略图，再写 sidecar。
//   · 副作用是「最坏情况下多两个未登记文件」——构建期 R3 会点名，重新登记一次即可；
//   · 反过来先写 sidecar 再落文件，构建期会报 R4 死链，同样要修，但图片本体没进仓库更难补。
//   故顺序固定为「先图后册」，sidecar 写失败会自动重试一次（sha 可能被别处改掉）。
// =============================================================================

import { POOL_SIDECAR_PATH, SERIES_DIR, POSTS_DIR } from './config.js';
import {
  appendPhotoEntry,
  buildUploadEntry,
  entryPhotoId,
  hasPhoto,
  photoIdOf,
  poolPhotoPath,
  thumbIdOf,
} from './photos.js';
import {
  buildEntryMarkdown,
  commitMessage,
  parseEntryMarkdown,
  postFileName,
  seriesEntryPath,
} from './markdown.js';

/** sidecar 的磁盘文本口径：2 空格缩进 + 结尾换行（与仓库现有文件同形，diff 才干净）。 */
export function sidecarText(sidecar) {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

/**
 * 读全局照片池：sidecar → PhotoEntry[]，附带 sha（写回时要用）。
 * sidecar 不存在（404）按空池处理；JSON 坏掉则抛错——宁可不显示，也不拿半份元数据去写。
 */
export async function loadPool(client) {
  try {
    const file = await client.readFile(POOL_SIDECAR_PATH);
    const parsed = JSON.parse(file.text);
    if (!Array.isArray(parsed)) throw new Error('sidecar 不是数组');
    return { sidecar: parsed, sha: file.sha, path: file.path };
  } catch (error) {
    if (error && error.status === 404) return { sidecar: [], sha: '', path: POOL_SIDECAR_PATH };
    if (error instanceof SyntaxError) {
      throw new Error(`照片池登记表不是合法 JSON（${POOL_SIDECAR_PATH}）：${error.message}`);
    }
    throw error;
  }
}

/** 写回全局 sidecar（追加一条 / 改一条）。 */
export async function savePool(client, sidecar, sha, message = 'content(pool): 登记照片') {
  const result = await client.writeFile(POOL_SIDECAR_PATH, sidecarText(sidecar), { message, sha });
  return { sha: result.sha };
}

/**
 * 列条目。
 *
 * 系列：`series/<slug>/index.md`；随笔：`posts/<日期-标题>.md`。
 * 每个条目都要读一次 frontmatter（列表要显示标题 / 日期 / 张数 / 草稿），条目数量很少（个位数）。
 *
 * @returns {Promise<Array<{collection:string, id:string, name:string, path:string, sha:string,
 *   fields:object, unknownKeys:string[], photos:number}>>}
 */
export async function listEntries(client, collection) {
  if (collection === 'series') {
    const dirs = (await client.listDir(SERIES_DIR)).filter((item) => item.type === 'dir');
    const rows = [];
    for (const dir of dirs) {
      const path = `${SERIES_DIR}/${dir.name}/index.md`;
      try {
        const file = await client.readFile(path);
        const parsed = parseEntryMarkdown(file.text, 'series');
        rows.push({
          collection,
          id: dir.name,
          name: dir.name,
          path,
          sha: file.sha,
          fields: parsed.fields,
          unknownKeys: parsed.unknownKeys,
          photos: parsed.fields.photos.length,
        });
      } catch (error) {
        if (error && error.status === 404) continue; // 只有资源夹、还没写 index.md
        throw error;
      }
    }
    return rows.sort((a, b) => {
      const byOrder = Number(a.fields.order) - Number(b.fields.order);
      return byOrder !== 0 ? byOrder : String(b.fields.date).localeCompare(String(a.fields.date));
    });
  }

  const files = (await client.listDir(POSTS_DIR)).filter(
    (item) => item.type === 'file' && /\.md$/i.test(item.name),
  );
  const rows = [];
  for (const item of files) {
    const path = `${POSTS_DIR}/${item.name}`;
    let file;
    try {
      file = await client.readFile(path);
    } catch (error) {
      // 目录里列到了、但读不到（权限/刚被改名）：跳过这一条，别让整个列表崩掉
      if (error && error.status === 404) continue;
      throw error;
    }
    const parsed = parseEntryMarkdown(file.text, 'posts');
    rows.push({
      collection,
      id: item.name.replace(/\.md$/i, ''),
      name: item.name,
      path,
      sha: file.sha,
      fields: parsed.fields,
      unknownKeys: parsed.unknownKeys,
      photos: parsed.fields.photos.length,
    });
  }
  return rows.sort((a, b) => String(b.fields.date).localeCompare(String(a.fields.date)));
}

/** 读一个条目（含正文与行尾），给编辑页用。 */
export async function readEntry(client, collection, path) {
  const file = await client.readFile(path);
  const parsed = parseEntryMarkdown(file.text, collection);
  return {
    collection,
    path,
    sha: file.sha,
    fields: parsed.fields,
    body: parsed.body,
    eol: parsed.eol,
    unknownKeys: parsed.unknownKeys,
  };
}

/** 存一个条目：拼 frontmatter + 正文 → PUT（新建时 sha 为空，覆盖时带 sha）。 */
export async function saveEntry(client, { collection, path, sha, fields, body, eol, created = false }) {
  const markdown = buildEntryMarkdown({ collection, fields, body, eol });
  const result = await client.writeFile(path, markdown, {
    message: commitMessage(collection, fields, { created }),
    sha,
  });
  return { sha: result.sha, commit: result.commit, markdown, path };
}

/** 新条目的仓库路径：系列按 slug 建目录，随笔按日期+标识建文件。 */
export function newEntryPath(collection, { slug, date }) {
  if (collection === 'series') return seriesEntryPath(slug);
  return `${POSTS_DIR}/${postFileName(date, slug)}`;
}

/**
 * 浏览器直传一张照片（E6）：两个文件 + 一条 sidecar 登记。
 *
 * @param {object} client GitHub 客户端
 * @param {{bytes:Uint8Array, thumbBytes:Uint8Array, baseName:string, width:number, height:number,
 *          thumbWidth:number, thumbHeight:number, pool:{sidecar:object[], sha:string}}} input
 */
export async function uploadPhoto(client, input) {
  const { bytes, thumbBytes, baseName, width, height, thumbWidth, thumbHeight, pool } = input;
  const sidecar = Array.isArray(pool?.sidecar) ? pool.sidecar : [];
  const entry = buildUploadEntry({ baseName, width, height, thumbWidth, thumbHeight });
  const id = entryPhotoId(entry);
  if (hasPhoto(sidecar, id)) {
    throw new Error(`池里已经有同名照片：${id}，换个文件名再传（避免覆盖别人的图）`);
  }

  await client.writeBytes(poolPhotoPath(id), bytes, { message: `content(pool): 直传照片 ${id}` });
  await client.writeBytes(poolPhotoPath(thumbIdOf(id)), thumbBytes, {
    message: `content(pool): 直传缩略图 ${thumbIdOf(id)}`,
  });

  const next = appendPhotoEntry(sidecar, entry);
  try {
    const saved = await savePool(client, next, pool?.sha ?? '', `content(pool): 直传登记 ${id}`);
    return { entry, sidecar: next, sha: saved.sha };
  } catch (error) {
    // sha 被别人改过（409/412）：重读一次再登记，别让图片白传
    if (error && (error.status === 409 || error.status === 412 || error.status === 422)) {
      const fresh = await loadPool(client);
      const merged = appendPhotoEntry(fresh.sidecar, entry);
      const saved = await savePool(client, merged, fresh.sha, `content(pool): 直传登记 ${id}`);
      return { entry, sidecar: merged, sha: saved.sha };
    }
    throw error;
  }
}

/** 池里所有照片 ID（顺序 = sidecar 登记顺序）。 */
export function poolIds(sidecar) {
  return (Array.isArray(sidecar) ? sidecar : []).map((entry) => entryPhotoId(entry)).filter(Boolean);
}

/** 某张图是否「EXIF 待补」（浏览器直传产物，见 E6）。 */
export function isExifPending(entry) {
  return Boolean(entry?.exifIncomplete || entry?.exif?.exifIncomplete);
}

export { photoIdOf };
