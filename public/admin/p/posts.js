/**
 * 后台文章管理页（/admin/p/）的搜索与筛选逻辑。
 *
 * 抽成纯函数是为了能被 node 直接测：搜索这种「看着对、其实漏」的逻辑，
 * 不写断言很容易出现「明明有却不出来」而没人发现。
 */

import { relativeDay, describe, initialOf } from '../m/app.js';

export { relativeDay, describe, initialOf };

/**
 * 文章在站点上的路径。
 *
 * 优先用构建时写进索引的 url（最准）；没有就按 slug 现算 ——
 * 规则与 src/lib/slug.ts 一致（小写、非字母数字换 -、合并连续 -）。
 * 注意 **不能用文件名现拼**：2026-09-18-SEP.-26.md 的真实路径是
 * /posts/2026-09-18-sep-26/，拼错了就是 404（这个坑踩过）。
 */
export function postUrl(post) {
  if (post && typeof post.url === 'string' && post.url) return post.url;
  const slug = String((post && post.slug) || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? '/posts/' + slug + '/' : '';
}

/** 筛选档位：状态三档 + 分类若干 + 全部 */
export function filtersOf(posts) {
  const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))];
  return [
    { id: 'all', label: '全部', count: posts.length },
    { id: 'published', label: '已发布', count: posts.filter((p) => !p.draft).length },
    { id: 'draft', label: '草稿', count: posts.filter((p) => p.draft).length },
    { id: 'hidden', label: '隐藏', count: posts.filter((p) => p.hidden).length },
    ...cats.map((c) => ({ id: 'cat:' + c, label: c, count: posts.filter((p) => p.category === c).length })),
  ];
}

/** 先把档位过滤出来（搜索在它基础上做） */
export function applyFilter(posts, filterId) {
  if (!filterId || filterId === 'all') return posts.slice();
  if (filterId === 'draft') return posts.filter((p) => !!p.draft);
  if (filterId === 'published') return posts.filter((p) => !p.draft);
  if (filterId === 'hidden') return posts.filter((p) => !!p.hidden);
  if (filterId.startsWith('cat:')) {
    const c = filterId.slice(4);
    return posts.filter((p) => p.category === c);
  }
  return posts.slice();
}

/**
 * 命中片段：在正文里找到关键词，取它周围一段，供列表里显示。
 * 搜「热可可」时能直接看到那句话，比只列标题有用得多。
 */
export function snippet(text, keyword, around = 34) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const k = String(keyword || '').trim();
  if (!t) return '';
  if (!k) return t.slice(0, around * 2) + (t.length > around * 2 ? '…' : '');
  const i = t.toLowerCase().indexOf(k.toLowerCase());
  if (i < 0) return t.slice(0, around * 2) + (t.length > around * 2 ? '…' : '');
  const start = Math.max(0, i - around);
  const end = Math.min(t.length, i + k.length + around);
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
}

/**
 * 搜索：标题 > 分类/标签 > 摘要 > 正文，按分数排序。
 * 返回 [{ post, score, where, snippet }]，where 说明命中的位置（界面上标出来）。
 */
export function searchPosts(posts, keyword) {
  const k = String(keyword || '').trim().toLowerCase();
  if (!k) return posts.map((p) => ({ post: p, score: 0, where: '', snippet: '' }));

  const out = [];
  for (const p of posts) {
    let score = 0;
    const where = [];
    const title = String(p.title || '').toLowerCase();
    const cat = String(p.category || '').toLowerCase();
    const tags = (p.tags || []).join(' ').toLowerCase();
    const summary = String(p.summary || '').toLowerCase();
    const text = String(p.text || '').toLowerCase();

    if (title.includes(k)) { score += 100; where.push('标题'); }
    if (title.startsWith(k)) score += 40;            /* 前缀命中更相关 */
    if (cat.includes(k)) { score += 40; where.push('分类'); }
    if (tags.includes(k)) { score += 30; where.push('标签'); }
    if (summary.includes(k)) { score += 20; where.push('摘要'); }
    if (text.includes(k)) { score += 10; where.push('正文'); }
    if (!score) continue;

    out.push({
      post: p,
      score,
      where: where.join('·'),
      /* 正文命中时给片段，否则给摘要 */
      snippet: text.includes(k) ? snippet(p.text, k) : snippet(p.summary || p.text, ''),
    });
  }
  return out.sort((a, b) => b.score - a.score || String(b.post.date).localeCompare(String(a.post.date)));
}

/** 一次性做完：档位过滤 + 搜索（界面上就调这个） */
export function query(posts, { filterId = 'all', keyword = '' } = {}) {
  return searchPosts(applyFilter(posts, filterId), keyword);
}
