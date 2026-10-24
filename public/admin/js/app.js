// =============================================================================
// app.js —— 自建单页后台的交互层（原生 DOM，无框架、无构建）
//
// 三个板块（admin-v2.md E2）：照片池 / 系列 / 随笔。
//   E3 照片池：缩略图网格 + 直传入口 + 本地导入命令提示
//   E4 编辑页：字段表单 + 照片勾选网格（缩略图）+ 拖拽排序 + Vditor 正文
//   E5 保存：拼 YAML frontmatter + 正文 → Contents API PUT
//   E6 直传：Canvas 2560px WebP + 缩略图 + sidecar 追加（EXIF 全空，标「EXIF 待补」）
//
// 逻辑都在同目录的纯函数模块里（yaml / markdown / github / photos / imageplan / storage），
// 本文件只做三件事：状态（state）、渲染（render*）、事件（handler）。
// 单测跑的是那些纯函数；交互与保存链路由 tests/e2e/admin*.spec.ts 打。
// =============================================================================

import {
  BRANCH,
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  OWNER,
  RAW_BASE,
  REPO,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
} from './config.js';
import { createGitHubClient } from './github.js';
import { createTokenStore } from './storage.js';
import * as api from './api.js';
import {
  entryPhotoId,
  makeBaseName,
  movePhoto,
  poolRelPath,
  rawPhotoUrl,
  poolPhotoPath,
  thumbIdOf,
  togglePhoto,
} from './photos.js';
import { planCompression } from './imageplan.js';
import { decodeImageFile, encodeScaled } from './imaging.js';
import { mountEditor } from './editor.js';
import { isValidSlug, postSlugOf, slugFromTitle, validateFields } from './markdown.js';

// -----------------------------------------------------------------------------
// 状态
// -----------------------------------------------------------------------------
const state = {
  token: '',
  client: null,
  view: 'login', // login | photos | series | posts | edit
  pool: [],
  poolSha: '',
  entries: { series: null, posts: null },
  editing: null,
  message: '',
  /** 列表页状态条的口气：成功 ok / 失败 error，别把报错染成绿色。 */
  messageTone: 'ok',
};

/** 拖拽源下标（HTML5 dnd 在 dragstart 里记，drop 里用）。 */
let dragFrom = -1;

const store = createTokenStore({
  local: safeStorage('localStorage'),
  session: safeStorage('sessionStorage'),
});

