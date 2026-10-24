import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { installGitHubMock, seedToken, SERIES_MD, POST_MD, type MockHandle } from './helpers/admin-mock';

// =============================================================================
// E4/E5 · 编辑页与保存（admin-v2.md「字段表单 + 照片勾选网格 + 拖拽排序 + 富文本」
//                           「保存：拼 YAML frontmatter + 正文 → Contents API PUT」）
//
// 这是后台最核心的链路，逐个断言：
//   ① 字段回填与 schema 对齐（title / date / tags / order / cover / draft / photos）；
//   ② 勾选 = 追加到 photos 数组末尾；再点一次 = 从数组里移除；
//   ③ 拖拽 = 数组重排，**顺序就是前台照片流顺序**；
//   ④ 保存 = 一次 PUT，body 里的 md 由 frontmatter + 正文拼成，CRLF 与原文一致；
//   ⑤ 新建 = PUT 到新路径且不带 sha（GitHub 需要「创建」而不是「覆盖」）。
//
// Vditor 由 CDN 供，e2e 里 CDN 被 abort —— 编辑页会落到 textarea 兜底（真实降级路径）。
// =============================================================================

let mock: MockHandle;

/**
 * 从真实内容文件取标题。
 * 标题是用户在后台随手会改的东西（「夜光 · 城市666」→「…nhnhnhn」已经改过两次），
 * 断言写死具体字样会让测试因为「内容变了」而红，那是假警报，不是回归。
 */
function titleOf(rel: string): string {
  const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
  const m = /^title:\s*(.+?)\s*$/m.exec(text.replace(/\r?\n/g, '\n'));
  if (!m) throw new Error(`${rel} 里没有 title`);
  return m[1].replace(/^['"]|['"]$/g, '');
}

test.beforeEach(async ({ page }) => {
  mock = await installGitHubMock(page);
  await seedToken(page);
  await page.goto('/admin/');
  await expect(page.locator('[data-testid="pool-grid"]')).toBeVisible();
});

async function openSeries(page: Page): Promise<void> {
  await page.click('[data-testid="nav-series"]');
  await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
  await page.click('[data-testid="entry-edit"]');
  await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="body"]')).toBeVisible();
}

/** 照片网格默认收起（B5 反馈），点「＋ 选择照片」才展开。 */
async function openPicker(page: Page): Promise<void> {
  const toggle = page.locator('[data-testid="picker-toggle"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('[data-testid="photo-picker"]')).toBeVisible();
}

/** 从保存的 md 文本里取 photos 列表（只取 .webp 项，避开 tags 的块序列）。 */
function photosInMarkdown(text: string): string[] {
  const block = /photos:\n((?:  - .*\n?)+)/.exec(text.replace(/\r\n/g, '\n'));
  return (block?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.webp'))
    .map((line) => line.replace(/^- /, ''));
}

async function photosState(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __admin: { state: { editing: { fields: { photos: string[] } } } };
        }
      ).__admin.state.editing.fields.photos,
  );
}

