import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import PostCard from '../../../components/PostCard.astro';
import { getPosts, paginate, PAGE_SIZE } from '../../../lib/posts';

/**
 * 「加载更多」用的静态 JSON。
 * 每个分页在构建时就把 PostCard 渲染成 HTML 存好，前端 fetch 之后直接插入，
 * 这样首屏只需要渲染最近 10 篇（PRD 3.1）。
 */
export async function getStaticPaths() {
  const posts = await getPosts();
  const pages = paginate(posts, PAGE_SIZE);

  return pages.slice(1).map((_, i) => {
    const page = i + 2;
    return {
      params: { page: String(page) },
      props: {
        start: (page - 1) * PAGE_SIZE,
        next: page < pages.length ? page + 1 : 0,
      },
    };
  });
}

export async function GET({ props }: { props: { start: number; next: number } }) {
  const { start, next } = props;
  const posts = await getPosts();
  const slice = posts.slice(start, start + PAGE_SIZE);

  const container = await AstroContainer.create();
  const parts = await Promise.all(
    slice.map((post) => container.renderToString(PostCard, { props: { post } })),
  );

  return new Response(JSON.stringify({ html: parts.join(''), next }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
