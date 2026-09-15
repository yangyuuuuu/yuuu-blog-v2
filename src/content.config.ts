import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** 9 种封面样式（PRD 5.3） */
export const COVER_STYLES = [
  'wave', 'nebula', 'crown', 'opera', 'aurora', 'starry', 'bubble', 'grid', 'image',
] as const;

export const CATEGORIES = ['日记', '技术', '随笔'] as const;

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    category: z.enum(CATEGORIES).default('随笔'),
    tags: z.array(z.string()).default([]),
    summary: z.string().optional(),
    cover: z.string().optional(),
    coverStyle: z.enum(COVER_STYLES).optional(),
    coverHue: z.number().min(0).max(359).optional(),
    pinned: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
