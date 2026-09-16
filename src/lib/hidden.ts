/**
 * 「隐藏的文章」的唯一判定处。
 *
 * 为什么单独一个文件：判定规则有两个使用场景，而它们能拿到的数据不一样 ——
 *   · 渲染期（src/lib/posts.ts）：有完整的 CollectionEntry
 *   · 构建配置期（astro.config.mjs）：只能自己读 frontmatter
 * 后者**不能** import posts.ts，因为那个模块依赖 astro:content（渲染期才存在的
 * 虚拟模块），在构建配置里 import 会直接报 "Cannot find module 'astro:content'"。
 *
 * 所以规则抽到这里，两个场景共用，永远不会出现「两套规则」的偏差。
 */

/** 这个分类下的文章自动隐藏（日常不用记着加开关） */
export const HIDDEN_CATEGORY = '日记';

export interface HiddenData {
  private?: boolean;
  category?: string;
}

/**
 * 隐藏 = 不进首页 / 归档 / 标签 / 分类 / 搜索 / RSS / sitemap，
 * 但**直接开链接仍然能看**（纯静态站没有登录，这是能做到的极限）。
 *
 * 两条判定满足其一即可：手动 private: true，或分类是「日记」。
 */
export function isHiddenData(data: HiddenData): boolean {
  return data.private === true || data.category === HIDDEN_CATEGORY;
}
