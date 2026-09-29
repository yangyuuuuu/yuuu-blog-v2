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
  /**
   * 手机写作页提交文章用。需要 repo 权限的 token（classic PAT 勾 repo 即可）。
   * ⚠️ 这个 token **只在 Worker 里用**，绝不下发给浏览器 —— 页面只拿 ticket。
   * 没配置的话 /admin/* 会返回一句清楚的提示，不会静默失败。
   */
  GITHUB_TOKEN?: string;
  /** 仓库地址，默认就是本站；换仓库时改这里或 wrangler.toml 的 [vars] */
  REPO?: string;
  BRANCH?: string;
}

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
/* ⚠️ 别把 GITHUB_TOKEN（写作页用的 PAT）和 GITHUB_TOKEN_URL 搞混 —— 名字像，用途完全不同 */
const GH_API = 'https://api.github.com';

/**
 * 清单由构建时生成在 dist/private/posts.json。
 * 这里按**请求来源**去取，而不是写死域名 —— 本地预览、自定义域、预览部署都能对上。
 * 加时间戳参数是为了绕开 CF 的缓存：否则刚部署完还拿到旧清单（表现是「少了一篇」）。
 */
function manifestUrl(request: Request): string {
  const prod = 'https://yuuu.love';
  const origin = request.headers.get('Origin') || '';
  /* 本地预览时浏览器在 localhost，但 Worker 访问不到它 —— 一律从线上取清单 */
  const base = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin) ? prod : origin || prod;
  return base.replace(/\/+$/, '') + '/private/posts.json?t=' + Date.now();
}

/** 限流：窗口内允许的失败次数与锁定时长 */
const MAX_FAILS = 5;
const FAIL_WINDOW_SEC = 15 * 60;
const LOCK_SEC = 15 * 60;
/**
 * 两层保存：
 *   · 热数据 log:*：保留 90 天，读列表快（KV 有 TTL 上限，过期就没了）
 *   · 永久归档 day:YYYY-MM-DD：**不设过期**，每天一个 JSON 数组，长期留底
 * 热数据过期不影响归档；要查更早的，走 /hidden/logs?all=1。
 */
const LOG_TTL_SEC = 90 * 24 * 60 * 60;

/**
 * 文章增删改日志（和上面的访问日志是两回事，别混）。
 *   · 只记「新增 / 修改 / 删除」三种，不记浏览
 *   · **永久保留** —— 所以 put 的时候绝不带 expirationTtl（访问日志才有 90 天 TTL）
 *   · 每条记：动作、文章标题、可点击链接、IP、时间
 *
 * 存两份是有意的，各管一件事：
 *   · plog:<at 毫秒>-<随机>  流水，永久；?all=1 走它
 *   · plog:recent            最近 RECENT_POST_LOGS 条的缓存，界面默认只显示这些
 * 只存流水的话，界面一打开就要把全部历史拉出来读（越用越慢）。
 */
const POST_LOG_PREFIX = 'plog:';
const RECENT_POST_LOGS = 200;

/**
 * 允许的来源：线上域名 + 本地预览（方便在本机调私人角落）。
 * 回显请求里的 Origin，不放开通配符 —— 免得别人的站点也能调这个 Worker。
 */
function allowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') || '';
  const prod = env.ALLOWED_ORIGIN || 'https://yuuu.love';
  if (origin === prod) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return prod;
}

function cors(request: Request, env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status: number, request: Request, env: Env, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(request, env), 'Content-Type': 'application/json; charset=utf-8', ...extra },
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

/**
 * 访客 IP。
 * 用 CF-Connecting-IP（真实客户端 IP）；本地 / 预览环境没有这个头，再退到
 * X-Forwarded-For 的第一段，最后才是「未知」—— 日志里有个值总比空着强。
 */
function clientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
  return xff || '未知';
}

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

  let body: { password?: string; from?: string; want?: string; site?: string } = {};
  try { body = await request.json(); } catch { /* 空 body 就当没给口令 */ }
  const pass = (body.password || '').trim();
  const from = (body.from || 'direct').slice(0, 40);
  /*
   * want=all 是给手机写作页（/admin/m/）用的：它要的是**全部**文章（含草稿）来列清单，
   * 而不是私人角落那份「隐藏文章」清单。同一道口令，只是要的东西不同。
   * site 允许手机页指定去哪个域名取清单（本地预览时要指向线上）。
   */
  const wantAll = body.want === 'all';

  if (!env.HIDDEN_PASSWORD) {
    return json({ message: '服务端还没设置口令（HIDDEN_PASSWORD）' }, 500, request, env);
  }

  /* 限流：同一 IP 短时间内失败太多就锁一会儿 */
  const failKey = 'fail:' + ip;
  const fails = Number((await env.LOGS?.get(failKey)) || 0);
  if (fails >= MAX_FAILS) {
    await logVisit(env, { ip, ua: request.headers.get('User-Agent') || '', country: request.headers.get('CF-IPCountry') || '', tz: request.headers.get('CF-Timezone') || '', from, ok: false, note: '已锁定，仍在尝试' });
    return json({ message: '试得太频繁了，等 15 分钟再来' }, 429, request, env);
  }

  const ok = pass.length > 0 && pass === env.HIDDEN_PASSWORD;

  if (!ok) {
    await env.LOGS?.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW_SEC });
    await logVisit(env, { ip, ua: request.headers.get('User-Agent') || '', country: request.headers.get('CF-IPCountry') || '', tz: request.headers.get('CF-Timezone') || '', from, ok: false, note: '口令错误' });
    return json({ message: '口令不对' }, 401, request, env);
  }

  await env.LOGS?.delete(failKey);

  /* 校验通过：取清单（构建时生成的静态文件，Worker 自己读，不经过浏览器） */
  let posts: unknown[] = [];
  try {
    let url = manifestUrl(request);
    if (wantAll) {
      /* 手机页可以指定站点（本地预览时浏览器在 localhost，Worker 取不到它） */
      const site = /^https?:\/\/[\w.-]+(?::\d+)?$/.test(body.site || '') ? body.site! : 'https://yuuu.love';
      url = site.replace(/\/+$/, '') + '/private/posts-all.json?t=' + Date.now();
    }
    const r = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } } as RequestInit);
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

  return json({ posts, ticket, logId, now: localTime(now) }, 200, request, env);
}

/** 写一条访问日志，返回它的 id（ticket → logId 的映射也要存，离开时才能补时长） */
async function logVisit(env: Env, v: {
  ip: string; ua: string; country: string; tz: string; from: string; ok: boolean;
  note?: string; ticket?: string;
}): Promise<string> {
  const kv = env.LOGS;
  if (!kv) return '';
  const now = new Date();
  const id = now.toISOString().slice(0, 10) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const record = {
    id,
    at: now.toISOString(),
    atLocal: localTime(now),
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

  /* 热数据：id 自带日期前缀，list() 拿出来天然按时间顺序 */
  await kv.put('log:' + id, JSON.stringify(record), { expirationTtl: LOG_TTL_SEC });
  if (v.ticket) await kv.put('ticket:' + v.ticket, id, { expirationTtl: 6 * 3600 });
  await appendToDay(kv, now.toISOString().slice(0, 10), record);
  return id;
}

/** 追加进当天归档（永久保存，不设过期） */
async function appendToDay(kv: KVNamespace, day: string, record: Record<string, unknown>): Promise<void> {
  try {
    const key = 'day:' + day;
    const raw = await kv.get(key);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.push(record);
    await kv.put(key, JSON.stringify(list));
  } catch { /* 归档失败不影响主流程 */ }
}

/* ------------------------------------------------- 文章增删改日志（永久） */

/**
 * 写一条文章改动日志。
 *
 * ⚠️ 两个容易写错的地方：
 *   1. **不要给它加 TTL** —— 站主要求永久保留。KV 的 put 默认就是永久，
 *      这里刻意不传 expirationTtl（访问日志那套的 90 天 TTL 是给浏览记录的）。
 *   2. 这一步**失败绝不能影响文章本身** —— 文章已经写进 GitHub 了，
 *      为了记一条日志去回滚（或者把成功报成失败）才是真的糟。
 *      所以调用方一律用 logPostChange（它把失败吞掉），不要直接调这个。
 */
async function logPost(
  env: Env,
  v: { action: '新增' | '修改' | '删除'; title: string; was?: string; url?: string; ip: string },
): Promise<Record<string, unknown>> {
  const now = new Date();
  const entry = {
    id: now.toISOString().slice(0, 10) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    at: now.toISOString(),
    atLocal: localTime(now),
    action: v.action,
    title: v.title,
    /* 改标题时把**改之前**的标题也记上（没变就不写这个字段，省得每条都带一个空值） */
    ...(v.was && v.was !== v.title ? { was: v.was } : {}),
    /* 删除的文章已经没了，这里就是空串 —— 界面据此决定标题能不能点 */
    url: v.url || '',
    ip: v.ip || '未知',
  };
  const kv = env.LOGS;
  if (!kv) return entry;

  /* 流水：键以毫秒时间戳开头，list() 出来的顺序天然就是时间顺序 */
  await kv.put(POST_LOG_PREFIX + String(now.getTime()).padStart(15, '0') + '-' + Math.random().toString(36).slice(2, 6), JSON.stringify(entry));

  /* 界面用的「最近 N 条」缓存 */
  try {
    const raw = await kv.get(POST_LOG_PREFIX + 'recent');
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.push(entry);
    await kv.put(POST_LOG_PREFIX + 'recent', JSON.stringify(list.slice(-RECENT_POST_LOGS)));
  } catch { /* 缓存坏了就重建，不影响流水 */ }

  return entry;
}

/**
 * logPost 的「绝不炸」包装：日志是**附带**的事，不能因为它把保存/删除报成失败。
 * 真出问题了往 console 打一行（wrangler tail 能看到），用户那边只看文章存没存上。
 */
async function logPostChange(
  env: Env,
  v: { action: '新增' | '修改' | '删除'; title: string; was?: string; url?: string; ip: string },
): Promise<void> {
  try { await logPost(env, v); } catch (e) { console.log('文章日志写入失败：' + (e as Error).message); }
}

/** 离开时补写停留时长：热数据和当天归档都要更新 */
async function handleLeave(request: Request, env: Env): Promise<Response> {
  let body: { ticket?: string; seconds?: number } = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const ticket = body.ticket || '';
  const seconds = Math.max(0, Math.min(60 * 60 * 8, Math.round(Number(body.seconds) || 0)));
  const kv = env.LOGS;
  if (!ticket || !kv) return json({ ok: true }, 200, request, env);

  const id = await kv.get('ticket:' + ticket);
  if (!id) return json({ ok: true }, 200, request, env);

  const logKey = 'log:' + id;
  const raw = await kv.get(logKey);
  if (raw) {
    const rec = JSON.parse(raw) as { seconds: number | null };
    rec.seconds = seconds;
    await kv.put(logKey, JSON.stringify(rec), { expirationTtl: LOG_TTL_SEC });
  }

  /* 归档里那条也补上时长 */
  const day = id.slice(0, 10);
  try {
    const dayKey = 'day:' + day;
    const dRaw = await kv.get(dayKey);
    if (dRaw) {
      const list = JSON.parse(dRaw) as { id: string; seconds: number | null }[];
      const hit = list.find((x) => x.id === id);
      if (hit) {
        hit.seconds = seconds;
        await kv.put(dayKey, JSON.stringify(list));
      }
    }
  } catch { /* 忽略 */ }

  await kv.delete('ticket:' + ticket);
  return json({ ok: true }, 200, request, env);
}

/**
 * 把永久归档（day:YYYY-MM-DD，一天一个 JSON 数组）按天读出来、按时间排序。
 * 访问日志和文章日志共用 —— 两边的归档结构是一样的（单条记录的字段不同而已）。
 */
async function readDayArchive(kv: KVNamespace): Promise<Record<string, unknown>[]> {
  const days = await kv.list({ prefix: 'day:', limit: 400 });
  const out: Record<string, unknown>[] = [];
  for (const k of days.keys) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    try { out.push(...(JSON.parse(raw) as Record<string, unknown>[])); } catch { /* 跳过坏数据 */ }
  }
  out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return out;
}