/** 存储不可用（无痕 / 被禁用）时返回 undefined，storage.js 会静默跳过。 */
function safeStorage(name) {
  try {
    return window[name] ?? undefined;
  } catch {
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------------
const $view = () => document.getElementById('view');
const $nav = () => document.getElementById('nav');
const $logout = () => document.getElementById('logout');

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  node.replaceChildren();
  return node;
}

/** 统一的错误话术：GitHubApiError 自带中文说明，其余直接用 message。 */
function describeError(error) {
  if (!error) return '未知错误';
  return String(error.message ?? error);
}

function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 照片预览地址（池内图片构建后不由站点按原路径服务，只能从仓库原始地址取）。 */
function previewUrl(relPath) {
  return rawPhotoUrl({
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    rawBase: RAW_BASE,
    path: poolPhotoPath(relPath),
  });
}

/** 缩略图相对路径：sidecar 的 thumb 优先，缺就用 ID 推。 */
function thumbPathOf(entry) {
  const raw = String(entry?.thumb ?? '').trim();
  if (raw) return raw;
  return poolRelPath(thumbIdOf(entryPhotoId(entry)));
}

/** 一张缩略图（加载失败退成占位块，不让网格出现一堆破图标）。 */
function thumbNode(entry, options = {}) {
  const { className = 'shot' } = typeof options === 'string' ? { className: options } : options;
  const id = entryPhotoId(entry);
  const img = el('img', {
    class: className,
    src: previewUrl(thumbPathOf(entry)),
    alt: id,
    loading: 'lazy',
    decoding: 'async',
    width: Number(entry?.thumbWidth) || undefined,
    height: Number(entry?.thumbHeight) || undefined,
  });
  img.addEventListener('error', () => {
    img.replaceWith(el('div', { class: 'broken', 'data-testid': 'thumb-broken' }, ['预览不可用（离线或仓库非公开）']));
  });
  return img;
}

// -----------------------------------------------------------------------------
// 登录 / 启动
// -----------------------------------------------------------------------------
function renderLogin(message = '') {
  const view = clear($view());
  $nav().hidden = true;
  $logout().hidden = true;

  const tokenInput = el('input', {
    type: 'password',
    name: 'token',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '粘贴访问令牌',
    'data-testid': 'token-input',
    'aria-label': '访问令牌',
  });
  const remember = el('input', { type: 'checkbox', id: 'remember', 'data-testid': 'remember' });
  const error = el('p', { class: 'status error', 'data-testid': 'login-error' }, [message]);
  const submit = el('button', { class: 'btn', type: 'submit', 'data-testid': 'login-submit' }, ['登录']);

  const form = el(
    'form',
    {
      class: 'login',
      'data-testid': 'login',
      onsubmit: (event) => {
        event.preventDefault();
        doLogin(tokenInput.value, remember.checked);
      },
    },
    [
      el('h1', {}, ['内容后台']),
      el('p', { class: 'muted' }, [
        '粘贴你在 GitHub 生成的访问令牌，只填这一次。令牌只存在这台电脑的浏览器里（勾「记住」存 localStorage，不勾只活在当前标签页），不会进仓库。',
      ]),
      el('ol', {}, [
        el('li', {}, ['GitHub → Settings → Developer settings → Personal access tokens (classic)']),
        el('li', {}, ['勾选 repo 一项，生成后整串复制']),
        el('li', {}, ['回到这个页面粘贴 → 登录']),
      ]),
      el('div', { class: 'field' }, [tokenInput]),
      el('div', { class: 'field inline' }, [remember, el('label', { for: 'remember' }, ['记住这台浏览器'])]),
      el('div', { class: 'row' }, [submit]),
      error,
      el('p', { class: 'hint' }, [
        `仓库 ${OWNER}/${REPO} · 分支 ${BRANCH} · 只走 GitHub Contents API`,
      ]),
    ],
  );
  view.append(form);
  tokenInput.focus();
}

/**
 * 用令牌把后台接上仓库（登录 + 自动恢复共用）。
 *
 * persist=false 用于「页面加载时从存储里读回令牌」：这时**不能**重新写存储，
 * 否则会把 localStorage 里的「记住」令牌降级成 sessionStorage（换标签页就要重新登录）。
 */
async function connectWithToken(token, { remember = false, persist = false } = {}) {
  const clean = String(token ?? '').trim();
  if (!clean) throw new Error('先把令牌粘贴进来');
  const client = createGitHubClient({ token: clean, owner: OWNER, repo: REPO, branch: BRANCH });
  const pool = await api.loadPool(client);
  state.token = clean;
  state.client = client;
  state.pool = pool.sidecar;
  state.poolSha = pool.sha;
  state.view = 'photos';
  if (persist) store.save(clean, remember);
  render();
}

async function doLogin(token, remember) {
  try {
    await connectWithToken(token, { remember: Boolean(remember), persist: true });
  } catch (error) {
    renderLogin(describeError(error));
  }
}

function logout() {
  store.clear();
  state.token = '';
  state.client = null;
  state.pool = [];
  state.poolSha = '';
  state.entries = { series: null, posts: null };
  state.editing = null;
  state.view = 'login';
  renderLogin();
}

async function bootstrap() {
  const token = store.read();
  if (!token) {
    renderLogin();
    return;
  }
  try {
    await connectWithToken(token);
  } catch (error) {
    renderLogin(describeError(error));
  }
}

// -----------------------------------------------------------------------------
// 渲染分发
// -----------------------------------------------------------------------------
function render() {
  if (!state.client) {
    renderLogin();
    return;
  }
  $nav().hidden = false;
  $logout().hidden = false;
  for (const button of $nav().querySelectorAll('[data-nav]')) {
    const key = button.dataset.nav;
    const active = state.view === key || (state.view === 'edit' && key === state.editing?.collection);
    button.setAttribute('aria-current', active ? 'true' : 'false');
  }
  if (state.view === 'photos') renderPhotos();
  else if (state.view === 'series' || state.view === 'posts') renderList(state.view);
  else if (state.view === 'edit') renderEdit();
  else renderLogin();
}

// -----------------------------------------------------------------------------
// E3 · 照片池
// -----------------------------------------------------------------------------
function renderPhotos() {
  const view = clear($view());
  const status = el('span', { class: 'status', 'data-testid': 'upload-status' }, [state.message]);

  const input = el('input', { type: 'file', accept: 'image/*', multiple: true, 'data-testid': 'upload-input' });
  input.hidden = true;
  input.addEventListener('change', () => handleUploads(input.files, input, status));

  const bar = el('div', { class: 'bar' }, [
    el('label', { class: 'btn small' }, ['直传照片', input]),
    el('span', { class: 'hint', 'data-testid': 'upload-hint' }, ['浏览器直传会重编码成 2560px WebP：画质够用，EXIF 全丢（池里标「EXIF 待补」）。在意拍摄参数的图请在本地跑']),
    el('code', {}, ['npm run import -- --pool']),
    el('span', { class: 'spacer' }),
    status,
  ]);

  const grid = el('div', { class: 'grid', 'data-testid': 'pool-grid' });
  for (const entry of state.pool) grid.append(poolTile(entry));

  view.append(
    el('h2', {}, ['照片池']),
    el('p', { class: 'muted', 'data-testid': 'pool-count' }, [
      `${state.pool.length} 张 · 唯一位置 src/content/pool/photos/ · 登记表 src/content/pool/photos.meta.json`,
    ]),
    bar,
    state.pool.length ? grid : el('p', { class: 'empty', 'data-testid': 'pool-empty' }, ['池里还没有照片。']),
  );
}

function poolTile(entry) {
  const id = entryPhotoId(entry);
  const caption = el('figcaption', {}, [el('span', { class: 'name', title: id }, [id])]);
  if (api.isExifPending(entry)) {
    caption.append(el('span', { class: 'badge', 'data-testid': 'exif-pending' }, ['EXIF 待补']));
  }
  return el('figure', { class: 'tile', 'data-testid': 'pool-tile', 'data-photo-id': id }, [
    thumbNode(entry),
    caption,
  ]);
}

/**
 * 直传一张照片（E6）。
 * 展示版 2560px / 缩略图 800px，均从原图直接采样（缩略图不从展示版二次采样，少一次质量损失）。
 */
async function handleUploads(fileList, input, status) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return;
  if (!state.client) return;
  status.className = 'status';
  status.textContent = `直传 ${files.length} 张…`;
  input.disabled = true;
  let done = 0;
  const failures = [];

  for (const file of files) {
    let decoded;
    try {
      decoded = await decodeImageFile(file);
      const displayPlan = planCompression({
        width: decoded.width,
        height: decoded.height,
        longEdge: DISPLAY_LONG_EDGE,
      });
      const thumbPlan = planCompression({
        width: decoded.width,
        height: decoded.height,
        longEdge: THUMB_LONG_EDGE,
      });
      const display = await encodeScaled(decoded, displayPlan, DISPLAY_QUALITY);
      const thumb = await encodeScaled(decoded, thumbPlan, THUMB_QUALITY);
      const baseName = makeBaseName();
      const saved = await api.uploadPhoto(state.client, {
        bytes: display.bytes,
        thumbBytes: thumb.bytes,
        baseName,
        width: display.width,
        height: display.height,
        thumbWidth: thumb.width,
        thumbHeight: thumb.height,
        pool: { sidecar: state.pool, sha: state.poolSha },
      });
      state.pool = saved.sidecar;
      state.poolSha = saved.sha;
      done += 1;
    } catch (error) {
      failures.push(`${file.name}：${describeError(error)}`);
    } finally {
      decoded?.close?.();
    }
  }

  input.disabled = false;
  input.value = '';
  state.message = failures.length
    ? `成功 ${done} 张；失败 ${failures.length} 张 → ${failures.join('；')}`
    : `已直传 ${done} 张（已 commit，等 Pages 重建后前台可见）`;
  renderPhotos();
  const fresh = document.querySelector('[data-testid="upload-status"]');
  if (fresh) {
    fresh.className = failures.length ? 'status error' : 'status ok';
    fresh.textContent = state.message;
  }
}

