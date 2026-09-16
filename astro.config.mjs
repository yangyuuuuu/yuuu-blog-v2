// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * 生产域名 —— 决定 canonical / sitemap / RSS / og:image 里的绝对地址。
 * ⚠️ 换成你自己的域名后必须重新构建，否则这些标签会全部指向旧地址。
 * 想换自定义域名，就改这一行 + public/robots.txt + public/admin/config.yml。
 */
export const SITE = 'https://yuuu-blog.pages.dev';

export default defineConfig({
  site: SITE,
  output: 'static',
  trailingSlash: 'ignore',

  build: {
    // 小样式表内联，减少首屏请求
    inlineStylesheets: 'auto',
  },

  integrations: [sitemap()],

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