/**
 * 读日志。
 *   默认：最近 90 天的热数据（快）
 *   ?all=1：把永久归档按天读出来（慢一点，但不会过期）
 */
async function handleLogs(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.LOGS_TOKEN) return json({ message: '服务端还没设置日志口令（LOGS_TOKEN）' }, 500, request, env);
  if (token !== env.LOGS_TOKEN) return json({ message: '口令不对' }, 401, request, env);
  const kv = env.LOGS;
  if (!kv) return json({ message: '没有绑定 KV（LOGS）' }, 500, request, env);

  const url = new URL(request.url);

  if (url.searchParams.get('all') === '1') {
    const logs = await readDayArchive(kv);
    /* 按天归档可能很大，这里最多回最近 3000 条 */
    const trimmed = logs.slice(-3000);
    return json({ count: trimmed.length, total: logs.length, scope: 'all', logs: trimmed }, 200, request, env);
  }

  const list = await kv.list({ prefix: 'log:', limit: 300 });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await kv.get(k.name);
      return raw ? JSON.parse(raw) : null;
    }),
  );
  const logs = items.filter(Boolean).reverse();
  return json({ count: logs.length, scope: 'recent', logs }, 200, request, env);
}

/**
 * 读**文章增删改日志**（/admin/post-logs）。
 *
 * 和访问日志分开的理由：那份有 90 天 TTL、这份永久；界面上也是两张表。
 * 口令沿用 LOGS_TOKEN（同一个运维口令，不再多记一个）。
 *
 *   默认：最近 30 天（或最近 200 条，谁先到算谁）—— 界面打开要快、不要一次渲染几千行
 *   ?all=1：全部历史（从永久流水里读）
 */
async function handlePostLogs(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.LOGS_TOKEN) return json({ message: '服务端还没设置日志口令（LOGS_TOKEN）' }, 500, request, env);
  if (token !== env.LOGS_TOKEN) return json({ message: '口令不对' }, 401, request, env);
  const kv = env.LOGS;
  if (!kv) return json({ message: '没有绑定 KV（LOGS）' }, 500, request, env);

  const url = new URL(request.url);

  if (url.searchParams.get('all') === '1') {
    /* 只要 plog:<毫秒> 的流水，把 plog:recent 那份缓存排除掉 */
    const list = await kv.list({ prefix: POST_LOG_PREFIX, limit: 1000 });
    const items: Record<string, unknown>[] = [];
    for (const k of list.keys) {
      if (k.name === POST_LOG_PREFIX + 'recent') continue;
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try { items.push(JSON.parse(raw) as Record<string, unknown>); } catch { /* 跳过坏数据 */ }
    }
    items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const trimmed = items.slice(-2000);
    return json({ count: trimmed.length, total: items.length, scope: 'all', logs: trimmed }, 200, request, env);
  }

  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || RECENT_POST_LOGS));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  /* 优先用缓存那份（一次 get 就够）；没有（第一次部署）再从流水扫 */
  let logs: Record<string, unknown>[] = [];
  const raw = await kv.get(POST_LOG_PREFIX + 'recent');
  if (raw) {
    try { logs = JSON.parse(raw) as Record<string, unknown>[]; } catch { logs = []; }
  } else {
    const list = await kv.list({ prefix: POST_LOG_PREFIX, limit: 1000 });
    for (const k of list.keys) {
      if (k.name === POST_LOG_PREFIX + 'recent') continue;
      const r = await kv.get(k.name);
      if (!r) continue;
      try { logs.push(JSON.parse(r) as Record<string, unknown>); } catch { /* 跳过 */ }
    }
    logs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  const inWindow = logs.filter((x) => String(x.at) >= since);
  const kept = inWindow.slice(-limit);
  return json({ count: kept.length, total: logs.length, scope: 'recent', days, limit, logs: kept }, 200, request, env);
}

/* ------------------------------------------------------- 手机写作页（/admin/m/）

/**
 * 手机写作页的接口。设计原则：
 *
 *   1. **GitHub token 只在 Worker 里用**。浏览器拿到的只有 ticket ——
 *      就是私人角落那套口令通过后发的随机串，存在 KV（ticket:<uuid> → logId，6 小时）。
 *      所以手机页面被翻出来也没用，拿不到任何能写仓库的凭据。
 *   2. 复用同一道口令（HIDDEN_PASSWORD），不新增一个要记的密码。
 *   3. 保存时**服务器自己写 updated** —— 手机上不用操心「最后修改」。
 *   4. 改已有文件时**只替换需要变的 frontmatter 行**，注释和字段顺序原样保留；
 *      只有新建文件才拼一份完整的 frontmatter。
 */

const CONTENT_DIR = 'src/content/posts';
/**
 * 后台所有 POST 路径 —— **只在这一处登记**。
 *
 * 以前是散在 fetch 里的十几个 `if (url.pathname === '...')`，
 * 加端点时很容易只改了 handleAdmin 里的实现、忘了加路由 → 线上 404。
 * 加「重命名图片」时就这么栽了一次（测试才发现）。现在统一放这里。
 */
const ADMIN_POST_PATHS: readonly string[] = [
  '/admin/whoami',
  '/admin/posts',
  '/admin/posts-index',
  '/admin/reindex',
  '/admin/file',
  '/admin/save',
  '/admin/delete',
  /* 图库 */
  '/admin/images',
  '/admin/image/upload',
  '/admin/image/move',
  '/admin/image/delete',
  '/admin/image/rename',
  '/admin/images/batch',
  '/admin/images/commit',
];

/** 图库那组共用同一套上下文（repo / 路径工具）的端点 */
const GALLERY_PATHS: readonly string[] = [
  '/admin/images',
  '/admin/image/upload',
  '/admin/image/move',
  '/admin/image/delete',
  '/admin/image/rename',
  '/admin/images/commit',
];

/** 图片目录 */
const UPLOAD_DIR = 'public/uploads';
/**
 * 图片的「分类索引」文件。
 *
 * 为什么分类不放在子目录里（那本来更自然）：
 * **Decap 的媒体库只列 media_folder 根目录下的文件** —— 它的 getMedia() 调
 * listFiles(mediaFolder) 而 listFiles 默认 depth=1、且过滤掉路径里含 '/' 的条目。
 * 所以图片一旦放进子目录，用户在那个后台里就永远看不到它们。
 *
 * 折中方案：**文件平铺在 public/uploads 根目录**（Decap 看得到），
 * 分类写在这个 JSON 里（图库照样按分类展示）。
 * 附带好处：改分类 = 改一行 JSON，**不用移动文件** ——
 * 也就不存在「二进制被搬坏」那类风险（之前真的栽过）。
 */