// -----------------------------------------------------------------------------
// 系列 / 随笔 列表
// -----------------------------------------------------------------------------
function renderList(collection) {
  const view = clear($view());
  const label = collection === 'series' ? '系列' : '随笔';
  const entries = state.entries[collection];
  const body = el('div', { 'data-testid': 'entry-list' });

  // 列表页也要有状态条：删除、加载失败、新建成功这些提示都发生在这个视图，
  // 没有它的话操作完只剩「什么都没发生」——和 2026-10-24 那个保存反馈是同一个坑。
  if (state.message) {
    view.append(
      el('p', { class: `status ${state.messageTone}`, 'data-testid': 'status' }, [
        state.message,
      ]),
    );
    state.message = '';
    state.messageTone = 'ok';
  }

  if (entries === null) {
    body.append(el('p', { class: 'empty' }, ['读取中…']));
    view.append(el('h2', {}, [label]), body);
    ensureEntries(collection);
    return;
  }

  if (entries.length === 0) {
    body.append(el('p', { class: 'empty', 'data-testid': 'entry-empty' }, [`还没有${label}。`]));
  } else {
    const list = el('ul', { class: 'list' });
    for (const row of entries) {
      list.append(
        el('li', { 'data-testid': 'entry-row', 'data-path': row.path }, [
          el('span', { class: 't' }, [row.fields.title || '（无题）']),
          el('span', { class: 'meta' }, [
            `${row.fields.date || '无日期'} · ${row.photos} 张${collection === 'series' ? ` · 权重 ${row.fields.order}` : ''}`,
          ]),
          row.fields.draft ? el('span', { class: 'badge' }, ['草稿']) : null,
          el('span', { class: 'spacer' }),
          el(
            'button',
            {
              class: 'btn plain small',
              type: 'button',
              'data-testid': 'entry-edit',
              onclick: () => openEntry(collection, row.path),
            },
            ['编辑'],
          ),
        ]),
      );
    }
    body.append(list);
  }

  view.append(
    el('div', { class: 'bar' }, [
      el('h2', {}, [label]),
      el('span', { class: 'spacer' }),
      el(
        'button',
        {
          class: 'btn small',
          type: 'button',
          'data-testid': 'new-entry',
          onclick: () => startNewEntry(collection),
        },
        [`新建${label}`],
      ),
    ]),
    body,
  );
}

