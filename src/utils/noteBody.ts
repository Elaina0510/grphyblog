// =============================================================================
// noteBody —— 「拍摄手记要不要出现」的纯判定（series-pages §5 任务 4/5：body 为空则整块省略）
//
// 为什么单独成模块：详情页「手记块」不该因「frontmatter 齐、但正文还没写」而留一个空壳。
// 但 import 脚本新建的草稿正文往往只有一句 HTML 注释（见 series/daily-frames/index.md），
// 直接把 `entry.body` 的非空判断当「有手记」会误判。这里把「肉眼可见的正文文字」抽干净再判。
//
// 口径（与首页 excerpt() 同源的去标记思路，但只做「有无」判定，不产出摘要）：
//   - 去 HTML 注释 / 代码围栏 / 图片与链接语法（保留链接文字）/ 标题引用强调等 Markdown 记号；
//   - 折叠空白；
//   - 剩下的可见文字为空 → 无手记（页面据此省略整块）。
// 纯函数——不 import Astro/Node，可在 Node 单测直接跑。
// =============================================================================

/** 把 Markdown 正文剥成「只剩可见文字」的归一化串（可能为空串）。 */
export function normalizeNoteBody(body: string | null | undefined): string {
  return String(body ?? '')
    .replace(/```[\s\S]*?```/g, ' ') // 代码围栏整块
    .replace(/~~~[\s\S]*?~~~/g, ' ') // 备用围栏
    .replace(/<!--[\s\S]*?-->/g, ' ') // HTML 注释（草稿占位常见）
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片/链接：留文字丢地址
    .replace(/^#{1,6}\s+/gm, '') // 标题井号
    .replace(/^\s*>\s?/gm, '') // 引用
    .replace(/^\s*[-*+]\s+/gm, '') // 无序列表记号
    .replace(/^\s*\d+\.\s+/gm, '') // 有序列表记号
    .replace(/[*_~`]/g, ' ') // 强调 / 删除线 / 行内码
    .replace(/\s+/g, ' ') // 折叠所有空白
    .trim();
}

/** 该正文是否含「肉眼可见的手记文字」；空 / 纯注释 / 纯符号 → false（页面据此省略手记块）。 */
export function hasNoteContent(body: string | null | undefined): boolean {
  return normalizeNoteBody(body).length > 0;
}

export default hasNoteContent;
