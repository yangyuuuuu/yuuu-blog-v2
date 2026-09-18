/**
 * 私人角落的排序规则 —— 抽出来单独放，为的是**页面和回归检查共用同一份代码**。
 *
 * 为什么不留成 private.astro 里的一个内部函数：那样检查脚本只能照抄一遍，
 * 抄完就开始各自漂移，等到线上不对时两边说的不是一回事（这个坑很典型）。
 *
 * 三种排序必须真的给出三种结果，否则用户点了切换会觉得「没反应」——
 * 而「最近修改」偏偏最容易和「最新发布」撞车，因为 updated 只到「天」。
 *
 * 数据来自构建时生成的 dist/private/posts.json（见 tools/make-private-manifest.mjs）：
 *   { date, updated, touches, ... }
 *   updated  : 最后一次改动日期（frontmatter 里没有就用 git 提交日期兜底）
 *   touches  : 改过它的提交数 —— 只用来给「同一天被改过」的文章分先后
 */
export interface SortablePost {
  date?: string;
  updated?: string;
  /** 改过它的提交数（构建时由 make-private-manifest.mjs 写入） */
  touches?: number;
  [key: string]: unknown;
}

export type SortMode = 'date-desc' | 'date-asc' | 'updated-desc';

const date = (p: SortablePost): string => p.date || '';
const updated = (p: SortablePost): string => p.updated || p.date || '';
const touches = (p: SortablePost): number => p.touches || 0;

export function sortPosts<T extends SortablePost>(list: T[], mode: SortMode): T[] {
  const arr = list.slice();
  if (mode === 'date-asc') {
    arr.sort((a, b) => date(a).localeCompare(date(b)));
  } else if (mode === 'updated-desc') {
    /*
     * 三级比较，一级比不出来才用下一级：
     *   1. updated  —— 精确到秒（git 给的是 ISO 时刻；frontmatter 只写日子就是 00:00:00）
     *   2. touches  —— 改过它的提交数。同一批提交碰过的文件 updated 会一模一样，
     *                  这时候得靠它分先后，否则「最近修改」又和「最新发布」撞车
     *   3. date     —— 仍然并列就按发布日期倒序（保持「新的在前」的观感）
     *
     * 注意 string 的 localeCompare：清单里的 updated 可能是 ISO 时刻，
     * 也可能是纯日期（frontmatter 里手写的），所以页面那边用 String() 兜一层再比。
     */
    arr.sort(
      (a, b) =>
        updated(b).localeCompare(updated(a)) || touches(b) - touches(a) || date(b).localeCompare(date(a)),
    );
  } else {
    arr.sort((a, b) => date(b).localeCompare(date(a)));
  }
  return arr;
}

/** 给检查用：三种模式的顺序是不是两两不同 */
export function orderOf<T extends SortablePost>(list: T[], mode: SortMode): string {
  return sortPosts(list, mode)
    .map((p) => String(p.date || '') + '|' + String(p.updated || '') + '|' + String(p.title ?? ''))
    .join(' » ');
}