async function ensureEntries(collection) {
  try {
    state.entries[collection] = await api.listEntries(state.client, collection);
  } catch (error) {
    state.entries[collection] = [];
    state.messageTone = 'error';
    state.message = describeError(error);
  }
  if (state.view === collection) renderList(collection);
}

// -----------------------------------------------------------------------------
// E4/E5 · 编辑页
// -----------------------------------------------------------------------------
function emptyFields(collection) {
  const fields = {
    title: '',
    date: todayIso(),
    cover: '',
    tags: [],
    draft: false,
    photos: [],
  };
  if (collection === 'series') fields.order = 0;
  return fields;
}

function startNewEntry(collection) {
  state.editing = {
    collection,
    path: '',
    sha: '',
    isNew: true,
    slug: '',
    fields: emptyFields(collection),
    body: '',
    eol: '\n',
    editor: null,
    unknownKeys: [],
  };
  state.view = 'edit';
  render();
}

async function openEntry(collection, path) {
  try {
    const data = await api.readEntry(state.client, collection, path);
    const segments = path.split('/');
    state.editing = {
      ...data,
      isNew: false,
      slug: collection === 'series' ? segments[segments.length - 2] : postSlugOf(segments.pop()),
      editor: null,
    };
    state.view = 'edit';
    render();
  } catch (error) {
    state.messageTone = 'error';
    state.message = describeError(error);
    state.view = collection;
    render();
  }
}

