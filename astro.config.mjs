// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, readdirSync } from 'node:fs';
import { isHiddenData } from './src/lib/hidden';

/**
 * 生产域名 —— 决定 canonical / sitemap / RSS / og:image 里的绝对地址。
 * ⚠️ 换成你自己的域名后必须重新构建，否则这些标签会全部指向旧地址。
 * 想换自定义域名，就改这一行 + public/robots.txt + public/admin/config.yml。
 */
export const SITE = 'https://yuuu.love';

/*
 * 隐藏的文章要从 sitemap 里去掉。
 * 这里不能 import+await getPosts() —— 那个模块依赖 astro:content（渲染期才有的虚拟模块），
 * 构建配置阶段 import 它会直接报 "Cannot find module 'astro:content'"。
 * 所以自己读 frontmatter，但「什么算隐藏」复用 src/lib/posts.ts 的 isHiddenData，不另写一套规则。
 */
const POSTS_DIR = new URL('./src/content/posts/', import.meta.url);

/**
 * 只取出判定需要的两个键，不引入 YAML 解析器。
 *
 * ⚠️ 这里**不能** import 'yaml' —— 它是 astro 的传递依赖，
 * 本地 npm 会提升到顶层所以看着能用，Cloudflare 用 pnpm 的隔离模式时
 * 只对 astro 自己可见，构建直接报 "Cannot find module 'yaml'"（踩过）。
 * 需要新键时在这里加一条正则即可，判定规则仍然复用 isHiddenData。
 */
function readHiddenKeys(file) {
  const yaml = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(new URL(file, POSTS_DIR), 'utf8')) || [])[1] || '';
  const pick = (key) => {
    const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(yaml);
    return m ? m[1].replace(/^["']|["']$/g, '') : undefined;
  };
  const category = pick('category');
  return { private: pick('private') === 'true', category };
}

/**
 * 文件名 → Astro 生成的 slug。
 *
 * ⚠️ 必须和 Astro 的规则一致，否则隐藏文章会**泄漏进 sitemap**（被搜索引擎收录）。
 * 踩过：2026-09-18-SEP.-26.md 的页面在 /posts/2026-09-18-sep-26/，
 * 而这里直接拿文件名当 slug（大写、带点），集合里是 2026-09-18-SEP.-26，
 * 跟 sitemap 里的 sep-26 对不上 → 过滤失效 → 泄漏。审计第 8 节逮到的。
 *
 * 完整说明见 src/lib/slug.ts。**同一份规则在三个地方**（这里是构建配置，
 * 另外两处是 tools/make-private-manifest.mjs 与 tools/audit-dist.mjs，
 * 它们 import 共享模块）。tools/verify.mjs 有一条检查盯着三者是否一致，
 * 改规则时三处一起改（构建配置不能 import 那个模块，原因见文件头）。
 */
function slugify(name) {
  return String(name)
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const hiddenSlugs = new Set(
  readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md') && isHiddenData(readHiddenKeys(f)))
    .map(slugify),
);

export default defineConfig({
  site: SITE,
  output: 'static',
  trailingSlash: 'ignore',

  build: {
    // 小样式表内联，减少首屏请求
    inlineStylesheets: 'auto',
  },

  integrations: [
    sitemap({
      /*
       * 隐藏的文章（private: true 或 category: 日记）不进 sitemap。
       * 列表 / 标签 / 搜索 / RSS 都在别处已经排除了，这里补上最后一个出口。
       */
      filter: (page) => {
        /* 后台与私人角落不该出现在 sitemap 里 —— 它们本来就带 noindex，
           没必要再让搜索引擎知道这两个路径存在 */
        /* diary 和 private 一样是「知道网址才进得去」的口令页，别让搜索引擎收录 */
        if (/\/(admin|private|diary)(\/|$)/.test(page)) return false;
        /* 隐藏的文章（private: true 或 category: 日记）也不进 sitemap */
        const m = /\/posts\/(.+?)\/?$/.exec(page);
        return m ? !hiddenSlugs.has(decodeURIComponent(m[1])) : true;
      },
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  // 悬停预取：配合原生 View Transitions，跳转几乎瞬时
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  markdown: {
    // 深浅两套代码高亮，跟随 data-theme 切换
    shikiConfig: {
      themes: { light: 'github-light', dark: 'one-dark-pro' },
      wrap: true,
    },
  },
});
