/**
 * yuuu-blog-v2 · GitHub OAuth 代理
 *
 * Sveltia CMS 需要它来完成 GitHub 登录（因为纯静态站拿不到 client_secret）。
 * 部署：见同目录 README.md
 *
 * 环境变量（wrangler secret put）：
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 * 普通变量：
 *   ALLOWED_ORIGIN   例如 https://yuuu.pages.dev
 */

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGIN?: string;
}

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

function html(body: string): Response {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>OAuth</title></head><body><script>
${body}
</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/** Sveltia / Decap CMS 约定的握手脚本 */
function handshake(status: 'success' | 'error', payload: Record<string, string>): string {
  const message = `authorization:${status}:${JSON.stringify(payload)}`;
  return `
    (function () {
      var msg = ${JSON.stringify(message)};
      function receive(e) {
        if (window.opener) window.opener.postMessage(msg, e.origin || '*');
        window.removeEventListener('message', receive, false);
      }
      window.addEventListener('message', receive, false);
      if (window.opener) window.opener.postMessage('authorizing:github', '*');
    })();
  `;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(env);

    if (request.method === 'OPTIONS') return new Response(null, { headers });

    // 第一步：跳去 GitHub 授权页
    if (url.pathname === '/auth') {
      const redirectUri = `${url.origin}/callback`;
      const authorize = new URL(GITHUB_AUTHORIZE);
      authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', url.searchParams.get('scope') || 'repo,user');
      authorize.searchParams.set('state', crypto.randomUUID());
      return Response.redirect(authorize.toString(), 302);
    }

    // 第二步：GitHub 回调，用 code 换 token
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) return html(handshake('error', { message: '缺少 code 参数' }));

      const tokenRes = await fetch(GITHUB_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });

      const data = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!data.access_token) {
        return html(handshake('error', { message: data.error_description || data.error || '换取 token 失败' }));
      }

      return html(handshake('success', { token: data.access_token, provider: 'github' }));
    }

    if (url.pathname === '/') {
      return new Response(JSON.stringify({ ok: true, service: 'yuuu-blog-v2 oauth' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers });
  },
};