function renderEdit() {
  const editing = state.editing;
  if (!editing) {
    state.view = 'photos';
    render();
    return;
  }
  const isSeries = editing.collection === 'series';
  const label = isSeries ? '系列' : '随笔';
  const view = clear($view());

  const title = el('input', {
    type: 'text',
    'data-field': 'title',
    value: editing.fields.title,
    placeholder: '标题',
  });
  const date = el('input', { type: 'date', 'data-field': 'date', value: editing.fields.date });
  // 新建时边打标题边显示将来落在哪个路径 —— 用户能提前看到 /series/夜光城市/ 这种 URL，
  // 觉得不合适就改标题，而不是存完才发现。
  if (editing.isNew) {
    title.addEventListener('input', () => {
      const preview = slugFromTitle(title.value);
      const pathEl = document.querySelector('[data-testid="entry-path"]');
      if (!pathEl) return;
      pathEl.textContent = preview
        ? api.newEntryPath(editing.collection, { slug: preview, date: date.value })
        : '（标题里要有文字或数字，才能生成路径）';
    });
    date.addEventListener('change', () => title.dispatchEvent(new Event('input')));
  }
  const tags = el('input', {
    type: 'text',
    'data-field': 'tags',
    value: editing.fields.tags.join(', '),
    placeholder: '用逗号分隔，例如 城市, 夜景',
  });
  const orderInput = isSeries
    ? el('input', { type: 'number', 'data-field': 'order', value: String(editing.fields.order), step: '1' })
    : null;
  const draft = el('input', { type: 'checkbox', 'data-testid': 'draft' });
  draft.checked = Boolean(editing.fields.draft);

  const cover = el('div', { class: 'cover-picker', 'data-testid': 'cover' });

  const picker = el('div', { class: 'grid', 'data-testid': 'photo-picker' });
  // 78 张全展开会把表单撑成好几屏，默认收起，点「＋ 选择照片」才展开。
  picker.hidden = true;
  const pickerToggle = el(
    'button',
    {
      class: 'btn plain small',
      type: 'button',
      'data-testid': 'picker-toggle',
      'aria-expanded': 'false',
      onclick: () => {
        picker.hidden = !picker.hidden;
        pickerToggle.setAttribute('aria-expanded', String(!picker.hidden));
        pickerToggle.textContent = picker.hidden ? '＋ 选择照片' : '收起照片网格';
      },
    },
    ['＋ 选择照片'],
  );
  const order = el('div', { class: 'order', 'data-testid': 'photo-order' });
  const editorHost = el('div', { class: 'editor', 'data-testid': 'editor' });
  const status = el('p', { class: 'status', 'data-testid': 'status' }, ['']);

  const fieldsBox = el('div', {}, [
    field('标题', title),
    field('日期', date),
    // 标识行整块去掉了：新建时由标题自动派生（见 slugFromTitle），
    // 已存在的条目改标识 = 换目录，本来就不支持。用户不用再想英文名。
    field('标签', tags),
    ...(orderInput ? [field('排序权重（越小越靠前）', orderInput)] : []),
    field('封面', cover, '从已勾选的照片里挑；留空 = 前台用第一张。'),
    el('div', { class: 'field inline' }, [draft, el('label', { 'data-testid': 'draft-label' }, ['草稿（不进公开页面）'])]),
  ]);

  const saveButton = el(
    'button',
    { class: 'btn', type: 'button', 'data-testid': 'save', onclick: () => saveEditing(status) },
    [editing.isNew ? '新建并保存' : '保存'],
  );
  // 删除是破坏性动作，用内联二次确认：第一次点变「确认删除」并在顶栏给出说明，
  // 5 秒内再点才真删。不用原生 confirm —— 它的样式不可控，且在某些环境会被静默拦掉。
  let deleteArmed = false;
  let deleteTimer = null;
  const deleteButton = editing.isNew
    ? null
    : el(
        'button',
        {
          class: 'btn plain small danger',
          type: 'button',
          'data-testid': 'delete',
          onclick: () => {
            if (!deleteArmed) {
              deleteArmed = true;
              deleteButton.textContent = '确认删除';
              deleteButton.classList.add('armed');
              setStatus(
                status,
                `再点一次「确认删除」就会删掉这个${label}；照片仍留在池里，不受影响。`,
                'error',
              );
              deleteTimer = setTimeout(() => {
                deleteArmed = false;
                deleteButton.textContent = '删除';
                deleteButton.classList.remove('armed');
              }, 5000);
              return;
            }
            clearTimeout(deleteTimer);
            deleteEditing(status);
          },
        },
        ['删除'],
      );
  const backButton = el(
    'button',
    {
      class: 'btn plain small',
      type: 'button',
      'data-testid': 'back',
      onclick: () => {
        state.view = editing.collection;
        render();
      },
    },
    ['返回列表'],
  );

  view.append(
    el('div', { class: 'bar' }, [
      el('h2', {}, [editing.isNew ? `新建${label}` : `编辑${label}`]),
      el('span', { class: 'mono hint', 'data-testid': 'entry-path' }, [editing.path || '（保存时按标识生成路径）']),
      el('span', { class: 'spacer' }),
      backButton,
      deleteButton,
      saveButton,
      // 保存反馈必须贴着按钮：表单有字段 + 78 张照片网格 + 正文编辑器，
      // 若把状态放在表单末尾，点顶部的按钮时提示在几屏之外，等于没有反馈。
      status,
    ]),
    el('section', { class: 'edit', 'data-testid': 'edit-view', 'data-collection': editing.collection }, [
      el('h3', {}, ['字段']),
      fieldsBox,
      el('h3', {}, ['照片（勾选顺序 = 前台照片流顺序，可拖拽调整）']),
      order,
      el('p', { class: 'hint' }, ['在下面的缩略图网格里点选；勾中的按顺序排在上面，拖动小图可改顺序（键盘：选中后 Alt + ←/→）。']),
      pickerToggle,
      picker,
      el('h3', {}, ['正文']),
      editorHost,
    ]),
  );

  // 表单值 → 内存态（保存前再读一次，避免丢掉光标外的输入）
  for (const input of [title, date, tags, orderInput]) {
    if (!input) continue;
    input.addEventListener('input', () => readFields(editing, { title, date, tags, orderInput, draft, slug }));
  }
  draft.addEventListener('change', () => readFields(editing, { title, date, tags, orderInput, draft, slug }));

  editing.dom = { title, date, tags, orderInput, draft, cover, picker, order, editorHost, status };
  buildPicker(picker);
  refreshPhotoUI();
  // 封面是缩略图按钮组（不是 select），选中即写回 fields，无需 change 监听。

  editing.editor = null;
  mountEditor(editorHost, { value: editing.body }).then((adapter) => {
    editing.editor = adapter;
  });
}

