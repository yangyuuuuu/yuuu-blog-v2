/**
 * 从 Markdown 文件名推导 Astro 生成的文章路径。
 *
 * 为什么要有这个模块：**路径是 Astro 生成的，但清单是构建脚本自己拼的**。
 * 两套规则一旦不一致，页面本身是好的、清单里的链接却全是 404 ——
 * 私人角落和手机写作页点开都打不开，而且很难想到原因。
 *
 * 踩过的实例：
 *   文件 2026-09-18-SEP.-26.md  →  Astro 输出 /posts/2026-09-18-sep-26/
 *   而脚本按文件名拼成      /posts/2026-09-18-SEP.-26/  → 404
 *
 * Astro 的规则：小写 → 非 [a-z0-9] 换成 - → 合并连续 - → 去掉首尾 -
 * 中文原样保留（站点里本来就有 2026-09-16-yuuu的第一篇文章 这种）。
 *
 * ⚠️ 改这里要同时跑 npm run build 看会不会有对不上的：
 *    tools/audit-dist.mjs 第 8.6 节专门拿产物目录对账。
 */

/** 文件名（带不带 .md 都行）→ Astro 的 slug */
export function slugify(name: string): string {
  return String(name)
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 文章在站点上的路径：/posts/<slug>/ */
export const postUrl = (name: string): string => '/posts/' + slugify(name) + '/';