test.describe('E4 编辑页', () => {
  test('打开已有系列：字段与照片按 frontmatter 回填', async ({ page }) => {
    await openSeries(page);

    await expect(page.locator('[data-field="title"]')).toHaveValue(
      titleOf('src/content/series/city-lights/index.md'),
    );
    await expect(page.locator('[data-field="date"]')).toHaveValue('2026-09-20');
    await expect(page.locator('[data-field="tags"]')).toHaveValue('城市, 夜景, 风光');
    await expect(page.locator('[data-field="order"]')).toHaveValue('3');
    await expect(page.locator('[data-testid="cover-option"].selected')).toHaveAttribute(
      'data-photo-id',
      'night-02.webp',
    );
    await expect(page.locator('[data-testid="draft"]')).not.toBeChecked();
    // 已存在的条目**不再渲染**标识行（改标识 = 换目录，后台不支持；留个禁用框只会占地方）
    await expect(page.locator('[data-testid="slug"]')).toHaveCount(0);
    // 勾选网格把池里 78 张全列出来，已选的 2 张按顺序排在顺序条上
    await openPicker(page);
    await expect(page.locator('[data-testid="pick-tile"]')).toHaveCount(78);
    await expect(page.locator('[data-testid="order-item"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="order-item"]').first()).toHaveAttribute(
      'data-photo-id',
      'night-01.webp',
    );
    expect(await photosState(page)).toEqual(['night-01.webp', 'night-02.webp']);
  });

  test('勾选 / 取消：photos 数组追加与移除都实时生效', async ({ page }) => {
    await openSeries(page);
    await openPicker(page);

    await page.click('[data-testid="pick-tile"][data-photo-id="P1100451.webp"]');
    await expect(page.locator('[data-testid="order-item"]')).toHaveCount(3);
    expect(await photosState(page)).toEqual(['night-01.webp', 'night-02.webp', 'P1100451.webp']);
    await expect(
      page.locator('[data-testid="pick-tile"][data-photo-id="P1100451.webp"] .pick'),
    ).toHaveText('3');
    // 勾选网格每张都带一个真的复选框（缩略图 + 复选框，E4 原文）
    await expect(
      page.locator('[data-testid="pick-box"][data-photo-id="P1100451.webp"]'),
    ).toBeChecked();

    // 用复选框取消勾选（点缩略图也能取消，两条路都通）
    await page.locator('[data-testid="pick-box"][data-photo-id="night-01.webp"]').uncheck();
    expect(await photosState(page)).toEqual(['night-02.webp', 'P1100451.webp']);
    await expect(page.locator('[data-testid="order-item"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="pick-tile"][data-photo-id="night-01.webp"] .pick')).toHaveText(
      '+',
    );

    // 封面的可选项只来自已勾选照片：把封面选成某张、再取消勾选那张 → 自动回到「不指定」
    await page.click('[data-testid="pick-tile"][data-photo-id="night-01.webp"]');
    await page.click('[data-testid="cover-option"][data-photo-id="night-01.webp"]');
    await page.click('[data-testid="pick-tile"][data-photo-id="night-01.webp"]');
    await expect(page.locator('[data-testid="cover-option"].selected')).toHaveAttribute(
      'data-photo-id',
      '',
    );
  });

  test('拖拽排序：顺序条重排后 photos 数组同步（这就是前台照片流顺序）', async ({ page }) => {
    await openSeries(page);
    await openPicker(page);
    // 先凑够 4 张，拖拽的位移才看得清
    await page.click('[data-testid="pick-tile"][data-photo-id="P1100451.webp"]');
    await page.click('[data-testid="pick-tile"][data-photo-id="P1230857.webp"]');
    expect(await photosState(page)).toEqual([
      'night-01.webp',
      'night-02.webp',
      'P1100451.webp',
      'P1230857.webp',
    ]);

    const items = page.locator('[data-testid="order-item"]');
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await items.nth(2).dispatchEvent('dragstart', { dataTransfer });
    await items.nth(0).dispatchEvent('dragover', { dataTransfer });
    await items.nth(0).dispatchEvent('drop', { dataTransfer });

    await expect
      .poll(() => photosState(page))
      .toEqual(['P1100451.webp', 'night-01.webp', 'night-02.webp', 'P1230857.webp']);
    await expect(page.locator('[data-testid="order-item"]').first()).toHaveAttribute(
      'data-photo-id',
      'P1100451.webp',
    );

    // 键盘也能改顺序（Alt + ←/→）：无障碍，也是「拖拽没成功」时的兜底
    await page.locator('[data-testid="order-item"]').last().focus();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect
      .poll(() => photosState(page))
      .toEqual(['P1100451.webp', 'night-01.webp', 'P1230857.webp', 'night-02.webp']);
  });

  test('保存：一次 PUT，frontmatter 的 photos 顺序 = 拖拽顺序，行尾保留 CRLF', async ({ page }) => {
    await openSeries(page);
    await openPicker(page);

    await page.click('[data-testid="pick-tile"][data-photo-id="P1100451.webp"]');
    const items = page.locator('[data-testid="order-item"]');
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await items.nth(2).dispatchEvent('dragstart', { dataTransfer });
    await items.nth(0).dispatchEvent('dragover', { dataTransfer });
    await items.nth(0).dispatchEvent('drop', { dataTransfer });
    await expect
      .poll(() => photosState(page))
      .toEqual(['P1100451.webp', 'night-01.webp', 'night-02.webp']);

    await page.fill('[data-field="title"]', '夜光 · 城市666');
    await page.click('[data-testid="save"]');
    await expect(page.locator('[data-testid="status"]')).toContainText('已保存');

    const put = mock.puts.find((row) => row.path === SERIES_MD);
    expect(put, '保存没有写到系列的 index.md').toBeTruthy();
    const text = put!.text;
    expect(put!.body.branch).toBe('main');
    expect(put!.body.message).toBe('content(series): 更新系列「夜光 · 城市666」');
    expect(photosInMarkdown(text)).toEqual(['P1100451.webp', 'night-01.webp', 'night-02.webp']);
    // 原有 CRLF 行尾不能被换成 LF（否则整篇 diff）
    expect(text).toContain('\r\n');
    expect(text.startsWith('---\r\n')).toBe(true);
    // frontmatter 的键与 schema 对齐，且正文原样保留
    for (const key of [
      'title:',
      'date: 2026-09-20',
      'cover:',
      'tags:',
      'order: 3',
      'draft: false',
      'photos:',
    ]) {
      expect(text).toContain(key);
    }
    expect(text).toContain('第一次把「城市入夜」当作一个系列来拍。');
  });

  test('随笔：正文经编辑器（CDN 不可用 → 纯文本兜底）写回，特殊字符标题自动加引号', async ({ page }) => {
    await page.click('[data-testid="nav-posts"]');
    await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
    await page.click('[data-testid="entry-edit"]');
    await expect(page.locator('[data-testid="body"]')).toBeVisible();

    await expect(page.locator('[data-field="title"]')).toHaveValue('晨雾里的第一束光');
    await page.fill('[data-field="title"]', '晨雾: 第一束光');
    await page.fill('[data-testid="body"]', '后台写的一段。\n\n![晨雾](photo:dawn-01.webp)');
    await page.click('[data-testid="save"]');
    await expect(page.locator('[data-testid="status"]')).toContainText('已保存');

    const put = mock.puts.find((row) => row.path === POST_MD);
    expect(put).toBeTruthy();
    // 含 ": " 的标题必须加引号，否则 YAML 会被读成 mapping
    expect(put!.text).toContain('title: "晨雾: 第一束光"');
    // 随笔没有 order 键（schema 里也没有）
    expect(put!.text).not.toContain('order:');
    expect(put!.text).toContain('后台写的一段。');
    expect(put!.text).toContain('![晨雾](photo:dawn-01.webp)');
    expect(put!.body.message).toBe('content(posts): 更新随笔「晨雾: 第一束光」');
  });

  test('新建系列：PUT 到 series/<标识>/index.md，且不带 sha（创建而非覆盖）', async ({ page }) => {
    await page.click('[data-testid="nav-series"]');
    await expect(page.locator('[data-testid="entry-row"]').first()).toBeVisible();
    await page.click('[data-testid="new-entry"]');
    await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();

    await page.fill('[data-field="title"]', '新建的系列');
    await page.fill('[data-field="date"]', '2026-10-24');
    await page.fill('[data-testid="slug"]', 'e2e-new-series');
    await page.fill('[data-field="tags"]', '测试, 后台');
    await page.fill('[data-field="order"]', '9');
    await openPicker(page);
    await page.click('[data-testid="pick-tile"][data-photo-id="night-01.webp"]');
    await page.click('[data-testid="cover-option"][data-photo-id="night-01.webp"]');
    await page.fill('[data-testid="body"]', '新系列的开场白。');
    await page.click('[data-testid="save"]');

    await expect(page.locator('[data-testid="status"]')).toContainText('已保存');
    const put = mock.puts.find((row) => row.path === 'src/content/series/e2e-new-series/index.md');
    expect(put, '没有写到新系列的 index.md').toBeTruthy();
    expect(put!.body.sha, '新建不该带 sha（带了就是覆盖语义）').toBeUndefined();
    expect(put!.text).toContain('title: 新建的系列');
    expect(put!.text).toContain('cover: night-01.webp');
    expect(put!.text).toContain('order: 9');
    expect(put!.text).toContain('新系列的开场白。');
    expect(photosInMarkdown(put!.text)).toEqual(['night-01.webp']);
  });

  test('校验：标题为空 / 标识非法时不发 PUT，错误直说', async ({ page }) => {
    await page.click('[data-testid="nav-series"]');
    await page.click('[data-testid="new-entry"]');
    await expect(page.locator('[data-testid="edit-view"]')).toBeVisible();

    await page.fill('[data-testid="slug"]', 'Bad Slug');
    await page.click('[data-testid="save"]');
    await expect(page.locator('[data-testid="status"]')).toContainText('标题不能为空');
    expect(mock.puts).toHaveLength(0);

    await page.fill('[data-field="title"]', '有标题');
    await page.click('[data-testid="save"]');
    await expect(page.locator('[data-testid="status"]')).toContainText('标识只能用小写字母');
    expect(mock.puts).toHaveLength(0);
  });
});