const MEDIA_META = UPLOAD_DIR + '/categories.json';
/** 允许的图片后缀（别让人往仓库里塞 exe） */
/*
 * ⚠️ 这里必须是「以扩展名结尾」而不是「整串等于扩展名」。
 * 我一开始写成 /^(jpe?g|png|…)$/ ，结果是：
 *   · 上传时传进来的是裸后缀（'png'）→ 碰巧为真，看起来正常
 *   · 列图片时传进来的是完整路径（'表情包/a.png'）→ 全被判为非法，列表永远是空的
 * 一个正则写错，表现成「列表没图但能上传」，很难往这里想。
 */
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;

/**
 * 缩略图固定放在 public/uploads/thumbs/ 下、**永远 .jpg**。
 *
 * ⚠️ 这条路径规则必须和 tools/apply-thumbs.mjs 对齐（那边就是这么算的）：
 *   主图 /uploads/芙芙.png → 缩略图 /uploads/thumbs/芙芙.jpg
 * 所以上传时服务端也按同一条规则算出缩略图路径 —— 一次性交给提交，
 * 主图和缩略图**同一次提交**（不会出现「有图没缩略图」的中间态）。
 */
function thumbPathFor(imagePath: string): string {
  return UPLOAD_DIR + '/thumbs/' + (imagePath.split('/').pop() || 'image').replace(/\.[^.]+$/, '') + '.jpg';
}

/** 从 git tree 的 path 里取文件名（tree 返回的是 URL 编码的，中文要解回来比对） */
function treeBaseName(p: string): string {
  const raw = p.split('/').pop() || p;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * 图片文件名净化：**保留中文**（站点的文章名本来就支持中文），
 * 只去掉路径分隔符和 Windows 上非法的字符，空格变下划线。
 */
/**
 * 文件名 → Astro 生成的 slug（和 src/lib/slug.ts 同一条规则）。
 *
 * ⚠️ 之前 /admin/reindex 里直接调了 slugify 却没定义它 —— 一跑就报
 * 「slugify is not defined」。所以那里的测试现在会真的走一遍重建索引。
 * 规则：小写 → 非 [a-z0-9\u4e00-\u9fa5] 换 - → 合并连续 - → 去掉首尾 -
 */
function slugify(name: string): string {
  return String(name)
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function safeName(name: string): string {
  return String(name)
    .replace(/\.[^.]+$/, '')                                  /* 去掉原后缀，后面统一按 MIME 推断 */
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`~\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'image';
}

function repoOf(env: Env): string {
  return env.REPO || 'yangyuuuuu/yuuu-blog-v2';
}
function branchOf(env: Env): string {
  return env.BRANCH || 'main';
}

/** ticket → 是否有效（KV 里有过就是有效；离开时会被删掉） */
async function ticketValid(env: Env, ticket: string): Promise<boolean> {
  if (!ticket || !env.LOGS) return false;
  const id = await env.LOGS.get('ticket:' + ticket);
  return !!id;
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    Authorization: 'Bearer ' + env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'yuuu-blog-admin-mobile',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * 取一个**二进制**文件，返回原始 base64 与 sha。
 *
 * ⚠️ 为什么单独一个函数、为什么不复用 ghGetFile：
 * ghGetFile 会把内容 UTF-8 解码成字符串 —— 那是给 Markdown 用的。
 * 图片是二进制，一旦经过 UTF-8 解码，每个非法字节都会变成 U+FFFD（3 字节），
 * 再编码回去文件就废了：一张 56KB 的 JPEG 会涨到 105KB 且完全打不开。
 * 我做图库「换分类」时就踩了这个坑（用户报「图片丢失」）。
 * **凡是图片，一律走 base64，一步都不要解码成文本。**
 */
async function ghGetBlob(env: Env, path: string): Promise<{ base64: string; sha: string } | null> {
  const url = `${GH_API}/repos/${repoOf(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${branchOf(env)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('读文件失败（HTTP ' + res.status + '）');
  const data = (await res.json()) as { content?: string; sha?: string; size?: number; encoding?: string };
  const inline = (data.content || '').replace(/\n/g, '');

  /*
   * ★★★ 这里踩过一次**真丢图**的坑，改代码前务必读完 ★★★
   *
   * GitHub 的 Contents API 对**超过 1MB** 的文件**不返回 content** ——
   * 它给 encoding: "none"、size: 真大小、content: ""。
   * 老代码直接 (data.content || '') 当内容用，于是「读一张大图」拿到空串，
   * 再原样写回去就变成 **0 字节的 blob**：图片在仓库里被抹成空文件。
   * 站主的「若娜瓦-低眉.jpg」就这么没的（14.8MB → 0 字节，
   * 线上 404、图库里显示「还没构建好」）—— 而所有小图都正常，
   * 所以只看代码完全不觉得有问题。
   *
   * 修法：content 是空的、但文件其实有内容时，拿 sha 走 **Git Blobs 接口**
   * 取真正的 base64（那个接口没有 1MB 这个限制）。
   * 再配一条硬防线：**读到大文件却拿到空内容就抛错**，
   * 宁可这次改名失败，也不能把一个 0 字节写进仓库。
   */
  if (!inline && (data.size || 0) > 0) {
    if (!data.sha) throw new Error('读文件失败：内容为空且没有 sha，无法安全读取 ' + path);
    const blobRes = await fetch(`${GH_API}/repos/${repoOf(env)}/git/blobs/${data.sha}`, { headers: ghHeaders(env) });
    if (!blobRes.ok) throw new Error('读大文件失败（HTTP ' + blobRes.status + '）：' + path);
    const blob = (await blobRes.json()) as { content?: string; encoding?: string };
    const full = (blob.content || '').replace(/\n/g, '');
    if (!full) throw new Error('读大文件拿到的内容为空（拒绝把空文件写回仓库）：' + path);
    return { base64: full, sha: data.sha };
  }

  return { base64: inline, sha: data.sha || '' };
}

/**
 * 内容是不是真的「空」。
 *
 * 用 base64 的长度反推字节数来判断 —— 不要额外发请求，也不信调用方。
 * 「0 字节」和「读失败」在这里是一个意思：都绝不允许写进仓库。
 */
function isEmptyBlob(base64: string): boolean {
  const b64 = String(base64 || '').replace(/\s/g, '').replace(/=+$/, '');
  return Math.floor((b64.length * 3) / 4) === 0;
}

/** 直接写入一个 base64 内容（二进制安全，图片用这个） */
async function ghPutBlob(env: Env, path: string, base64: string, message: string, sha: string): Promise<void> {
  const body: Record<string, unknown> = { message, content: base64.replace(/\n/g, ''), branch: branchOf(env) };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH_API}/repos/${repoOf(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('提交失败（HTTP ' + res.status + '）：' + t.slice(0, 200));
  }
}

/**
 * 用 Git 数据库接口做**一次提交改多个文件**（批量归类 / 批量删除用）。
 *
 * 为什么不用逐个文件调 contents 接口：那样 10 张图 = 20 次请求（新建+删除各一次）、
 * 20 条 commit，又慢又刷屏。这里走 tree：
 *   取当前 commit → 建 blob → 用 baseTree 建新 tree（只列出要改的路径）→ 建 commit → 移动引用
 * baseTree 的好处是**没列出来的文件自动沿用**，所以只写差异部分就行。
 *
 * files：要写的（path + base64）；removes：要删的路径。
 */
async function ghCommitMany(
  env: Env,
  files: { path: string; base64: string }[],
  removes: string[],
  message: string,
): Promise<void> {
  const repo = repoOf(env);
  const branch = branchOf(env);
  const auth = { ...ghHeaders(env), 'Content-Type': 'application/json' };

  const refRes = await fetch(`${GH_API}/repos/${repo}/git/ref/heads/${branch}`, { headers: ghHeaders(env) });
  if (!refRes.ok) throw new Error('取分支失败（HTTP ' + refRes.status + '）');
  const headSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;

  const commitRes = await fetch(`${GH_API}/repos/${repo}/git/commits/${headSha}`, { headers: ghHeaders(env) });
  if (!commitRes.ok) throw new Error('取提交失败（HTTP ' + commitRes.status + '）');
  const baseTree = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;

  /*
   * 防线：路径必须是像样的字符串。写成这样是因为踩过一次 ——
   * 调用时参数错位，removes 收到了一条消息字符串、path 成了 undefined，
   * 结果往 GitHub 发了一个 path=undefined 的 tree 项。宁可在这里响亮地失败。
   */
  const okPath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && !p.includes('..');
  const bad = [...files.map((f) => f.path), ...removes].filter((p) => !okPath(p));
  if (bad.length) throw new Error('内部错误：提交里出现了非法路径 ' + JSON.stringify(bad.slice(0, 3)));
  if (files.length + removes.length > 200) throw new Error('一次提交的文件太多（' + (files.length + removes.length) + '）');

  /*
   * ★ 第二道防线：**任何文件都不许提交成空文件**。
   *
   * 上面 ghGetBlob 的注释里写了那次事故（大图被读成空串 → 0 字节覆盖原图）。
   * 这里再兜一层：真要有人再从别的路径把空内容喂进来，
   * 就**响亮地失败**（这次改名/归类不生效），而不是把用户的图抹掉。
   * 分类索引 categories.json 这类文本文件也会顺便被检查到 —— 空索引本身也是错的。
   */
  const empty = files.filter((f) => isEmptyBlob(f.base64));
  if (empty.length) {
    throw new Error('拒绝提交空文件（0 字节会覆盖掉仓库里的原文件）：' + empty.map((f) => f.path).join('、'));
  }

  /* 新增/改写的文件先建 blob（二进制安全：内容就是 base64） */
  const tree: Record<string, unknown>[] = [];
  for (const f of files) {
    const b = await fetch(`${GH_API}/repos/${repo}/git/blobs`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ content: f.base64.replace(/\n/g, ''), encoding: 'base64' }),
    });
    if (!b.ok) throw new Error('建 blob 失败（HTTP ' + b.status + '）：' + (await b.text()).slice(0, 120));
    const blobSha = ((await b.json()) as { sha: string }).sha;
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blobSha });
  }
  /* 删除 = 在新 tree 里把该路径置为 null */
  for (const r of removes) tree.push({ path: r, mode: '100644', type: 'blob', sha: null });

  const treeRes = await fetch(`${GH_API}/repos/${repo}/git/trees`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  if (!treeRes.ok) throw new Error('建 tree 失败（HTTP ' + treeRes.status + '）：' + (await treeRes.text()).slice(0, 120));
  const newTree = ((await treeRes.json()) as { sha: string }).sha;

  const newCommitRes = await fetch(`${GH_API}/repos/${repo}/git/commits`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ message, tree: newTree, parents: [headSha] }),
  });
  if (!newCommitRes.ok) throw new Error('建提交失败（HTTP ' + newCommitRes.status + '）');
  const newCommit = ((await newCommitRes.json()) as { sha: string }).sha;

  const upd = await fetch(`${GH_API}/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH', headers: auth,
    body: JSON.stringify({ sha: newCommit, force: false }),
  });
  if (!upd.ok) throw new Error('更新分支失败（HTTP ' + upd.status + '）：' + (await upd.text()).slice(0, 160));
}

/* ------------------------------------------------- 图片分类索引（见 MEDIA_META 的说明） */

/** 读分类索引：{ 文件名: 分类名 }；文件不存在或坏掉都退回空表 */
async function readMediaMeta(env: Env): Promise<Record<string, string>> {
  try {
    const f = await ghGetFile(env, MEDIA_META);
    if (!f) return {};
    const data = JSON.parse(f.text) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k && typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 分类索引的 base64（写进提交用） */
const mediaMetaBase64 = (map: Record<string, string>): string =>
  toBase64(JSON.stringify(map, Object.keys(map).sort(), 2) + '\n');

/**
 * 把 legacy 的「子目录分类」也算出来。
 * 迁移期用：文件还在 public/uploads/<分类>/ 下的，dir 就取那个子目录名。
 */
function legacyDirOf(relPath: string): string {
  const inside = relPath.replace(new RegExp('^' + UPLOAD_DIR + '/?'), '');
  const cut = inside.lastIndexOf('/');
  return cut < 0 ? '' : inside.slice(0, cut);
}

/**
 * 找出「引用了这些图片的文章」，返回需要改写的文件条目（base64）与被改的文章名。
 *
 * 改名时用到：图往往已经被文章引用了，只改文件名 → 文章里的
 * ![](/uploads/旧名.jpg) 立刻变破图。把改引用和改名放进**同一次提交**，
 * 要么都成功、要么都没发生。
 *
 * 中文名在 markdown 里可能原样、也可能被百分号编码，两种都换。
 */
async function collectRefRewrites(
  env: Env,
  repo: string,
  renames: { from: string; to: string }[],
): Promise<{ files: { path: string; base64: string }[]; touched: string[] }> {
  const files: { path: string; base64: string }[] = [];
  const touched: string[] = [];
  if (!renames.length) return { files, touched };

  const treeRes = await fetch(
    `${GH_API}/repos/${repo}/git/trees/${branchOf(env)}:${CONTENT_DIR.split('/').map(encodeURIComponent).join('/')}?recursive=1`,
    { headers: ghHeaders(env) },
  );
  if (!treeRes.ok) return { files, touched };
  const tree = ((await treeRes.json()) as { tree?: { path: string; type: string }[] }).tree || [];
  const posts = tree.filter((e) => e.type === 'blob' && e.path.endsWith('.md')).map((e) => e.path);

  for (const rel of posts.slice(0, 60)) {
    const full = CONTENT_DIR + '/' + rel;
    const f = await ghGetFile(env, full);
    if (!f) continue;
    let text = f.text;
    let hit = false;
    for (const r of renames) {
      const oldName = r.from.split('/').pop() || '';
      const newName = r.to.split('/').pop() || '';
      const pairs: [string, string][] = [
        ['/uploads/' + oldName, '/uploads/' + newName],
        ['/uploads/' + encodeURIComponent(oldName), '/uploads/' + encodeURIComponent(newName)],
      ];
      for (const [a, z] of pairs) {
        if (text.includes(a)) { text = text.split(a).join(z); hit = true; }
      }
    }
    if (hit) {
      files.push({ path: full, base64: toBase64(text) });
      touched.push(rel);
    }
  }
  return { files, touched };
}

/** 从 GitHub 取一个文件：返回正文与 sha（不存在则 sha 为空） */
async function ghGetFile(env: Env, path: string): Promise<{ text: string; sha: string } | null> {
  /*
   * ⚠️ 路径必须**逐段 URL 编码**。漏了这一步，中文路径（中文分类目录、
   * 中文文件名）会让 GitHub 返回 404 —— 表现为「这篇文章/这张图在仓库里找不到」，
   * 而实际上它就在那儿。踩过两次：图库中文分类、以及后台重建索引读到中文文章名。
   */
  const url = `${GH_API}/repos/${repoOf(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${branchOf(env)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('读文件失败（HTTP ' + res.status + '）');
  const data = (await res.json()) as { content?: string; sha?: string };
  const text = data.content ? new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))) : '';
  return { text, sha: data.sha || '' };
}