/** 一个带说明的表单项。 */
function field(labelText, input, tip) {
  const wrapper = el('div', { class: 'field' }, [el('label', {}, [labelText]), input]);
  if (tip) wrapper.append(el('p', { class: 'tip' }, [tip]));
  return wrapper;
}

/** 表单 DOM → editing.fields。 */
function readFields(editing, dom) {
  editing.fields.title = dom.title.value;
  editing.fields.date = dom.date.value;
  editing.fields.tags = dom.tags.value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (dom.orderInput) editing.fields.order = Number(dom.orderInput.value);
  editing.fields.draft = dom.draft.checked;
  // 新建条目：标识由标题派生，用户不用管。已存在的条目保留原 path 里的标识
  // （改标题不该偷偷把目录改了，那会让旧链接 404）。
  if (editing.isNew) editing.slug = slugFromTitle(editing.fields.title);
}

/** 勾选网格：池里每张一张小图 + 一个复选框；点小图或复选框都算勾/取消。 */
function buildPicker(picker) {
  clear(picker);
  for (const entry of state.pool) {
    const id = entryPhotoId(entry);
    const box = el('input', {
      type: 'checkbox',
      class: 'pick-box',
      'data-testid': 'pick-box',
      'data-photo-id': id,
      'aria-label': `勾选 ${id}`,
    });
    box.addEventListener('change', () => togglePick(id));
    const tile = el('figure', { class: 'tile pickable', 'data-testid': 'pick-tile', 'data-photo-id': id }, [
      thumbNode(entry),
      el('label', { class: 'pick', title: '勾选 / 取消' }, [
        box,
        el('span', { class: 'pick-no', 'data-testid': 'pick-num' }, ['+']),
      ]),
      el('figcaption', {}, [
        el('span', { class: 'name', title: id }, [id]),
        api.isExifPending(entry) ? el('span', { class: 'badge', 'data-testid': 'exif-pending' }, ['EXIF 待补']) : null,
      ]),
    ]);
    tile.addEventListener('click', (event) => {
      // 复选框自己会触发 change 事件；点小图的其他位置也算「勾 / 取消」
      if (event.target instanceof Element && event.target.closest('.pick')) return;
      event.preventDefault();
      togglePick(id);
    });
    picker.append(tile);
  }
}

function togglePick(id) {
  const editing = state.editing;
  if (!editing) return;
  setPhotos(togglePhoto(editing.fields.photos, id));
}

