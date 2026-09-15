// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/** 生产域名：部署到 Cloudflare Pages 后改成你自己的域名 */
export const SITE = 'https://yuuu.pages.dev';

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