/** 把 base64 编码成 GitHub 要的形式（UTF-8 安全 —— 中文必须这样处理） */
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function ghPutFile(env: Env, path: string, content: string, message: string, sha: string): Promise<void> {
  const body: Record<string, unknown> = { message, content: toBase64(content), branch: branchOf(env) };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH_API}/repos/${repoOf(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('提交失败（HTTP ' + res.status + '）：' + t.slice(0, 200));
  }
}

async function ghDeleteFile(env: Env, path: string, message: string, sha: string): Promise<void> {
  const res = await fetch(`${GH_API}/repos/${repoOf(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: branchOf(env) }),
  });
  if (!res.ok) throw new Error('删除失败（HTTP ' + res.status + '）');
}

/** 拆出 frontmatter 与正文 */
function splitYaml(text: string): { yaml: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { yaml: '', body: text };
  return { yaml: m[1], body: text.slice(m[0].length) };
}

const yamlOne = (yaml: string, key: string): string | undefined => {
  const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(yaml);
  return m ? m[1].replace(/^["']|["']$/g, '') : undefined;
};

/** YAML 里要用双引号包起来才安全的标量（标题里常有冒号、井号） */
function yamlStr(s: string): string {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** 标签数组：一律写成行内 `tags: [a, b]`，和现有文章的写法一致 */
function yamlTags(tags: string[]): string {
  const clean = tags.map((t) => String(t).trim()).filter(Boolean);
  if (!clean.length) return 'tags: []';
  return 'tags: [' + clean.map((t) => (String(t).includes(',') ? yamlStr(t) : t)).join(', ') + ']';
}

/** 把字段写回 frontmatter：已存在的键就地替换，没有的键追加到末尾 */
function setYamlKey(yaml: string, key: string, value: string): string {
  const re = new RegExp('^(' + key + ':)\\s*.+?\\s*$', 'm');
  if (re.test(yaml)) return yaml.replace(re, key + ': ' + value);
  const lines = yaml.split(/\r?\n/);
  lines.push(key + ': ' + value);
  return lines.join('\n');
}

/** 新建文章的 slug：日期 + 标题里的安全字符（中文照留，站点本来就支持） */
function makeSlug(date: string, title: string): string {
  const t = String(title)
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`~]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  return d + '-' + (t || 'untitled');
}

