import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** 9 种封面样式（PRD 5.3） */
export const COVER_STYLES = [
  'wave', 'nebula', 'crown', 'opera', 'aurora', 'starry', 'bubble', 'grid', 'image',
] as const;

export const CATEGORIES = ['日记', '技术', '随笔'] as const;

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
    coverHue: z.number().min(0).max(359).optional(),
    pinned: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
