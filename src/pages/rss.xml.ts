import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, summaryOf, urlOf } from '../lib/posts';
import { SITE_TITLE, SITE_DESC } from '../lib/site';

export async function GET(context: APIContext) {
  const posts = (await getPosts()).slice(0, 20);

  return rss({
    title: SITE_TITLE,
    description: SITE_DESC,
    site: context.site ?? 'https://yuuu.pages.dev',
    trailingSlash: false,
    customData: '<language>zh-cn</language>',
    items: posts.map((post) => ({
      title: post.data.title,
      link: urlOf(post),
      description: summaryOf(post),
      pubDate: post.data.date,
      categories: post.data.tags,
    })),
  });
}