async function handleAdmin(request: Request, env: Env, pathname: string, url: URL): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return json(
      { message: '服务端还没配置写作权限（GITHUB_TOKEN）。在 workers/oauth 里跑一次：wrangler secret put GITHUB_TOKEN' },
      500, request, env,
    );
  }

  /*
   * 自检：把 GitHub 实际认定的权限摊开给用户看。
   * 保存报 403「Resource not accessible by personal access token」时，
   * 十有八九是 token 没写权限（classic 没勾 repo / fine-grained 没给 Contents: Read and write /
   * 或者 Repositories 没选中这个仓库）。这里直接把 GitHub 的答复原样返回，省得来回猜。
   *
   * ⚠️ 这个接口**故意不要 ticket**：它不返回任何秘密（token 不会被打印出来），
   * 只是「服务端配置对不对」的健康检查 —— 部署完想确认能不能写，直接打它就行，
   * 不必先登录。它确实暴露了「仓库名 / token 归属账号 / 有没有写权限」，但这些都是
   * 仓库本身公开可见的信息，不构成泄漏。
   */
  if (pathname === '/admin/whoami') {
    const out: Record<string, unknown> = { repo: repoOf(env), branch: branchOf(env) };
    try {
      const u = await fetch(GH_API + '/user', { headers: ghHeaders(env) });
      const uj = (await u.json()) as { login?: string; message?: string };
      out.status = u.status;
      /* token 的权限范围只在 classic token 的响应头里；fine-grained 用别的方式表达 */
      out.tokenScopes = u.headers.get('x-oauth-scopes');
      out.acceptedScopes = u.headers.get('x-accepted-oauth-scopes');
      out.user = uj.login || uj.message || '(未知)';
    } catch (e) {
      out.userError = (e as Error).message;
    }
    try {
      const r = await fetch(`${GH_API}/repos/${repoOf(env)}`, { headers: ghHeaders(env) });
      const rj = (await r.json()) as { permissions?: Record<string, boolean>; message?: string; full_name?: string };
      out.repoStatus = r.status;
      out.repoFullName = rj.full_name || rj.message || '';
      out.permissions = rj.permissions || null;
      /* 能不能写，就看 push 这一项 —— 保存走的正是 contents 接口 */
      out.canWrite = !!(rj.permissions && rj.permissions.push);
    } catch (e) {
      out.repoError = (e as Error).message;
    }
    return json(out, 200, request, env);
  }

  /* ↓↓↓ 以下接口都需要口令换来的 ticket ↓↓↓ */
  let body: {
    ticket?: string; path?: string; title?: string; body?: string; category?: string;
    tags?: string[]; summary?: string; date?: string; draft?: boolean; private?: boolean;
  } = {};
  try { body = await request.json(); } catch { /* 空 body 也行 */ }
  const ticket = String(body.ticket || url.searchParams.get('ticket') || '');
  if (!(await ticketValid(env, ticket))) {
    return json({ message: '登录已过期，回到 /admin/m/ 重新输一次口令' }, 401, request, env);
  }

  /* ---------------------------------------------------------- 图库（图片分类）

  /*
   * 分类 = public/uploads 下的**子目录名**。
   * 为什么用目录而不是在文件名里加前缀：这样 Decap 自带的媒体库也能按文件夹浏览，
   * 注意路径是**扁平**的：/uploads/xxx.jpg（分类在 categories.json 里）。
   * 之所以不放子目录，是因为 Decap 的媒体库只列 media_folder 根目录 ——
   * 见 MEDIA_META 的注释，那里写了完整原因。
   */
  if (GALLERY_PATHS.includes(pathname)) {
    const repo = repoOf(env);
    const dirOf = (rel: string) => {
      /* 'public/uploads/表情包/a.jpg' → '表情包'；根目录下的 → ''（未分类） */
      const inside = rel.replace(new RegExp('^' + UPLOAD_DIR + '/?'), '');
      const cut = inside.lastIndexOf('/');
      return cut < 0 ? '' : inside.slice(0, cut);
    };

    /*
     * 已经存在的缩略图（文件名集合）。
     * 和上面的 tree 一样要逐段编码 —— 缩略图名往往就是中文图片名。
     * 目录不存在（还没生成过任何缩略图）时 GitHub 给 404，当成空集合即可。
     */
    const thumbNames = async (): Promise<Set<string>> => {
      const url = `${GH_API}/repos/${repo}/git/trees/${branchOf(env)}:${(UPLOAD_DIR + '/thumbs').split('/').map(encodeURIComponent).join('/')}?recursive=1`;
      try {
        const r = await fetch(url, { headers: ghHeaders(env) });
        if (!r.ok) return new Set<string>();
        const d = (await r.json()) as { tree?: { path: string; type: string }[] };
        return new Set((d.tree || []).filter((e) => e.type === 'blob').map((e) => treeBaseName(e.path)));
      } catch {
        return new Set<string>();
      }
    };

    try {
      /* 列全部图片 */
      if (pathname === '/admin/images') {
        /* 路径要逐段编码（中文分类目录），但 ':' 必须保持字面量 —— 它是 tree 接口的分支/路径分隔符 */
        const treeUrl = `${GH_API}/repos/${repo}/git/trees/${branchOf(env)}:${UPLOAD_DIR.split('/').map(encodeURIComponent).join('/')}?recursive=1`;
        const res = await fetch(treeUrl, { headers: ghHeaders(env) });
        if (res.status === 404) return json({ images: [], dirs: [] }, 200, request, env);
        if (!res.ok) return json({ message: '读图片列表失败（HTTP ' + res.status + '）' }, 502, request, env);
        const data = (await res.json()) as { tree?: { path: string; type: string; size?: number }[] };
        const meta = await readMediaMeta(env);
        /* 哪些图已经有缩略图 —— 界面据此标一下「还没有缩略图（老图，跑 npm run thumbs）」 */
        const thumbs = await thumbNames();
        const images = (data.tree || [])
          /* 分类索引本身不是图片，别列进去；thumbs/ 下的是缩略图，更不该当成一张「图」 */
          .filter((e) => e.type === 'blob' && IMAGE_EXT.test(e.path)
            && !/categories\.json$/i.test(e.path)
            && !/^thumbs\//i.test(e.path))
          .map((e) => {
            const name = e.path.split('/').pop() || e.path;
            const rel = UPLOAD_DIR + '/' + e.path;
            return {
              path: rel,
              url: '/uploads/' + e.path.split('/').map(encodeURIComponent).join('/'),
              name,
              /*
               * 分类优先看索引（新方案）；没登记的老图就按它所在的子目录算 ——
               * 迁移期两种都存在，谁也不用先动。
               */
              dir: meta[name] !== undefined ? meta[name] : legacyDirOf(rel),
              size: e.size || 0,
              /* 缩略图是 .jpg，而站点那边找的也正是 <同名>.jpg（见 thumbPathFor 的说明） */
              hasThumb: thumbs.has(name.replace(/\.[^.]+$/, '.jpg')),
            };
          })
          .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir.localeCompare(b.dir)));
        const dirs = [...new Set(images.map((i) => i.dir))].filter((d) => d !== '').sort();
        return json({ images, dirs, count: images.length }, 200, request, env);
      }

      /* 上传（手机上是相册选图 → base64 传过来；浏览器里顺手生成的缩略图一起传） */
      if (pathname === '/admin/image/upload') {
        const b = body as { name?: string; dataUrl?: string; dir?: string; thumbDataUrl?: string };
        const raw = String(b.dataUrl || '');
        const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(raw);
        if (!m) return json({ message: '图片数据格式不对（需要 data:image/...;base64,...）' }, 400, request, env);
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        if (!IMAGE_EXT.test('x.' + ext)) return json({ message: '不支持的图片格式：' + ext }, 400, request, env);
        const dir = String(b.dir || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
        const base = safeName(String(b.name || 'image'));

        /*
         * 文件**平铺在 uploads 根目录**（不放分类子目录）——
         * 因为 Decap 的媒体库只列根目录，放子目录里它就看不见（见 MEDIA_META 的注释）。
         * 分类记在索引文件里。
         */
        const bare = `${base}.${ext}`;
        const existing = await ghGetBlob(env, UPLOAD_DIR + '/' + bare);
        const finalName = existing
          ? bare.replace(/\.(\w+)$/, '-' + Date.now().toString(36) + '.$1')
          : bare;
        const finalPath = UPLOAD_DIR + '/' + finalName;

        const meta = await readMediaMeta(env);
        if (dir) meta[finalName] = dir; else delete meta[finalName];

        /*
         * 缩略图（#1 的遗留缺口）：离线那套 tools/make-thumbs.mjs 只覆盖
         * **已存在**的图，新上传的图要等谁手动跑一次才有缩略图。
         * 现在客户端在上传前用**同一套 canvas 逻辑**（720px / q68）生成一张，
         * 跟着主图一起传上来，服务端写进 public/uploads/thumbs/。
         *
         * 缩略图是**可选**的：老客户端不传、或图本身不需要缩略图（小图、gif）时就只有主图 ——
         * 这和以前的行为一样，不会因为缺缩略图让上传失败。
         */
        const files: { path: string; base64: string }[] = [{ path: finalPath, base64: m[2].replace(/\s/g, '') }];
        let thumbPath = '';
        const thumbRaw = String(b.thumbDataUrl || '');
        if (thumbRaw) {
          const tm = /^data:image\/jpe?g;base64,(.+)$/i.exec(thumbRaw);
          if (tm) {
            thumbPath = thumbPathFor(finalPath);
            files.push({ path: thumbPath, base64: tm[1].replace(/\s/g, '') });
          } else {
            /* 传了但格式不对：当成没传（主图照样能传上去），但要说一声 */
            console.log('上传时带的缩略图不是 JPEG dataURL，已忽略');
          }
        }
        files.push({ path: MEDIA_META, base64: mediaMetaBase64(meta) });

        /* 图片本体 + 缩略图 + 分类索引，**一次提交**（不会出现「图传上了但没归类/没缩略图」的中间态） */
        await ghCommitMany(env, files, [], 'media: 上传 ' + finalName + (dir ? '（' + dir + '）' : ''));

        return json({
          ok: true,
          path: finalPath,
          url: '/uploads/' + encodeURIComponent(finalName),
          thumb: thumbPath,
          dir,
        }, 200, request, env);
      }

      /*
       * 改分类：**只改索引文件，不搬图片**。
       * 好处很实在：一次提交、一个字节没动 —— 也就不可能把图片搬坏
       * （之前「移进子目录」的写法真的把二进制毁过）。
       * 例外：迁移期那些还躺在子目录里的老图，顺手挪回根目录（这样 Decap 也看得到）。
       */
      if (pathname === '/admin/image/move') {
        const b = body as { path?: string; dir?: string };
        const from = String(b.path || '');
        if (!from.startsWith(UPLOAD_DIR + '/') || from.includes('..')) return json({ message: '路径不合法' }, 400, request, env);
        const dir = String(b.dir || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
        const fileName = from.split('/').pop() || '';

        const meta = await readMediaMeta(env);
        const files: { path: string; base64: string }[] = [];
        const removes: string[] = [];
        let newPath = from;
        let newName = fileName;

        if (legacyDirOf(from) !== '') {
          /* 老图在子目录里：挪到根目录（内容原样，blob 复用） */
          const blob = await ghGetBlob(env, from);
          if (!blob) return json({ message: '这张图在仓库里找不到了（可能已被删或改名）' }, 404, request, env);
          newName = (await ghGetBlob(env, UPLOAD_DIR + '/' + fileName))
            ? fileName.replace(/\.(\w+)$/, '-' + Date.now().toString(36) + '.$1')
            : fileName;
          newPath = UPLOAD_DIR + '/' + newName;
          files.push({ path: newPath, base64: blob.base64 });
          removes.push(from);
          delete meta[fileName];
        }

        if (dir) meta[newName] = dir; else delete meta[newName];
        files.push({ path: MEDIA_META, base64: mediaMetaBase64(meta) });

        await ghCommitMany(env, files, removes, 'media: 归类 ' + newName + ' → ' + (dir || '未分类'));
        return json({ ok: true, path: newPath, dir, url: '/uploads/' + encodeURIComponent(newName) }, 200, request, env);
      }

      /*
       * 重命名图片。
       *
       * 为什么要连文章一起改：图库里的图常常已经被文章引用了，
       * 只改文件名 → 文章里的 ![](/uploads/旧名.jpg) 立刻变破图。
       * 所以默认 **同时更新所有文章里的引用**，而且和改名放在**同一次提交**里 ——
       * 要么都成功，要么都没发生（不会出现"改完名字文章全破"的中间态）。
       */
      if (pathname === '/admin/image/rename') {
        const b = body as { path?: string; name?: string; updateRefs?: boolean };
        const from = String(b.path || '');
        if (!from.startsWith(UPLOAD_DIR + '/') || from.includes('..')) return json({ message: '路径不合法' }, 400, request, env);
        const oldName = from.split('/').pop() || '';
        const extMatch = /\.([a-z0-9]+)$/i.exec(oldName);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';

        /* 用户在输入框里可能连后缀一起写，这里统一去掉再补回原后缀（不允许改格式） */
        const asked = String(b.name || '').replace(/\.[a-z0-9]+$/i, '');
        const base = safeName(asked);
        if (!base || base === 'image') return json({ message: '新文件名不能为空' }, 400, request, env);
        const newName = `${base}.${ext}`;
        if (newName === oldName) return json({ ok: true, path: from, name: oldName, note: '名字没变' }, 200, request, env);

        const to = UPLOAD_DIR + '/' + newName;
        if (await ghGetBlob(env, to)) {
          return json({ message: '已经有叫「' + newName + '」的图了，换个名字' }, 409, request, env);
        }
        const blob = await ghGetBlob(env, from);
        if (!blob) return json({ message: '这张图在仓库里找不到了（可能已被删或改名）' }, 404, request, env);

        const files: { path: string; base64: string }[] = [{ path: to, base64: blob.base64 }];
        const removes: string[] = [from];

        /* 分类索引跟着改名走（索引是以文件名为键的） */
        const meta = await readMediaMeta(env);
        const keptDir = meta[oldName];
        delete meta[oldName];
        if (keptDir) meta[newName] = keptDir;
        files.push({ path: MEDIA_META, base64: mediaMetaBase64(meta) });

        /* 顺带把文章里的引用改掉（默认开；用户可以在界面上关掉） */
        let touched: string[] = [];
        if (b.updateRefs !== false) {
          const rw = await collectRefRewrites(env, repo, [{ from, to }]);
          files.push(...rw.files);
          touched = rw.touched;
        }

        await ghCommitMany(env, files, removes, 'media: 改名 ' + oldName + ' → ' + newName + (touched.length ? '（同时更新 ' + touched.length + ' 篇文章的引用）' : ''));
        return json({
          ok: true,
          path: to,
          name: newName,
          dir: keptDir || '',
          url: '/uploads/' + encodeURIComponent(newName),
          refsUpdated: touched.length,
        }, 200, request, env);
      }

      /*
       * 统一提交：把图库里攒下的所有改动**一次**推到 GitHub。
       *
       * 为什么要有它：改一次名字 / 换一次分类原本各要 1~2 次提交，
       * 每次都要等 GitHub 一两秒 —— 连着改十张图就要等十几秒，非常难受。
       * 现在界面上先攒成一个队列（见 public/admin/g/ui.js 的 pending），
       * 点「提交」时把 N 项改动一次发过来，这里用**一次 tree 提交**全部落地。
       *
       * 每项的语义是「这个文件最终应该是什么样」：
       *   { from, to, dir }  → to 与 from 不同就是改名；dir 是最终分类（'' = 未分类）
       *   { from, delete:1 } → 删除
       * 传的是最终状态而不是一串动作，所以「先改名再改分类」天然被合并成一项，
       * 不会出现两个操作打架的情况。
       */
      if (pathname === '/admin/images/commit') {
        const raw = Array.isArray((body as { ops?: unknown }).ops) ? ((body as { ops: unknown[] }).ops) : [];
        if (!raw.length) return json({ message: '没有待提交的改动' }, 400, request, env);
        if (raw.length > 80) return json({ message: '一次最多提交 80 项（你提交了 ' + raw.length + ' 项）' }, 400, request, env);

        const ops: { from: string; to: string; dir?: string; del: boolean }[] = [];
        for (const item of raw) {
          const o = (item || {}) as { from?: string; to?: string; dir?: unknown; delete?: unknown };
          const from = String(o.from || '');
          if (!from.startsWith(UPLOAD_DIR + '/') || from.includes('..')) {
            return json({ message: '路径不合法：' + from }, 400, request, env);
          }
          const del = o.delete === true || o.delete === 1;
          const to = String(o.to || from);
          if (!del) {
            if (!to.startsWith(UPLOAD_DIR + '/') || to.includes('..')) {
              return json({ message: '目标路径不合法：' + to }, 400, request, env);
            }
          }
          const dir = o.dir === undefined || o.dir === null
            ? undefined
            : String(o.dir).replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
          if (!del && to === from && dir === undefined) continue;   /* 什么都没改，跳过 */
          ops.push({ from, to, dir, del });
        }
        if (!ops.length) return json({ ok: true, applied: 0, refsUpdated: 0, note: '没有实际改动' }, 200, request, env);

        const meta = await readMediaMeta(env);
        const files: { path: string; base64: string }[] = [];
        const removes: string[] = [];
        const renames: { from: string; to: string }[] = [];
        let moved = 0;
        let deleted = 0;
        let recategorized = 0;

        for (const op of ops) {
          const oldName = op.from.split('/').pop() || '';
          if (op.del) {
            if (!(await ghGetBlob(env, op.from))) continue;   /* 仓库里已经没了，跳过 */
            removes.push(op.from);
            delete meta[oldName];
            deleted++;
            continue;
          }
          const newName = op.to.split('/').pop() || oldName;
          if (op.to !== op.from) {
            const blob = await ghGetBlob(env, op.from);
            if (!blob) continue;
            /* 改名后撞上别的图 → 整批拒绝，别悄悄覆盖 */
            if (await ghGetBlob(env, op.to)) {
              return json({ message: '已经有叫「' + newName + '」的图了，换个名字再提交' }, 409, request, env);
            }
            files.push({ path: op.to, base64: blob.base64 });
            removes.push(op.from);
            delete meta[oldName];
            renames.push({ from: op.from, to: op.to });
            moved++;
          }
          if (op.dir !== undefined) {
            if (op.dir) meta[newName] = op.dir; else delete meta[newName];
            recategorized++;
          }
        }

        files.push({ path: MEDIA_META, base64: mediaMetaBase64(meta) });
        /* 改名带来的文章引用改写，和上面这些放进同一次提交 */
        const rw = await collectRefRewrites(env, repo, renames);
        files.push(...rw.files);

        const parts: string[] = [];
        if (moved) parts.push('改名 ' + moved);
        if (recategorized) parts.push('归类 ' + recategorized);
        if (deleted) parts.push('删除 ' + deleted);
        if (rw.touched.length) parts.push('更新 ' + rw.touched.length + ' 篇引用');
        await ghCommitMany(env, files, removes, 'media: 批量改动 ' + ops.length + ' 项（' + parts.join('，') + '）');

        return json({
          ok: true,
          applied: ops.length,
          moved,
          recategorized,
          deleted,
          refsUpdated: rw.touched.length,
        }, 200, request, env);
      }

      /* 删除图片：连索引里那条记录一起清掉，免得留下指向空气的分类 */
      if (pathname === '/admin/image/delete') {
        const b = body as { path?: string };
        const target = String(b.path || '');
        if (!target.startsWith(UPLOAD_DIR + '/') || target.includes('..')) return json({ message: '路径不合法' }, 400, request, env);
        const fileName = target.split('/').pop() || '';
        const blob = await ghGetBlob(env, target);
        if (!blob) return json({ message: '这张图已经不在仓库里了' }, 404, request, env);
        const meta = await readMediaMeta(env);
        delete meta[fileName];
        await ghCommitMany(env, [{ path: MEDIA_META, base64: mediaMetaBase64(meta) }], [target], 'media: 删除 ' + fileName);
        return json({ ok: true }, 200, request, env);
      }
    } catch (e) {
      return json({ message: (e as Error).message }, 502, request, env);
    }
  }

  /*
   * 批量操作：一次提交处理多张图（图库的「批处理」）。
   * paths 里每项都是 public/uploads 下的路径；改分类时整批用同一个 dir。
   * 走 ghCommitMany（Git tree 接口），所以 10 张图 = 1 条 commit，而不是 20 次请求。
   */
  if (pathname === '/admin/images/batch') {
    const b = body as { action?: string; paths?: string[]; dir?: string };
    const action = String(b.action || '');
    const paths = (Array.isArray(b.paths) ? b.paths : []).filter(
      (x) => typeof x === 'string' && x.startsWith(UPLOAD_DIR + '/') && !x.includes('..'),
    );
    if (!paths.length) return json({ message: '没有选中任何图片' }, 400, request, env);
    if (paths.length > 60) return json({ message: '一次最多处理 60 张（你选了 ' + paths.length + ' 张）' }, 400, request, env);

    if (action === 'delete') {
      try {
        /*
         * 删文件的同时**也要清掉索引里对应的记录** —— 否则会留下指向空气的分类
         * （图没了，categories.json 里还写着它属于某个分类）。
         * 这个漏掉过一次，是测试盯出来的。
         * 注意 ghCommitMany 的参数顺序是 (env, files, removes, message)。
         */
        const meta = await readMediaMeta(env);
        for (const p of paths) delete meta[p.split('/').pop() || ''];
        await ghCommitMany(
          env,
          [{ path: MEDIA_META, base64: mediaMetaBase64(meta) }],
          paths,
          'media: 批量删除 ' + paths.length + ' 张图',
        );
        return json({ ok: true, count: paths.length, action: 'delete' }, 200, request, env);
      } catch (e) {
        return json({ message: (e as Error).message }, 502, request, env);
      }
    }

    if (action === 'move') {
      const dir = String(b.dir || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
      const files: { path: string; base64: string }[] = [];
      const removes: string[] = [];
      try {
        const meta = await readMediaMeta(env);
        let changed = 0;
        for (const from of paths) {
          const fileName = from.split('/').pop() || '';
          if (legacyDirOf(from) !== '') {
            /* 老图在子目录里：挪回根目录（内容原样复用 blob） */
            const blob = await ghGetBlob(env, from);
            if (!blob) continue;
            const newName = (await ghGetBlob(env, UPLOAD_DIR + '/' + fileName))
              ? fileName.replace(/\.(\w+)$/, '-' + Date.now().toString(36) + '.$1')
              : fileName;
            files.push({ path: UPLOAD_DIR + '/' + newName, base64: blob.base64 });
            removes.push(from);
            delete meta[fileName];
            if (dir) meta[newName] = dir; else delete meta[newName];
            changed++;
          } else {
            /* 文件已经在根目录，只需要改索引里的分类 */
            const was = meta[fileName] || '';
            if (was === dir) continue;               /* 本来就是这个分类 */
            if (dir) meta[fileName] = dir; else delete meta[fileName];
            changed++;
          }
        }
        if (!changed) return json({ ok: true, count: 0, action: 'move', dir, note: '这些图已经在该分类里了' }, 200, request, env);
        files.push({ path: MEDIA_META, base64: mediaMetaBase64(meta) });
        await ghCommitMany(env, files, removes, 'media: 批量归类 ' + changed + ' 张 → ' + (dir || '未分类'));
        return json({ ok: true, count: changed, action: 'move', dir }, 200, request, env);
      } catch (e) {
        return json({ message: (e as Error).message }, 502, request, env);
      }
    }

    return json({ message: '不支持的批量操作：' + action }, 400, request, env);
  }

  /*
   * 搜索索引（含**全文**，所以绝不能是公开文件）。
   *
   * 一开始我让构建脚本把它生成到 dist/private/ 下 —— 那是**静态托管**的目录，
   * 任何人访问 /private/posts-index.json 都能拿到全部正文、草稿和隐藏文章。
   * 「私人角落」那两份清单靠的是 Worker 的口令门槛，不是文件藏得深；
   * 而全文索引连那层门槛都没过。现在改成：**索引只存在 KV 里**，
   * 由 Worker 从 GitHub 现场构建（见下面的 /admin/reindex），读取必须持有 ticket。
   */
  if (pathname === '/admin/posts-index') {
    const raw = await env.LOGS?.get('posts:index');
    if (!raw) return json({ posts: [], generatedAt: '', needReindex: true }, 200, request, env);
    try {
      const data = JSON.parse(raw) as { posts?: unknown[]; generatedAt?: string };
      return json({ posts: data.posts || [], generatedAt: data.generatedAt || '' }, 200, request, env);
    } catch {
      return json({ posts: [], generatedAt: '', needReindex: true }, 200, request, env);
    }
  }

  /*
   * ⚠️ 踩过的坑：后台的路径原本要在**两个地方**登记 ——
   * 上面 fetch 里的路由表，和这里的实际实现。
   * 加「重命名」时我只加了后者，于是线上一直 404（测试才发现）。
   * 现在改成上面那张 ADMIN_POST_PATHS 表统一登记，这里不再各自判断。
   */

  /* 重建索引：从 GitHub 读全部文章 → 抽 frontmatter → 存进 KV（需要 ticket） */
  if (pathname === '/admin/reindex') {
    if (!env.LOGS) return json({ message: '没有绑定 KV（LOGS）' }, 500, request, env);
    const repo = repoOf(env);
    try {
      const treeRes = await fetch(
        `${GH_API}/repos/${repo}/git/trees/${branchOf(env)}:${CONTENT_DIR.split('/').map(encodeURIComponent).join('/')}?recursive=1`,
        { headers: ghHeaders(env) },
      );
      if (!treeRes.ok) return json({ message: '读文章目录失败（HTTP ' + treeRes.status + '）' }, 502, request, env);
      const tree = ((await treeRes.json()) as { tree?: { path: string; type: string }[] }).tree || [];
      const files = tree.filter((e) => e.type === 'blob' && e.path.endsWith('.md')).map((e) => e.path);

      const posts: Record<string, unknown>[] = [];
      for (const rel of files) {
        const full = CONTENT_DIR + '/' + rel;
        const f = await ghGetFile(env, full).catch(() => null);
        if (!f) continue;
        const { yaml, body } = splitYaml(f.text);
        const pick = (k: string) => yamlOne(yaml, k);
        const tags = (() => {
          const inline = /^tags:\s*\[([^\]]*)\]\s*$/m.exec(yaml);
          if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          const block = /^tags:\s*\n((?:\s+-\s*.+\n?)+)/m.exec(yaml);
          if (block) return block[1].split('\n').map((l) => l.replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          return [];
        })();
        const category = pick('category') || '';
        const isPrivate = pick('private') === 'true';
        const text = body
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/`[^`]*`/g, ' ')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/^\s{0,3}#{1,6}\s+/gm, '')
          .replace(/^\s{0,3}>\s?/gm, '')
          .replace(/^\s{0,3}[-*+]\s+/gm, '')
          .replace(/[*_~`|]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const slug = slugify(rel);
        posts.push({
          slug,
          /* 站内路径：后台「点开文章」要用它。拼错就是 404，所以这里统一算好 */
          url: '/posts/' + slug + '/',
          path: full,
          title: pick('title') || rel,
          date: (pick('date') || '').slice(0, 10),
          updated: (pick('updated') || '').slice(0, 10),
          category,
          tags,
          summary: pick('summary') || '',
          draft: pick('draft') === 'true',
          /* 和 src/lib/hidden.ts 同一条规则：分类是「日记」或手写 private: true */
          hidden: isPrivate || category === '日记',
          words: text.length,
          /* 全文只留前面一段，够搜就行；索引在 KV 里，不落公开文件 */
          text: text.slice(0, 4000),
        });
      }
      posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const payload = { generatedAt: new Date().toISOString(), posts };
      await env.LOGS.put('posts:index', JSON.stringify(payload));
      return json({ ok: true, count: posts.length, generatedAt: payload.generatedAt }, 200, request, env);
    } catch (e) {
      return json({ message: '重建索引失败：' + (e as Error).message }, 502, request, env);
    }
  }

  /* 列清单：构建时生成的静态文件（含草稿），不占 GitHub 配额 */
  if (pathname === '/admin/posts') {
    try {
      const r = await fetch(manifestUrl(request).replace('/private/posts.json', '/private/posts-all.json'), {
        cf: { cacheTtl: 0, cacheEverything: false },
      } as RequestInit);
      if (!r.ok) return json({ message: '清单还没生成（构建时会生成 dist/private/posts-all.json）' }, 500, request, env);
      const data = (await r.json()) as { posts?: unknown[]; generatedAt?: string };
      return json({ posts: data.posts || [], generatedAt: data.generatedAt || '' }, 200, request, env);
    } catch (e) {
      return json({ message: '取清单失败：' + (e as Error).message }, 502, request, env);
    }
  }

  const rel = String(body.path || '');
  /*
   * 只允许改 src/content/posts/ 下的 .md —— 显式前缀 + 不许出现 ..
   * （光靠正则容易漏掉路径穿越，写成白名单更省心）
   */
  if (rel && (!/^src\/content\/posts\/[\w\u4e00-\u9fa5.-]+\.md$/.test(rel) || rel.includes('..'))) {
    return json({ message: '文件名不合法' }, 400, request, env);
  }

  /* 读一篇的原文 */
  if (pathname === '/admin/file') {
    if (!rel) return json({ message: '缺少 path' }, 400, request, env);
    try {
      const f = await ghGetFile(env, rel);
      if (!f) return json({ message: '这篇文章在仓库里找不到（可能刚被改名或删除）' }, 404, request, env);
      const { yaml: y, body: b } = splitYaml(f.text);
      return json({
        path: rel, body: b, sha: f.sha,
        title: yamlOne(y, 'title') || '',
        date: (yamlOne(y, 'date') || '').slice(0, 10),
        category: yamlOne(y, 'category') || '',
        summary: yamlOne(y, 'summary') || '',
        updated: (yamlOne(y, 'updated') || '').slice(0, 10),
        draft: yamlOne(y, 'draft') === 'true',
        private: yamlOne(y, 'private') === 'true',
        tags: (() => {
          const inline = /^tags:\s*\[([^\]]*)\]\s*$/m.exec(y);
          if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          const block = /^tags:\s*\n((?:\s+-\s*.+\n?)+)/m.exec(y);
          if (block) return block[1].split('\n').map((l) => l.replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          return [];
        })(),
      }, 200, request, env);
    } catch (e) {
      return json({ message: (e as Error).message }, 502, request, env);
    }
  }

  /* 保存（新建或更新） */
  if (pathname === '/admin/save') {
    const now = new Date().toISOString().slice(0, 10);
    const title = String(body.title || '').trim();
    const text = String(body.body ?? '');
    if (!title) return json({ message: '标题不能空' }, 400, request, env);
    /*
     * 正文**不设长度下限**（原来卡 20 字，已按用户要求去掉）。
     * 短句、一张图配一行字、一句话日记都是正当内容；
     * 也**不要**改成「必须非空」—— 只放图片的文章正文里可能只有一行 markdown。
     * 标题仍然必须要有：没有标题就生成不了文件名（slug）。
     */
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const category = String(body.category || '随笔').trim() || '随笔';
    try {
      if (rel) {
        /* 改已有文章：只动需要变的几行，注释与字段顺序保留 */
        const f = await ghGetFile(env, rel);
        if (!f) return json({ message: '这篇文章在仓库里找不到（可能刚被改名或删除）' }, 404, request, env);
        const { yaml: y, body: oldBody } = splitYaml(f.text);
        /* 改之前的标题：日志里「从什么改成什么」比只记新标题有用得多 */
        const oldTitle = yamlOne(y, 'title') || rel;
        let next = y;
        next = setYamlKey(next, 'title', yamlStr(title));
        next = setYamlKey(next, 'updated', now);
        next = setYamlKey(next, 'category', category);
        next = setYamlKey(next, 'tags', yamlTags(tags).replace(/^tags:\s*/, ''));
        if (body.summary !== undefined) next = setYamlKey(next, 'summary', yamlStr(String(body.summary)));
        if (body.draft !== undefined) next = setYamlKey(next, 'draft', body.draft ? 'true' : 'false');
        if (body.private !== undefined) next = setYamlKey(next, 'private', body.private ? 'true' : 'false');
        /*
     * 正文**原样保留**，只做一件事：把 CRLF 统一成 LF。
     * 用户报过「结尾的换行符被吞掉了」—— 所以这里刻意**不** trim：
     * 结尾的空行、行尾两个空格（Markdown 的硬换行）、列表缩进全都要留着。
     * 长度校验用的是 text.trim()，跟这里无关，别为了校验去改正文。
     */
    const keptBody = (text.trim() ? text : oldBody).replace(/\r\n/g, '\n');
        /* frontmatter 的尾随空行清掉（那是我自己拼的），正文一个字符都不动 */
        const out = '---\n' + next.replace(/\r?\n/g, '\n').replace(/\n+$/, '') + '\n---\n\n' + keptBody;
        await ghPutFile(env, rel, out, 'post: 更新《' + title + '》', f.sha);
        const url = '/posts/' + rel.split('/').pop()!.replace(/\.md$/, '') + '/';
        await logPostChange(env, { action: '修改', title, was: oldTitle, url, ip: clientIp(request) });
        return json({ ok: true, path: rel, url, updated: now }, 200, request, env);
      }

      /* 新建 */
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : now;
      const slug = makeSlug(date, title);
      const newPath = CONTENT_DIR + '/' + slug + '.md';
      const existing = await ghGetFile(env, newPath);
      if (existing) return json({ message: '已经有同名文章了（' + slug + '）—— 改个标题或日期' }, 409, request, env);
      const fm = [
        '---',
        'title: ' + yamlStr(title),
        'date: ' + date,
        'updated: ' + now,
        'category: ' + category,
        yamlTags(tags),
        body.summary ? 'summary: ' + yamlStr(String(body.summary)) : 'summary: ""',
        'pinned: false',
        'draft: ' + (body.draft ? 'true' : 'false'),
        'private: ' + (body.private ? 'true' : 'false'),
        '---',
        '',
        /* 新建：同样只统一换行，不 trim —— 用户排的版是他的 */
        text.replace(/\r\n/g, '\n'),
      ].join('\n');
      await ghPutFile(env, newPath, fm, 'post: 新建《' + title + '》', '');
      await logPostChange(env, { action: '新增', title, url: '/posts/' + slug + '/', ip: clientIp(request) });
      return json({ ok: true, path: newPath, url: '/posts/' + slug + '/', updated: now }, 200, request, env);
    } catch (e) {
      return json({ message: (e as Error).message }, 502, request, env);
    }
  }

  /* 删除 */
  if (pathname === '/admin/delete') {
    if (!rel) return json({ message: '缺少 path' }, 400, request, env);
    try {
      const f = await ghGetFile(env, rel);
      if (!f) return json({ message: '已经不存在了' }, 404, request, env);
      /*
       * 标题要**在删掉之前**从 frontmatter 里读出来 —— 删完就只剩文件名了。
       * （文件名兜底也留着：万一 frontmatter 里没有 title。）
       */
      const fileBase = rel.split('/').pop()!.replace(/\.md$/, '');
      const delTitle = yamlOne(splitYaml(f.text).yaml, 'title') || fileBase;
      await ghDeleteFile(env, rel, 'post: 删除《' + delTitle + '》', f.sha);
      /* 文章已经没了，所以链接留空 —— 界面上标题就不做成可点的 */
      await logPostChange(env, { action: '删除', title: delTitle, url: '', ip: clientIp(request) });
      return json({ ok: true }, 200, request, env);
    } catch (e) {
      return json({ message: (e as Error).message }, 502, request, env);
    }
  }

  return json({ message: 'Not Found' }, 404, request, env);
}

