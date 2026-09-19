import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** 9 种封面样式（PRD 5.3） */
export const COVER_STYLES = [
  'wave', 'nebula', 'crown', 'opera', 'aurora', 'starry', 'bubble', 'grid', 'image',
] as const;

/**
 * 文章分类 —— **这是唯一的权威清单**。
 *
 * 加新分类时要一起改这几处，少一处就出事：
 *   · 这里（内容 schema，构建时校验；漏了它 → 构建失败、站点发不出去）
 *   · public/admin/config.yml（Decap 后台的下拉）
 *   · public/admin/m/app.js 的 CATEGORIES（手机写作页的胶囊）
 *   · src/pages/archive.astro 的 CAT_CLASS（归档页那一栏的颜色）
 *   · src/lib/posts.ts 的 AUTO_STYLE / AUTO_HUE（没指定封面时按分类挑）
 * `npm run check:mobile` 会对账前两处与这里是否一致 —— 加「安利」时我就漏了这里，
 * 结果手机页能存、构建失败、线上一直发不出新版。
 */
export const CATEGORIES = ['日记', '技术', '随笔', '安利'] as const;

/**
 * 可选日期：允许空值。
 *
 * 网页后台（/admin）把「最后修改」清空时会写成 `updated: ''`，
 * 而 z.coerce.date() 会把空字符串转成 Invalid Date，整篇文章直接构建失败。
 * 空字符串 / null 一律当「没填」处理。
 */
const optionalDate = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce.date().optional(),
);

/**
 * 可选数字：同样允许空值。
 *
 * 后台把「封面色相」清空时会写成 `coverHue: ""`，而 z.number() 只收数字，
 * 于是整篇文章构建失败。这条和上面的日期是同一类坑（Decap 的空字段总是写成空串）。
 */
const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().min(min).max(max).optional(),
  );

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: optionalDate,
    category: z.enum(CATEGORIES).default('随笔'),
    tags: z.array(z.string()).default([]),
    summary: z.string().optional(),
    /** 封面：封面池 id（如 'stand'）、public 下的绝对路径、或外链。不写则按 slug 从池子稳定挑一张 */
    cover: z.string().optional(),
    coverStyle: z.enum(COVER_STYLES).optional(),
    coverHue: optionalNumber(0, 359),
    pinned: z.boolean().default(false),
    draft: z.boolean().default(false),
    /**
     * 隐藏：不进首页/归档/标签/分类/搜索/RSS/sitemap，但直接开链接仍然能看。
     * 不写这个字段时，「日记」分类会自动算作隐藏（见 src/lib/posts.ts 的 isHidden）。
     */
    private: z.boolean().default(false),
  }),
});

export const collections = { posts };