function setPhotos(next) {
  const editing = state.editing;
  if (!editing) return;
  editing.fields.photos = Array.isArray(next) ? next.slice() : [];
  if (editing.fields.cover && !editing.fields.photos.includes(editing.fields.cover)) {
    editing.fields.cover = '';
  }
  refreshPhotoUI();
}

/** 勾选态 + 顺序条 + 封面临时选项，全部按 editing.fields 重刷（不重建整个页面）。 */
function refreshPhotoUI() {
  const editing = state.editing;
  const dom = editing?.dom;
  if (!dom) return;
  const photos = editing.fields.photos;

  for (const tile of dom.picker.querySelectorAll('[data-photo-id]')) {
    const id = tile.dataset.photoId;
    const index = photos.indexOf(id);
    tile.classList.toggle('picked', index !== -1);
    const box = tile.querySelector('.pick-box');
    if (box) box.checked = index !== -1;
    const num = tile.querySelector('.pick-no');
    if (num) num.textContent = index === -1 ? '+' : String(index + 1);
  }

  clear(dom.order);
  photos.forEach((id, index) => {
    const entry = state.pool.find((item) => entryPhotoId(item) === id);
    const item = el(
      'div',
      {
        class: 'order-item',
        draggable: 'true',
        tabindex: '0',
        'data-testid': 'order-item',
        'data-photo-id': id,
        'data-index': String(index),
        title: `${index + 1}. ${id}`,
      },
      [
        entry ? thumbNode(entry) : el('div', { class: 'broken', 'data-testid': 'thumb-broken' }, ['池里查不到这张']),
        el('span', { class: 'no' }, [`${index + 1}`]),
      ],
    );
    item.addEventListener('dragstart', (event) => {
      dragFrom = index;
      item.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      dragFrom = -1;
    });
    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      item.classList.add('over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('over'));
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      item.classList.remove('over');
      const from = dragFrom >= 0 ? dragFrom : Number(event.dataTransfer?.getData('text/plain'));
      if (!Number.isInteger(from) || from < 0) return;
      setPhotos(movePhoto(editing.fields.photos, from, index));
      dragFrom = -1;
    });
    item.addEventListener('keydown', (event) => {
      if (!event.altKey) return;
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        setPhotos(movePhoto(editing.fields.photos, index, index - 1));
      } else if (event.key === 'ArrowRight' && index < photos.length - 1) {
        event.preventDefault();
        setPhotos(movePhoto(editing.fields.photos, index, index + 1));
      }
    });
    dom.order.append(item);
  });

  const previous = editing.fields.cover;
  clear(dom.cover);
  // 「不指定」+ 每张已勾选照片的小缩略图：封面要一眼看出是哪张，纯文字下拉做不到。
  const makeOption = (id, index) => {
    const selected = (previous || '') === id;
    const entry = id ? state.pool.find((row) => entryPhotoId(row) === id) : null;
    const node = el(
      'button',
      {
        type: 'button',
        class: `cover-option${selected ? ' selected' : ''}`,
        'data-testid': 'cover-option',
        'data-photo-id': id,
        'aria-pressed': String(selected),
        title: id || '不指定（前台用第一张）',
        onclick: () => {
          editing.fields.cover = id;
          refreshPhotoUI();
        },
      },
      [
        id && entry ? thumbNode(entry, 'cover-thumb') : el('span', { class: 'cover-none' }, ['—']),
        el('span', { class: 'cover-label' }, [id ? `${index + 1}. ${id}` : '不指定']),
      ],
    );
    return node;
  };
  dom.cover.append(makeOption('', -1));
  photos.forEach((id, index) => {
    dom.cover.append(makeOption(id, index));
  });
  if (!photos.includes(previous)) editing.fields.cover = '';
}

function setStatus(statusEl, text, kind = '') {
  statusEl.className = `status ${kind}`.trim();
  statusEl.textContent = text;
}

