/**
 * yuuu-blog-v2 · GitHub OAuth 代理 + 私人角落（口令校验 / 访问日志）
 *
 * 环境变量（wrangler secret put）：
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET   —— 给 /admin 登录用
 *   HIDDEN_PASSWORD                            —— 私人角落的口令
 *   LOGS_TOKEN                                 —— 读日志用的口令（只有你知道）
 * 普通变量：
 *   ALLOWED_ORIGIN   例如 https://yuuu.love
 * KV 绑定：
 *   LOGS             —— 存访问日志 + 失败计数
 *
 * 接口一览：
 *   GET  /                健康检查
 *   GET  /auth            → GitHub 授权页（CMS 登录）
 *   GET  /callback        ← GitHub 回调
 *   POST /hidden          校验私人角落口令；对了返回隐藏文章清单，并记一条日志
 *   POST /hidden/leave    补写停留时长（sendBeacon）
 *   GET  /hidden/logs     读日志（需要 Authorization: Bearer <LOGS_TOKEN>）
 */

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  HIDDEN_PASSWORD?: string;
  LOGS_TOKEN?: string;
  LOGS?: KVNamespace;
}

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';

/** 清单由构建时生成，Worker 从这里取（同站点，无需鉴权即可读；只有元信息，不是机密） */
const MANIFEST_URL = 'https://yuuu.love/private/posts.json';

