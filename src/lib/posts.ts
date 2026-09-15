import { getCollection, type CollectionEntry } from 'astro:content';
import { countWords, readingMinutes, stripMarkdown, truncate } from './format';

export type Post = CollectionEntry<'posts'>;

/** 每页文章数（PRD 3.1） */
export const PAGE_SIZE = 10;

export type CoverStyleId =
  | 'wave' | 'nebula' | 'crown' | 'opera' | 'aurora' | 'starry' | 'bubble' | 'grid' | 'image';

/** 没写 coverStyle 时，按分类自动挑一个 */
const AUTO_STYLE: Record<string, CoverStyleId> = {
  技术: 'grid',
  日记: 'bubble',
  随笔: 'nebula',
};
const AUTO_HUE: Record<string, number> = { 技术: 202, 日记: 38, 随笔: 266 };
const VALID_STYLES: CoverStyleId[] = [
  'wave', 'nebula', 'crown', 'opera', 'aurora', 'starry', 'bubble', 'grid', 'image',
];

/** 取全部文章：过滤草稿、按置顶 + 日期倒序 */
export async function getPosts(): Promise<Post[]> {
  const all = await getCollection('posts', ({ data }: Post) =>
    import.meta.env.PROD ? !data.draft : true,
  );
  return all.sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    return b.data.date.getTime() - a.data.date.getTime();
  });
}

export const slugOf = (post: Post): string => post.id;

export const urlOf = (post: Post): string => `/posts/${post.id}/`;

export function coverStyleOf(post: Post): CoverStyleId {
  const raw = post.data.coverStyle as CoverStyleId | undefined;
  if (raw && VALID_STYLES.includes(raw)) return raw;
  return AUTO_STYLE[post.data.category] ?? 'wave';
}

export function coverHueOf(post: Post): number {
  if (typeof post.data.coverHue === 'number') return post.data.coverHue;
  return AUTO_HUE[post.data.category] ?? 202;
}

export function coverLetterOf(post: Post): string {
  const t = post.data.title.replace(/^[\s\d·、，,。.．]+/, '');
  return t.charAt(0) || '水';
}

export function summaryOf(post: Post): string {
  if (post.data.summary) return post.data.summary;
  return truncate(stripMarkdown(post.body ?? ''));
}

export function wordsOf(post: Post): number {
  return countWords(stripMarkdown(post.body ?? ''));
}

export function readingOf(post: Post): number {
  return readingMinutes(wordsOf(post));
}

/** 更新历史等页面也用它来分页 */
export function paginate<T>(items: T[], size = PAGE_SIZE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/** 按年份分组（归档页） */
export function groupByYear(items: Post[]): { year: number; posts: Post[] }[] {
  const map = new Map<number, Post[]>();
  for (const p of items) {
    const y = p.data.date.getFullYear();
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(p);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, posts: list }));
}

/** 标签云：带计数，按出现次数倒序 */
export function collectTags(items: Post[]): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const p of items) {
    for (const t of p.data.tags) map.set(t, (map.get(t) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([tag, count]) => ({ tag, count }));
}

/** 分类清单 */
export function collectCategories(items: Post[]): { category: string; count: number }[] {
  const order = ['日记', '技术', '随笔'];
  const map = new Map<string, number>();
  for (const p of items) map.set(p.data.category, (map.get(p.data.category) ?? 0) + 1);
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([category, count]) => ({ category, count }));
}

/** 上一篇 / 下一篇（按时间倒序的数组里，index-1 是更新的一篇） */
export function neighbours(items: Post[], current: Post) {
  const i = items.findIndex((p) => p.id === current.id);
  return {
    newer: i > 0 ? items[i - 1] : undefined,
    older: i >= 0 && i < items.length - 1 ? items[i + 1] : undefined,
  };
}