/** E5 · 保存：校验 → 拼 frontmatter + 正文 → PUT。 */
async function saveEditing(statusEl) {
  const editing = state.editing;
  if (!editing || !state.client) return;
  const dom = editing.dom;
  const saveBtn = /** @type {HTMLButtonElement|null} */ (
    document.querySelector('[data-testid="save"]')
  );
  const idleLabel = editing.isNew ? '新建并保存' : '保存';

  /** 保存期间禁用按钮并改文案：点击后立刻有可见变化，也顺带防双击重复提交。 */
  const setBusy = (busy) => {
    if (!saveBtn) return;
    saveBtn.disabled = busy;
    saveBtn.textContent = busy ? '保存中…' : idleLabel;
  };

  readFields(editing, dom);
  const poolIds = api.poolIds(state.pool);
  const errors = validateFields(editing.fields, { collection: editing.collection, poolIds });

  let path = editing.path;
  if (editing.isNew) {
    if (!isValidSlug(editing.slug)) {
      errors.push(
        '标题里没有能用作路径的文字或数字（纯标点？），给标题加点内容再保存',
      );
    } else {
      path = api.newEntryPath(editing.collection, { slug: editing.slug, date: editing.fields.date });
      const existing = state.entries[editing.collection] ?? [];
      const clash = existing.some((row) => row.path === path);
      if (clash) errors.push(`已存在同路径的条目：${path}`);
      if (editing.collection === 'series' && existing.some((row) => row.id === editing.slug)) {
        errors.push(`系列标识已被占用：${editing.slug}`);
      }
    }
  }

  if (errors.length > 0) {
    setStatus(statusEl, errors.join('；'), 'error');
    return;
  }

  const body = editing.editor ? editing.editor.getValue() : editing.body;
  editing.body = body;
  setBusy(true);
  setStatus(statusEl, '保存中…');
  try {
    const result = await api.saveEntry(state.client, {
      collection: editing.collection,
      path,
      sha: editing.sha,
      fields: editing.fields,
      body,
      eol: editing.eol,
      created: editing.isNew,
    });
    editing.path = result.path;
    editing.sha = result.sha;
    editing.isNew = false;
    editing.unknownKeys = [];
    const pathEl = document.querySelector('[data-testid="entry-path"]');
    if (pathEl) pathEl.textContent = result.path;
    state.entries[editing.collection] = null;
    setStatus(statusEl, `已保存：${result.path}（commit ${String(result.commit).slice(0, 7)}）`, 'ok');
  } catch (error) {
    setStatus(statusEl, describeError(error), 'error');
  } finally {
    setBusy(false);
  }
}

/**
 * 删一个条目（只删 .md，照片留在池里）。
 * 只由顶栏「确认删除」第二步调用 —— 第一步的二次确认在按钮自己的 onclick 里。
 */
async function deleteEditing(statusEl) {
  const editing = state.editing;
  if (!editing || !state.client || editing.isNew) return;
  const deleteBtn = /** @type {HTMLButtonElement|null} */ (
    document.querySelector('[data-testid="delete"]')
  );
  const saveBtn = /** @type {HTMLButtonElement|null} */ (
    document.querySelector('[data-testid="save"]')
  );
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = '删除中…';
  }
  if (saveBtn) saveBtn.disabled = true;
  setStatus(statusEl, '删除中…');
  try {
    const result = await api.deleteEntry(state.client, {
      path: editing.path,
      collection: editing.collection,
      title: editing.fields.title,
    });
    // 直接从缓存里摘掉这一项，不要置 null —— 置 null 会让 renderList 去重新拉列表，
    // 拉完再 render 一次就把刚写好的「已删除」提示冲掉了（用户又看到「什么都没发生」）。
    const cached = state.entries[editing.collection];
    state.entries[editing.collection] = Array.isArray(cached)
      ? cached.filter((row) => row.path !== editing.path)
      : null;
    state.editing = null;
    state.view = editing.collection;
    state.messageTone = 'ok';
    state.message = `已删除：${result.path}（commit ${String(result.commit).slice(0, 7)}）；照片仍在池里。`;
    render();
  } catch (error) {
    setStatus(statusEl, describeError(error), 'error');
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = '删除';
    }
    if (saveBtn) saveBtn.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// 顶栏 / 启动
// -----------------------------------------------------------------------------
function bindChrome() {
  for (const button of $nav().querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.nav;
      state.view = key;
      state.editing = null;
      render();
    });
  }
  $logout().addEventListener('click', logout);
}

bindChrome();
bootstrap();

// 测试与排障用的只读入口（浏览器控制台 / Playwright 断言用；不含令牌）
window.__admin = {
  state,
  actions: { doLogin, logout, saveEditing, setPhotos, togglePick, startNewEntry, openEntry },
  previewUrl,
};