/** 限流：窗口内允许的失败次数与锁定时长 */
const MAX_FAILS = 5;
const FAIL_WINDOW_SEC = 15 * 60;
const LOCK_SEC = 15 * 60;
/** 日志保留天数 */
const LOG_TTL_SEC = 90 * 24 * 60 * 60;

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (data: unknown, status: number, env: Env, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(env), 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

/** 从 User-Agent 里粗略拆出设备 / 系统 / 浏览器 —— 只是给自己看，不求精确 */
function parseUA(ua: string): string {
  const os = /Windows NT 10/.test(ua) ? 'Windows'
    : /Windows/.test(ua) ? 'Windows(旧)'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '未知';
  const br = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : '未知';
  const dev = /Mobile|Android|iPhone/.test(ua) ? '手机' : '电脑';
  return dev + ' · ' + os + ' · ' + br;
}

/** 把时间按 +08:00 写成人类可读的样子 */
const localTime = (d: Date): string => {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().replace('T', ' ').slice(0, 19) + ' (+08:00)';
};

function html(body: string): Response {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>OAuth</title></head><body><script>
${body}
</script></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/**
 * Sveltia / Decap CMS 约定的握手脚本。
 *
 * 协议（照抄 CMS 端的正则，错一个字符就会显示 "No data"）：
 *   1. 本窗口(window.opener = CMS)先发 'authorizing:github'
 *   2. CMS 回一条 'authorizing:github' 到本窗口（带它的 origin）
 *   3. 本窗口再发 'authorization:github:<success|error>:<JSON>'
 * 注意第 3 条的 provider 段不能省 —— CMS 用
 * /^authorization:github:(success|error):(?<result>.+)/ 去匹配。
 */
function handshake(status: 'success' | 'error', payload: Record<string, string>): string {
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;
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

/* ------------------------------------------------------------------ 私人角落 */

async function handleHidden(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || '未知';
  const now = new Date();

  let body: { password?: string; from?: string } = {};
  try { body = await request.json(); } catch { /* 空 body 就当没给口令 */ }
  const pass = (body.password || '').trim();
  const from = (body.from || 'direct').slice(0, 40);

  if (!env.HIDDEN_PASSWORD) {
    return json({ message: '服务端还没设置口令（HIDDEN_PASSWORD）' }, 500, env);
  }

  /* 限流：同一 IP 短时间内失败太多就锁一会儿 */
  const failKey = 'fail:' + ip;
  const fails = Number((await env.LOGS?.get(failKey)) || 0);
  if (fails >= MAX_FAILS) {
    await logVisit(env, { ip, ua: request.headers.get('User-Agent') || '', country: request.headers.get('CF-IPCountry') || '', tz: request.headers.get('CF-Timezone') || '', from, ok: false, note: '已锁定，仍在尝试' });
    return json({ message: '试得太频繁了，等 15 分钟再来' }, 429, env);
  }

  const ok = pass.length > 0 && pass === env.HIDDEN_PASSWORD;

  if (!ok) {
    await env.LOGS?.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW_SEC });
    await logVisit(env, { ip, ua: request.headers.get('User-Agent') || '', country: request.headers.get('CF-IPCountry') || '', tz: request.headers.get('CF-Timezone') || '', from, ok: false, note: '口令错误' });
    return json({ message: '口令不对' }, 401, env);
  }

  await env.LOGS?.delete(failKey);

  /* 校验通过：取清单（构建时生成的静态文件，Worker 自己读，不经过浏览器） */
  let posts: unknown[] = [];
  try {
    const r = await fetch(MANIFEST_URL, { cf: { cacheTtl: 60 } } as RequestInit);
    if (r.ok) {
      const data = (await r.json()) as { posts?: unknown[] };
      posts = data.posts || [];
    }
  } catch { /* 取不到就返回空列表，日志里看得出来 */ }

  const ticket = crypto.randomUUID();
  const logId = await logVisit(env, {
    ip,
    ua: request.headers.get('User-Agent') || '',
    country: request.headers.get('CF-IPCountry') || '',
    tz: request.headers.get('CF-Timezone') || '',
    from,
    ok: true,
    ticket,
  });

  return json({ posts, ticket, logId, now: localTime(now) }, 200, env);
}

/** 写一条访问日志，返回它的 id（ticket → logId 的映射也要存，离开时才能补时长） */
async function logVisit(env: Env, v: {
  ip: string; ua: string; country: string; tz: string; from: string; ok: boolean;
  note?: string; ticket?: string;
}): Promise<string> {
  const kv = env.LOGS;
  if (!kv) return '';
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const record = {
    id,
    at: new Date().toISOString(),
    atLocal: localTime(new Date()),
    ip: v.ip,
    country: v.country || '',
    tz: v.tz || '',
    device: parseUA(v.ua),
    ua: v.ua.slice(0, 200),
    from: v.from,
    ok: v.ok,
    note: v.note || '',
    seconds: null as number | null,
  };
  /* 键名带上时间前缀，list() 拿到的就是按时间排序的 */
  await kv.put('log:' + record.at + ':' + id, JSON.stringify(record), { expirationTtl: LOG_TTL_SEC });
  if (v.ticket) {
    await kv.put('ticket:' + v.ticket, record.at + ':' + id, { expirationTtl: 6 * 3600 });
  }
  return id;
}

async function handleLeave(request: Request, env: Env): Promise<Response> {
  let body: { ticket?: string; seconds?: number } = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const ticket = body.ticket || '';
  const seconds = Math.max(0, Math.min(60 * 60 * 8, Math.round(Number(body.seconds) || 0)));
  if (!ticket || !env.LOGS) return json({ ok: true }, 200, env);

  const key = await env.LOGS.get('ticket:' + ticket);
  if (!key) return json({ ok: true }, 200, env);

  const logKey = 'log:' + key;
  const raw = await env.LOGS.get(logKey);
  if (raw) {
    const rec = JSON.parse(raw) as { seconds: number | null };
    rec.seconds = seconds;
    await env.LOGS.put(logKey, JSON.stringify(rec), { expirationTtl: LOG_TTL_SEC });
  }
  await env.LOGS.delete('ticket:' + ticket);
  return json({ ok: true }, 200, env);
}

async function handleLogs(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.LOGS_TOKEN) return json({ message: '服务端还没设置日志口令（LOGS_TOKEN）' }, 500, env);
  if (token !== env.LOGS_TOKEN) return json({ message: '口令不对' }, 401, env);
  if (!env.LOGS) return json({ message: '没有绑定 KV（LOGS）' }, 500, env);

  const list = await env.LOGS.list({ prefix: 'log:', limit: 200 });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.LOGS!.get(k.name);
      return raw ? JSON.parse(raw) : null;
    }),
  );
  /* 键名按时间排序，倒过来就是最新在前 */
  const logs = items.filter(Boolean).reverse();
  return json({ count: logs.length, logs }, 200, env);
}

/* ------------------------------------------------------------------ 入口 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(env);

    if (request.method === 'OPTIONS') return new Response(null, { headers });

    /* ---- 私人角落 ---- */
    if (url.pathname === '/hidden' && request.method === 'POST') return handleHidden(request, env);
    if (url.pathname === '/hidden/leave' && request.method === 'POST') return handleLeave(request, env);
    if (url.pathname === '/hidden/logs' && request.method === 'GET') return handleLogs(request, env);

    /* ---- CMS 登录 ---- */
    if (url.pathname === '/auth') {
      const redirectUri = `${url.origin}/callback`;
      const authorize = new URL(GITHUB_AUTHORIZE);
      authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('scope', url.searchParams.get('scope') || 'repo,user');
      authorize.searchParams.set('state', crypto.randomUUID());
      return Response.redirect(authorize.toString(), 302);
    }

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
      return new Response(JSON.stringify({ ok: true, service: 'yuuu-blog-v2 oauth + private' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers });
  },
};