/* ------------------------------------------------------------------ 入口 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { headers });

    /* ---- 手机写作页（口令换 ticket，写仓库由 Worker 代劳）---- */
    if (ADMIN_POST_PATHS.includes(url.pathname) && request.method === 'POST') {
      return handleAdmin(request, env, url.pathname, url);
    }

    /* ---- 私人角落 ---- */
    if (url.pathname === '/hidden' && request.method === 'POST') return handleHidden(request, env);
    if (url.pathname === '/hidden/leave' && request.method === 'POST') return handleLeave(request, env);
    if (url.pathname === '/hidden/logs' && request.method === 'GET') return handleLogs(request, env);

    /* ---- 文章增删改日志（永久保留，和上面那份访问日志不是一回事）---- */
    if (url.pathname === '/admin/post-logs' && request.method === 'GET') return handlePostLogs(request, env);

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

      const tokenRes = await fetch(GITHUB_TOKEN_URL, {
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
      /* routes 列在这里，用来一眼确认线上跑的到底是哪一版（排查"部署了但没生效"用） */
      return new Response(JSON.stringify({
        ok: true,
        service: 'yuuu-blog-v2 oauth + private',
        routes: ['/', '/auth', '/callback', '/hidden', '/hidden/leave', '/hidden/logs',
                 '/admin/post-logs',
                 '/admin/posts', '/admin/file', '/admin/save', '/admin/delete'],
        build: 'r3',
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers });
  },
};