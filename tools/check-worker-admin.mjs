/**
 * Worker「手机写作页」接口的检查 —— 不联网、不需要真 token。
 *
 * 为什么必须有：这几个接口会**往你的 GitHub 仓库写文件**。光看代码"觉得对"不行，
 * 得看它实际提交了什么内容、路径对不对、会不会把正文弄丢。
 *
 * 做法：把 worker 的 fetch 处理函数直接拿来调，把全局 fetch 换成假的来
 * 拦截 api.github.com —— 于是可以在本地完整跑一遍「新建 / 改名保存 / 校验拦截」。
 *
 * 跑法：node tools/check-worker-admin.mjs
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { console.log('  ✓ ' + label); return true; }
  failed++;
  console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
  return false;
};

/* ---------- 假环境 ---------- */
const kvStore = new Map();
/** put 时带的选项（expirationTtl）——「文章日志必须永久」这条要验 */
const kvOpts = new Map();
const env = {
  GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y',
  HIDDEN_PASSWORD: 'pw',
  LOGS_TOKEN: 'logs-token',
  GITHUB_TOKEN: 'ghp_fake',
  LOGS: {
    get: async (k) => (kvStore.has(k) ? kvStore.get(k) : null),
    put: async (k, v, o) => { kvStore.set(k, v); kvOpts.set(k, o || {}); },
    delete: async (k) => { kvStore.delete(k); kvOpts.delete(k); },
    /*
     * 真的 KV list() 支持 prefix（而且只返回匹配的键）。
     * 桩一开始只会返回空数组，于是任何靠 list 的功能都测不出来 ——
     * 文章日志的「全部历史」正好走这条路，所以这里要像真的。
     */
    list: async (o = {}) => ({
      keys: [...kvStore.keys()].filter((k) => !o.prefix || k.startsWith(o.prefix)).map((name) => ({ name })),
    }),
  },
};
kvStore.set('ticket:good-ticket', 'log-1');

/* ---------- 假 GitHub ---------- */
const gh = { calls: [], files: new Map() };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || 'GET').toUpperCase();

  /* 清单：走真实域名时给一份假清单 */
  if (/\/private\/posts-all\.json/.test(url)) {
    return new Response(JSON.stringify({ generatedAt: 'x', count: 1, posts: [{ slug: 'a', title: 'A' }] }), { status: 200 });
  }
  if (!/api\.github\.com/.test(url)) return realFetch(input, init);

  /* 图库列表走的是 git/trees 接口（递归列出 uploads 下所有文件） */
  /* 建 tree 是 POST /git/trees（批处理用），别跟「列目录」的 GET 混在一起 */
  if (process.env.STUB_DEBUG && /\/git\//.test(url)) console.log('   [stub] ' + method + ' ' + url.replace('https://api.github.com/repos/yangyuuuuu/yuuu-blog-v2', ''));
  if (/\/git\/trees$/.test(url) && method === 'POST') {
    const b = JSON.parse(init.body);
    gh.trees = (gh.trees || 0) + 1;
    gh.lastTree = b;
    /*
     * 真 GitHub 在这里收下 tree、返回一个新的 tree sha；
     * 之后 POST /git/commits 只带那个 sha，**不再带 tree 内容**。
     * 所以桩必须在这里把改动记下来，等 commit 时应用 ——
     * 之前桩在 commit 处理里读 b.tree，而 commit 请求体里根本没有它，于是拿到 undefined。
     */
    gh.pendingTree = b.tree || [];
    return new Response(JSON.stringify({ sha: 'tree-new-' + gh.trees }), { status: 201 });
  }

  const treeMatch = /\/git\/trees\/[^/]+:([^?]+)/.exec(url);
  if (treeMatch && method === 'GET') {
    /* 先切掉 query（'?recursive=1'），否则 decodeURIComponent 会因 % 非法而抛异常 */
    const dir = decodeURIComponent(treeMatch[1].split('?')[0]);
    if (process.env.STUB_DEBUG) {
      const bad = [...gh.files.keys()].filter((k) => typeof k !== 'string');
      console.log('   [stub] 列目录 dir=' + JSON.stringify(dir) + ' | 仓库 ' + gh.files.size + ' 个文件'
        + (bad.length ? ' | ❌ 有 ' + bad.length + ' 个非字符串键: ' + JSON.stringify(bad) : ''));
    }
    gh.calls.push({ method, path: 'tree:' + dir, body: null, message: '' });
    const tree = [...gh.files.entries()]
      .filter(([k]) => k.startsWith(dir + '/'))
      .map(([k, v], i) => ({ path: k.slice(dir.length + 1), type: 'blob', size: Buffer.from(v.base64, 'base64').length, sha: 'blob' + i }));
    return new Response(JSON.stringify({ sha: 't', truncated: false, tree }), { status: 200 });
  }
  /* ---- Git 数据库接口（批处理走这套：blob → tree → commit → 移动引用）---- */
  if (method === 'GET' && /\/git\/ref\/heads\//.test(url)) {
    return new Response(JSON.stringify({ object: { sha: gh.head || 'a1b2c3d4e5f6' } }), { status: 200 });
  }
  /* 读某个提交：路径里必须**真的带一个 sha**，否则会把 POST /git/commits 也吃掉 */
  if (method === 'GET' && /\/git\/commits\/[0-9a-f]{6,}/i.test(url)) {
    return new Response(JSON.stringify({ tree: { sha: 'tree-base' } }), { status: 200 });
  }
  if (/\/git\/commits$/.test(url) && method === 'POST') {
    const b = JSON.parse(init.body);
    /* 把 tree 里的改动落到假仓库：sha 为 null 表示删除，否则从 blobs 里取回 base64 */
    const items = gh.pendingTree || [];
    if (process.env.STUB_DEBUG) console.log('   [stub] 应用提交，tree 项数=' + items.length + ' blobs=' + (gh.blobs ? gh.blobs.size : 0));
    gh.batchCommits = (gh.batchCommits || 0) + 1;
    gh.lastCommit = b.message;
    gh.pendingTree = [];
    for (const item of items) {
      /* 桩也要像真 GitHub 一样盯住坏数据：path 必须是字符串 */
      if (typeof item.path !== 'string' || !item.path) {
        throw new Error('提交里出现了非法路径：' + JSON.stringify(item.path) + '（真 GitHub 也会拒绝这种请求）');
      }
      if (item.sha === null) { gh.files.delete(item.path); continue; }
      const content = (gh.blobs || new Map()).get(item.sha);
      gh.files.set(item.path, { base64: String(content == null ? '' : content).replace(/\n/g, ''), sha: item.sha });
    }
    gh.head = 'b' + String(gh.batchCommits).padStart(11, '0');
    return new Response(JSON.stringify({ sha: gh.head }), { status: 201 });
  }
  if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  /*
   * 按 sha 读一个 blob（真接口：GET /git/blobs/<sha>）。
   * worker 读「超过 1MB 的大文件」时走的就是这条路 ——
   * 因为 Contents API 对大文件不返回内容（见下面 GET 分支的注释）。
   */
  /* sha 用 [^/?]+ 而不是 [0-9a-f]+ —— 测试里的假 sha 带连字符，写窄了会静默走到别的分支 */
  const blobGet = /\/git\/blobs\/([^/?]+)$/.exec(url);
  if (blobGet && method === 'GET') {
    const content = (gh.blobs || new Map()).get(blobGet[1]);
    if (content == null) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({ sha: blobGet[1], size: Buffer.from(content, 'base64').length, content, encoding: 'base64' }), { status: 200 });
  }

  /* /git/blobs 上传二进制 */
  if (/\/git\/blobs$/.test(url) && method === 'POST') {
    const b = JSON.parse(init.body);
    /* 真 GitHub 收到的 content 本来就是 base64（encoding: 'base64'），原样存下来即可 ——
       别再 base64 一次，那会把内容变成「base64 的 base64」 */
    const sha = 'blob-' + Math.random().toString(36).slice(2, 8);
    gh.blobs = gh.blobs || new Map();
    gh.blobs.set(sha, String(b.content || '').replace(/\n/g, ''));
    gh.calls.push({ method, path: 'blob', body: b, message: '' });
    return new Response(JSON.stringify({ sha }), { status: 201 });
  }

  const path = decodeURIComponent(url.split('/contents/')[1]?.split('?')[0] || '');
  gh.calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, message: init.body ? JSON.parse(init.body).message : '' });

  if (method === 'GET') {
    const f = gh.files.get(path);
    if (!f) {
      /* 让「读不到」这件事在测试输出里看得见，而不是变成一句莫名的 TypeError */
      if (process.env.STUB_DEBUG) console.log('   [stub] 404 读不到: ' + JSON.stringify(path));
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (typeof f.base64 !== 'string') {
      throw new Error('测试数据有问题：gh.files 里的 ' + path + ' 没有 base64 字段（桩的 get 需要 base64）');
    }
    /*
     * 假的 GitHub 和真的行为一致：content 永远是 **base64**，
     * 不做 UTF-8 解码。之前这里把内容解码成文本再编码回去，
     * 于是「二进制损坏」这一类 bug 全被掩盖了 —— 图库那次就是这么漏过去的。
     *
     * ★ 另一条同样重要的是**大小**：真 GitHub 的 Contents API 对**超过 1MB**
     * 的文件**不返回 content**（encoding: "none"，content: ""，但 size 是真的）。
     * 桩原来一律返回内容，于是「大图被读成空串 → 写成 0 字节 → 原图被抹掉」
     * 这个**真丢过图**的 bug 在测试里完全隐形（站主的 14.8MB 若娜瓦就这么没的）。
     * 现在桩照真的来：大文件只给 sha/size，内容得自己走 /git/blobs 去取。
     */
    const inline = Buffer.from(f.base64, 'base64');
    const big = inline.length > 1024 * 1024;
    /*
     * 大文件的内容**只从 gh.blobs 里取**（真 GitHub 就是这样：blob 由 sha 唯一决定）。
     * 桩在这里**不自动补**，是为了让「内容取不到」这种情形能被测出来 ——
     * 需要读大文件的用例要自己 gh.blobs.set(sha, base64)。
     */
    return new Response(JSON.stringify({
      sha: f.sha, path,
      size: inline.length,
      content: big ? '' : f.base64 + '\n',
      encoding: big ? 'none' : 'base64',
    }), { status: 200 });
  }
  if (method === 'PUT') {
    const base64 = String(gh.calls.at(-1).body.content || '').replace(/\n/g, '');
    gh.files.set(path, { base64, sha: 'sha-' + (gh.files.size + 1) });
    /* 给文本类断言用（Markdown 场景）：解出来看看 */
    gh.lastPutText = Buffer.from(base64, 'base64').toString('utf8');
    gh.lastPutBase64 = base64;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (method === 'DELETE') { gh.files.delete(path); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  return new Response('{}', { status: 200 });
};

const worker = (await import('../workers/oauth/src/index.ts')).default;
const call = async (path, body, headers = {}) => {
  const res = await worker.fetch(new Request('https://oauth.yuuu.love' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://yuuu.love', ...headers },
    body: JSON.stringify(body),
  }), env);
  let data = null;
  try { data = await res.json(); } catch { /* 可能不是 json */ }
  return { status: res.status, data };
};

/** GET 一个接口（日志类是 GET + Bearer 口令） */
const get = async (path, tok) => {
  const res = await worker.fetch(new Request('https://oauth.yuuu.love' + path, {
    method: 'GET',
    headers: { Origin: 'https://yuuu.love', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  }), env);
  let data = null;
  try { data = await res.json(); } catch { /* 可能不是 json */ }
  return { status: res.status, data };
};

/* 每个请求带一个可辨认的 IP，用来验「日志里记的是访客 IP」 */
const IP = '203.0.113.9';
const callAs = (path, body) => call(path, body, { 'CF-Connecting-IP': IP });

const OLD = `---
title: 老标题
date: 2024-06-02
category: 技术
tags: [工具链, Node]

# 这行注释要保留
coverStyle: wave
---

正文第一段。

## 小标题

正文第二段，够二十个字了吧这样应该可以。
`;

/* ---------- 1. 认证 ---------- */
console.log('=== 1. ticket 校验 ===');
{
  const r = await call('/admin/posts', { ticket: 'bad' });
  ok(r.status === 401, '错 ticket 被拒（401）', 'status=' + r.status);
  const r2 = await call('/admin/posts', { ticket: 'good-ticket' });
  ok(r2.status === 200 && Array.isArray(r2.data?.posts), '对 ticket 能拿到清单');
}

/* ---------- 2. 读文件 ---------- */
console.log('=== 2. 读一篇文章 ===');
{
  gh.files.set('src/content/posts/old.md', { base64: Buffer.from(OLD, 'utf8').toString('base64'), sha: 'sha-old' });
  const r = await call('/admin/file', { ticket: 'good-ticket', path: 'src/content/posts/old.md' });
  ok(r.status === 200, '读取成功');
  ok(r.data?.title === '老标题', '解析出标题', r.data?.title);
  ok(r.data?.category === '技术', '解析出分类');
  ok(JSON.stringify(r.data?.tags) === JSON.stringify(['工具链', 'Node']), '解析出行内标签', JSON.stringify(r.data?.tags));
  ok(r.data?.body.includes('正文第一段'), '正文与 frontmatter 分开了');
  ok(!r.data?.body.includes('title: 老标题'), '正文里不含 frontmatter');
}

/* ---------- 3. 保存已有文章 ---------- */
console.log('=== 3. 改一篇：只动该动的行 ===');
{
  const r = await call('/admin/save', {
    ticket: 'good-ticket', path: 'src/content/posts/old.md',
    title: '新标题: 带冒号和 # 井号',
    body: '换掉后的正文，这里凑够二十个字用来通过站点的自检底线。',
    category: '随笔', tags: ['新标签'],
  });
  ok(r.status === 200, '保存返回成功', JSON.stringify(r.data));
  const out = gh.lastPutText || '';
  ok(out.startsWith('---\n'), 'frontmatter 还在最前面');
  ok(out.includes('title: "新标题: 带冒号和 # 井号"'), '标题带冒号/井号会被引号包住（否则 YAML 会坏）', out.split('\n')[1]);
  ok(/^category: 随笔$/m.test(out), '分类被替换');
  ok(/^tags: \[新标签\]$/m.test(out), '标签被替换成行内写法');
  ok(/^updated: \d{4}-\d{2}-\d{2}$/m.test(out), '服务器自己写上了 updated');
  ok(out.includes('# 这行注释要保留'), '★ 原文件里的注释被保留（不是整份重写）');
  ok(out.includes('coverStyle: wave'), '★ 没碰的字段原样保留');
  ok(out.includes('换掉后的正文'), '正文写进去了');
  ok(!out.includes('老标题'), '旧标题没了');
  ok(gh.calls.at(-1).message.includes('更新'), '提交信息是「更新」', gh.calls.at(-1).message);
  const dateLine = (out.match(/^date: (.+)$/m) || [])[1];
  ok(dateLine === '2024-06-02', '★ 发布日期没被改（改了链接就变了）', dateLine);
}

/* ---------- 4. 新建 ---------- */
console.log('=== 4. 新建一篇 ===');
{
  const r = await call('/admin/save', {
    ticket: 'good-ticket', title: '手机写的第一篇',
    body: '这是从手机后台写出来的正文，长度肯定超过二十个字啦。',
    category: '随笔', tags: ['手机', '测试'], draft: true,
  });
  ok(r.status === 200, '新建返回成功', JSON.stringify(r.data));
  const path = r.data?.path || '';
  ok(/^src\/content\/posts\/\d{4}-\d{2}-\d{2}-/.test(path), '路径以日期开头', path);
  ok(path.includes('手机写的第一篇'), '中文标题进了文件名（站点本来就支持中文 slug）', path);
  const out = gh.lastPutText || '';
  ok(out.includes('draft: true'), '草稿标记写进去了');
  ok(out.includes('private: false'), 'private 有默认值');
  ok(out.includes('pinned: false'), 'pinned 有默认值');
  ok(gh.calls.at(-1).message.includes('新建'), '提交信息是「新建」');
}

/* ---------- 5. 校验拦截 ---------- */
console.log('=== 5. 该拦的必须拦住 ===');
{
  const a = await call('/admin/save', { ticket: 'good-ticket', title: '', body: 'x'.repeat(50) });
  ok(a.status === 400, '空标题被拦', 'status=' + a.status);
  /* ★ 正文长度**不再设下限**（用户要求去掉）。这几条反过来盯着：短/空正文都必须能存 */
  const b = await call('/admin/save', { ticket: 'good-ticket', title: '很短的一篇', body: '嗯' });
  ok(b.status === 200, '★ 极短正文也能存（20 字底线已去掉）', 'status=' + b.status + ' ' + JSON.stringify(b.data).slice(0, 70));
  const b2 = await call('/admin/save', { ticket: 'good-ticket', title: '只有图片的一篇', body: '![](/uploads/x.jpg)' });
  ok(b2.status === 200, '★ 只放一张图（无文字）也能存', 'status=' + b2.status);
  const b3 = await call('/admin/save', { ticket: 'good-ticket', title: '真的空正文', body: '' });
  ok(b3.status === 200, '★ 空正文也能存（长度由作者自己决定）', 'status=' + b3.status);
  const c = await call('/admin/file', { ticket: 'good-ticket', path: '../../etc/passwd' });
  ok(c.status === 400, '路径穿越被拦', 'status=' + c.status);
  /* 第 3 组已经在 old.md 上保存过，这里再存一次应当成功（文件仍在） */
  const d = await call('/admin/save', { ticket: 'good-ticket', path: 'src/content/posts/old.md', title: '够长标题', body: '这是一段足够长的正文内容，用来通过站点那条二十个字的自检底线。' });
  ok(d.status === 200, '同名文件可以更新', JSON.stringify(d.data));
  /* 新建重名：第 4 组已经建过「手机写的第一篇」 */
  const e = await call('/admin/save', { ticket: 'good-ticket', title: '手机写的第一篇', body: '这是一段足够长的正文内容，用来通过站点那条二十个字的自检底线。' });
  ok(e.status === 409, '新建重名被拦（409）', 'status=' + e.status + ' ' + JSON.stringify(e.data));
  const f = await call('/admin/save', { ticket: 'good-ticket', title: '全新的一篇', body: '这是一段足够长的正文内容，用来通过站点那条二十个字的自检底线。' });
  ok(f.status === 200, '★ 新建（不带 path）不会被文件名校验误拦', 'status=' + f.status + ' ' + JSON.stringify(f.data));
}

/* ---------- 5.5 换行必须原样保留 ---------- */
console.log('=== 5.5 正文换行/空行一个都不能丢 ===');
{
  /*
   * 用户报「结尾的换行符被吞掉了」。这里把各种换行情况都写死成断言：
   * 结尾多个空行、行尾空格、连续空行、CRLF、只有换行符的正文……
   * 一旦哪一步（worker / 手机页 / Decap）又开始 trim，这里立刻红。
   */
  const cases = [
    ['结尾 3 个空行', '第一段。\n\n第二段。\n\n\n', /第二段。\n\n\n$/],
    ['结尾 1 个换行', '一整段文字，最后带一个换行。\n', /换行。\n$/],
    ['中间连续空行', '甲。\n\n\n\n乙。', /甲。\n\n\n\n乙。/],
    ['行尾有空格', '有行尾空格的一行   \n下一行。', /一行   \n下一行。/],
    ['CRLF 换行', '第一行。\r\n第二行。', /第一行。\n第二行。/],
    ['列表与缩进', '- 甲\n  - 甲一\n- 乙', /- 甲\n  - 甲一\n- 乙/],
  ];
  /* 长度底线已去掉，样本短也没关系；保留 PAD 只是让用例更像真实文章 */
  const PAD = '这是用来凑够二十个字自检底线的填充文字。';
  for (const [label, body, expect] of cases) {
    const sent = PAD + '\n\n' + body;
    const r = await call('/admin/save', { ticket: 'good-ticket', title: '换行测试 ' + label, body: sent, category: '随笔', tags: [] });
    if (r.status !== 200) { ok(false, label + ' 能保存', JSON.stringify(r.data)); continue; }
    const out = gh.lastPutText || '';
    const normalized = sent.replace(/\r\n/g, '\n');
    /*
     * 取正文别再靠数偏移（我数错过两回）：直接在提交内容里找正文的第一行，
     * 从那里切到结尾 —— 这样即使分隔符前后空行数变了也不会误判。
     */
    const anchor = normalized.slice(0, 8);
    const start = out.indexOf(anchor);
    const body2 = start < 0 ? '' : out.slice(start);
    const hit = expect.test(body2);
    ok(hit, label + ' 原样保留', hit ? '' : '实际=' + JSON.stringify(body2.slice(0, 80)));
    /* 更强的一条：除了 CRLF→LF 这一种规范化，正文必须与提交的一模一样 */
    ok(body2 === normalized, label + ' 与提交内容逐字符相同',
       body2 === normalized ? '' : '长度 ' + body2.length + ' vs ' + normalized.length + ' | 尾部=' + JSON.stringify(body2.slice(-8)));
  }
}

/* ---------- 5.7 正文里的 --- 不能把正文截断 ---------- */
console.log('=== 5.7 正文含 Markdown 分隔线（---）时不能吃掉正文 ===');
{
  /*
   * splitYaml 找 frontmatter 结束位置；如果正文里有 ---（Markdown 分隔线），
   * 实现不严谨就会把后面整段正文丢掉 —— 用户在手机上改一篇文章，正文直接少一半。
   * 目前的实现要求结束的 --- 后面必须跟换行，所以是安全的；
   * 这条测试留着，防止以后有人为了「宽松一点」把正则改坏。
   */
  const withRule = [
    '---',
    'title: 带分隔线的文章',
    'date: 2024-01-01',
    'category: 随笔',
    'tags: []',
    '',
    '---',
    '',
    '上半段的内容写在这里，长度足够通过站点的二十字自检。',
    '',
    '---',
    '',
    '下半段，分隔线之后的内容一个字都不能少。',
    '',
  ].join('\n');
  gh.files.set('src/content/posts/with-rule.md', { base64: Buffer.from(withRule, 'utf8').toString('base64'), sha: 's-rule' });

  const read = await call('/admin/file', { ticket: 'good-ticket', path: 'src/content/posts/with-rule.md' });
  ok(read.status === 200, '能读到这篇');
  ok(read.data?.body.includes('上半段'), '读到上半段');
  ok(read.data?.body.includes('下半段'), '★ 读到下半段（正文没被 --- 截断）', JSON.stringify(String(read.data?.body).slice(0, 60)));
  ok(read.data?.body.includes('---'), '★ 正文里的分隔线本身也保留着');

  /* 再保存一次，正文必须原样不变 */
  const save = await call('/admin/save', {
    ticket: 'good-ticket', path: 'src/content/posts/with-rule.md',
    title: '带分隔线的文章', body: read.data.body, category: '随笔', tags: [],
  });
  ok(save.status === 200, '保存成功', JSON.stringify(save.data).slice(0, 100));
  const out = gh.lastPutText || '';
  const bodyOut = out.slice(out.indexOf('\n---\n', 3) + 6);
  ok(bodyOut.includes('下半段'), '★ 保存后下半段还在');
  ok(bodyOut === read.data.body, '★ 正文往返一次完全不变', bodyOut === read.data.body ? '' : '长度 ' + bodyOut.length + ' vs ' + String(read.data.body).length);
}

/* ---------- 6. 删除 ---------- */
console.log('=== 6. 删除 ===');
{
  const r = await call('/admin/delete', { ticket: 'good-ticket', path: 'src/content/posts/old.md' });
  ok(r.status === 200, '删除成功');
  ok(!gh.files.has('src/content/posts/old.md'), '文件真的从（假）仓库里没了');
}

/* ---------- 7. 没配 token 时的提示 ---------- */
/* ---------- 6.5 图库（图片分类） ---------- */
console.log('=== 6.5 图库：列表 / 上传 / 归类 / 删除（分类存索引，文件平铺）===');
{
  /*
   * ★ 为什么文件是「平铺」而不是按分类放进子目录：
   * Decap 的媒体库（/admin 的「媒体」）只列 media_folder 根目录的文件 ——
   * 它的 getMedia() 调 listFiles(mediaFolder)，而 listFiles 默认 depth=1
   * 且过滤掉路径里含 '/' 的条目。放子目录里，用户在那边就永远看不到。
   * 所以：**文件平铺在 public/uploads 根目录**（Decap 看得到），
   * 分类记在 categories.json（图库照样按分类展示）。
   * 顺带好处：改分类只是改一行 JSON，不用搬文件 —— 也就不可能把图片搬坏。
   */
  const metaOf = () => JSON.parse(gh.files.get('public/uploads/categories.json')?.base64
    ? Buffer.from(gh.files.get('public/uploads/categories.json').base64, 'base64').toString('utf8')
    : '{}');

  /* 一张老图在子目录里（迁移期的形态），一张在根目录 */
  gh.files.set('public/uploads/old-pic.jpg', { base64: Buffer.from('OLD-IMAGE-BYTES').toString('base64'), sha: 's-old' });
  gh.files.set('public/uploads/表情包/meme-one.png', { base64: Buffer.from('MEME-BYTES').toString('base64'), sha: 's-meme' });
  gh.files.delete('public/uploads/categories.json');

  const list = await call('/admin/images', { ticket: 'good-ticket' });
  ok(list.status === 200, '列表能取到');
  const imgs = list.data?.images || [];
  ok(imgs.length === 2, '列出 2 张图', '实际 ' + imgs.length);
  const old = imgs.find((i) => i.name === 'old-pic.jpg');
  ok(old && old.dir === '', '根目录的图算「未分类」');
  ok(old && old.url === '/uploads/old-pic.jpg', 'URL 正确', old && old.url);
  const meme = imgs.find((i) => i.name === 'meme-one.png');
  ok(meme && meme.dir === '表情包', '★ 子目录里的老图仍按目录算分类（迁移期兼容）', JSON.stringify(meme));
  ok(!imgs.some((i) => i.name === 'categories.json'), '分类索引本身不会被当成图片列出来');

  /* 上传：文件必须落在根目录（这样 Decap 能看到） */
  const dataUrl = 'data:image/png;base64,' + Buffer.from('NEW-PNG').toString('base64');
  const up = await call('/admin/image/upload', { ticket: 'good-ticket', name: '我的 新图.png', dataUrl, dir: '封面' });
  ok(up.status === 200, '上传成功', JSON.stringify(up.data));
  ok(up.data?.path === 'public/uploads/我的_新图.png', '★ 文件平铺在根目录（不再进子目录）', up.data?.path);
  ok(up.data?.url === '/uploads/%E6%88%91%E7%9A%84_%E6%96%B0%E5%9B%BE.png' || decodeURIComponent(up.data?.url || '') === '/uploads/我的_新图.png', '返回可用的 URL', up.data?.url);
  ok(gh.files.has('public/uploads/我的_新图.png'), '文件写进了（假）仓库');
  ok(metaOf()['我的_新图.png'] === '封面', '★ 分类记进了索引文件', JSON.stringify(metaOf()));
  ok(gh.batchCommits === 1, '★ 图片与索引是同一次提交（不会出现「传上了但没归类」）', '实际 ' + gh.batchCommits);

  /* 格式与路径的拦截 */
  const bad1 = await call('/admin/image/upload', { ticket: 'good-ticket', name: 'x', dataUrl: 'data:text/plain;base64,aGk=' });
  ok(bad1.status === 400, '非图片格式被拦', 'status=' + bad1.status);
  const bad2 = await call('/admin/image/upload', { ticket: 'good-ticket', name: 'x', dataUrl: '不是 dataURL' });
  ok(bad2.status === 400, '乱填的数据被拦');

  /* 改分类：文件不动，只改索引 */
  const beforeBytes = gh.files.get('public/uploads/old-pic.jpg').base64;
  const mv = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/old-pic.jpg', dir: '电影截图' });
  ok(mv.status === 200, '归类成功', JSON.stringify(mv.data));
  ok(metaOf()['old-pic.jpg'] === '电影截图', '★ 索引里的分类改了', JSON.stringify(metaOf()));
  ok(gh.files.get('public/uploads/old-pic.jpg').base64 === beforeBytes, '★ 图片文件一个字节都没动（不用搬文件，也就搬不坏）');
  ok(gh.files.has('public/uploads/old-pic.jpg'), '路径没变（仍在根目录）');

  /* 移回未分类 */
  const mv2 = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/old-pic.jpg', dir: '' });
  ok(!metaOf()['old-pic.jpg'], '移回未分类后索引里的记录被清掉', JSON.stringify(metaOf()));

  /* 老图（子目录里）改分类时，顺手挪回根目录 —— 这样 Decap 也能看到它 */
  const legacyBytes = gh.files.get('public/uploads/表情包/meme-one.png').base64;
  const mv3 = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/表情包/meme-one.png', dir: '表情包' });
  ok(mv3.status === 200, '老图归类成功');
  ok(gh.files.has('public/uploads/meme-one.png'), '★ 老图被挪到了根目录（Decap 从此能看到）');
  ok(!gh.files.has('public/uploads/表情包/meme-one.png'), '旧的子目录路径已删除');
  ok(gh.files.get('public/uploads/meme-one.png').base64 === legacyBytes, '★ 搬运过程中字节完全相同');

  /* 路径校验 */
  const badPath = await call('/admin/image/move', { ticket: 'good-ticket', path: '../../etc/passwd', dir: 'x' });
  ok(badPath.status === 400, '越界路径被拦', 'status=' + badPath.status);
  const badPath2 = await call('/admin/image/delete', { ticket: 'good-ticket', path: 'src/content/posts/x.md' });
  ok(badPath2.status === 400, '只能删 uploads 下的图', 'status=' + badPath2.status);

  /* 删除：文件与索引记录一起清 */
  const del = await call('/admin/image/delete', { ticket: 'good-ticket', path: 'public/uploads/old-pic.jpg' });
  ok(del.status === 200, '删除成功');
  ok(!gh.files.has('public/uploads/old-pic.jpg'), '文件真的没了');
  ok(!metaOf()['old-pic.jpg'], '索引里那条也清掉了');

  /* ★ 二进制完整性：真实 PNG 走一遍归类 */
  {
    const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082';
    const png = Buffer.from(pngHex, 'hex');
    gh.files.set('public/uploads/真图.png', { base64: png.toString('base64'), sha: 's-real' });
    const mv4 = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/真图.png', dir: '测试分类' });
    ok(mv4.status === 200, '★ 真实 PNG 能归类');
    const after = Buffer.from(gh.files.get('public/uploads/真图.png').base64, 'base64');
    ok(after.equals(png), '★ 字节完全相同（PNG 没被当文本搞坏）');
    const list4 = await call('/admin/images', { ticket: 'good-ticket' });
    const still = (list4.data?.images || []).find((i) => i.name === '真图.png');
    ok(!!still && still.dir === '测试分类', '★ 归类后列表里仍能看到它，且分类正确', JSON.stringify(still));
  }

  /*
   * ★★★ 大图（> 1MB）：这是**真丢过图**的那一条，别再删掉 ★★★
   *
   * 事故经过：站主在手机图库里把 167155.jpg（14.8MB）改名成「若娜瓦-低眉.jpg」，
   * 结果仓库里那张图变成了 **0 字节**，文章引用还指向它 ——
   * 线上 404、图库里一直显示「还没构建好」。
   *
   * 根因：GitHub 的 **Contents API 对超过 1MB 的文件不返回 content**
   * （encoding: "none"、content: ""、size 是真的）。老代码把空串当内容，
   * 原样写回 → 0 字节覆盖。所有小图都正常，所以光看代码根本不觉得有问题。
   *
   * 桩现在照真 GitHub 的行为来（大文件不给内容），所以这一条能真的盯住它。
   */
  {
    const bigBytes = Buffer.alloc(1024 * 1024 + 4096, 0xab);
    bigBytes[0] = 0xff; bigBytes[1] = 0xd8;                 /* 假装是 JPEG */
    bigBytes[bigBytes.length - 2] = 0xff; bigBytes[bigBytes.length - 1] = 0xd9;
    gh.files.set('public/uploads/大图.jpg', { base64: bigBytes.toString('base64'), sha: 'sha-big' });
    gh.blobs = gh.blobs || new Map();
    gh.blobs.set('sha-big', bigBytes.toString('base64'));

    /* 先确认桩真的在模拟「大文件不给内容」——否则这条测试是空的 */
    /* 注意要走**桩**（globalThis.fetch 已被换掉），别用 realFetch 去连真 GitHub */
    const probe = await globalThis.fetch('https://api.github.com/repos/x/y/contents/public%2Fuploads%2F%E5%A4%A7%E5%9B%BE.jpg?ref=main');
    const pj = await probe.json();
    ok(pj.content === '' && pj.encoding === 'none' && pj.size === bigBytes.length,
      '桩确实在模拟真 GitHub：>1MB 的文件不返回内容（只给 size）', JSON.stringify({ content: pj.content, encoding: pj.encoding, size: pj.size }));

    const rnBig = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/大图.jpg', name: '大图-改名后' });
    ok(rnBig.status === 200, '大图改名成功', JSON.stringify(rnBig.data).slice(0, 120));
    const moved = gh.files.get('public/uploads/大图-改名后.jpg');
    ok(!!moved, '改名后的文件在仓库里');
    ok(moved && Buffer.from(moved.base64, 'base64').equals(bigBytes),
      '★★★ 大图内容逐字节保住了（不是 0 字节）——修的就是这条',
      moved ? '实际 ' + Buffer.from(moved.base64, 'base64').length + ' 字节' : '文件不在');
    ok(!gh.files.has('public/uploads/大图.jpg'), '旧名字下的文件已删除');
    const treeBig = (gh.lastTree && gh.lastTree.tree) || [];
    ok(treeBig.some((x) => x.path === 'public/uploads/大图-改名后.jpg' && x.sha !== null),
      '提交里写的是新路径（不是删除）', JSON.stringify(treeBig.map((x) => x.path)));

    /* 拿不到真实内容时宁可失败，也不许写空文件 */
    gh.files.set('public/uploads/坏图.jpg', { base64: bigBytes.toString('base64'), sha: 'sha-missing' });
    const badBig = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/坏图.jpg', name: '坏图-改名后' });
    ok(badBig.status >= 400, '★ 大文件读不到内容时**明确报错**，不静默写空文件', 'status=' + badBig.status + ' ' + JSON.stringify(badBig.data).slice(0, 80));
    ok(gh.files.has('public/uploads/坏图.jpg'), '★ 报错后原文件原封不动');
    ok(!gh.files.has('public/uploads/坏图-改名后.jpg'), '★ 没有生成一个空的新文件');

    /* 源文件真的不在仓库里（连 size 都没有）时，也要报「找不到」而不是写空的 */
    const gone = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/根本不存在.jpg', name: '随便' });
    ok(gone.status === 404, '★ 源文件不存在时报 404（不是写一个 0 字节的文件）', 'status=' + gone.status);
    ok(!gh.files.has('public/uploads/随便.jpg'), '★ 没写出任何文件');
  }
}

console.log('=== 6.6 重命名图片（连同文章引用一起改）===');
{
  const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082';
  const png = Buffer.from(pngHex, 'hex');
  const metaOf = () => JSON.parse(gh.files.get('public/uploads/categories.json')?.base64
    ? Buffer.from(gh.files.get('public/uploads/categories.json').base64, 'base64').toString('utf8')
    : '{}');

  /* 一张有分类、且**已经被文章引用**的图 */
  gh.files.set('public/uploads/1a2b3c4d5e6f.jpg', { base64: png.toString('base64'), sha: 's-old' });
  gh.files.set('public/uploads/categories.json', { base64: Buffer.from(JSON.stringify({ '1a2b3c4d5e6f.jpg': '芙芙' })).toString('base64'), sha: 's-meta' });
  gh.files.set('src/content/posts/2026-01-01-ref.md', {
    base64: Buffer.from('---\ntitle: 用了这张图\n---\n\n正文\n\n![](/uploads/1a2b3c4d5e6f.jpg)\n').toString('base64'),
    sha: 's-post',
  });
  gh.files.set('src/content/posts/2026-01-02-other.md', {
    base64: Buffer.from('---\ntitle: 别的文章\n---\n\n没引用那张图。\n').toString('base64'), sha: 's-post2',
  });

  const rn = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/1a2b3c4d5e6f.jpg', name: '芙芙-头像' });
  if (rn.status !== 200) console.log('   [调试] status=' + rn.status + ' 原始响应=' + JSON.stringify(rn.raw || rn).slice(0, 300));
  ok(rn.status === 200, '改名成功', JSON.stringify(rn.data));
  ok(rn.data?.name === '芙芙-头像.jpg', '★ 新名字带原后缀（中文也行）', rn.data?.name);
  ok(gh.files.has('public/uploads/芙芙-头像.jpg'), '文件已在新名下');
  ok(!gh.files.has('public/uploads/1a2b3c4d5e6f.jpg'), '旧名下的文件没了（是改名不是复制）');
  ok(Buffer.from(gh.files.get('public/uploads/芙芙-头像.jpg').base64, 'base64').equals(png), '★ 字节一字未改');
  const m = metaOf();
  ok(m['芙芙-头像.jpg'] === '芙芙' && !m['1a2b3c4d5e6f.jpg'], '★ 分类跟着改名走（索引键换了）', JSON.stringify(m));
  const post = Buffer.from(gh.files.get('src/content/posts/2026-01-01-ref.md').base64, 'base64').toString('utf8');
  ok(post.includes('/uploads/%E8%8A%99%E8%8A%99-%E5%A4%B4%E5%83%8F.jpg') || post.includes('/uploads/芙芙-头像.jpg'), '★ 文章里的引用被一起改了', post.split('\n').filter(Boolean).pop());
  ok(!post.includes('1a2b3c4d5e6f'), '旧路径在文章里已不存在');
  ok(rn.data?.refsUpdated === 1, '报告更新了 1 篇文章', String(rn.data?.refsUpdated));
  const other = Buffer.from(gh.files.get('src/content/posts/2026-01-02-other.md').base64, 'base64').toString('utf8');
  ok(other.includes('没引用那张图'), '没引用的文章一个字没动');

  /* 关掉「更新引用」时应保持文章原样 */
  gh.files.set('public/uploads/aaa.jpg', { base64: png.toString('base64'), sha: 's-a' });
  gh.files.set('src/content/posts/2026-01-01-ref.md', {
    base64: Buffer.from('---\ntitle: x\n---\n\n![](/uploads/aaa.jpg)\n').toString('base64'), sha: 's-post3',
  });
  const rn2 = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/aaa.jpg', name: 'bbb', updateRefs: false });
  ok(rn2.status === 200 && rn2.data?.refsUpdated === 0, '关掉更新引用时不碰文章', JSON.stringify(rn2.data));
  const post3 = Buffer.from(gh.files.get('src/content/posts/2026-01-01-ref.md').base64, 'base64').toString('utf8');
  ok(post3.includes('/uploads/aaa.jpg'), '文章里的旧引用保留（用户自己选的）');

  /* 拦截 */
  const dup = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/bbb.jpg', name: '芙芙-头像' });
  ok(dup.status === 409, '★ 目标重名时明确报错（不覆盖）', 'status=' + dup.status + ' ' + JSON.stringify(dup.data).slice(0, 60));
  const empty = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/bbb.jpg', name: '   ' });
  ok(empty.status === 400, '空名字被拦');
  const outside = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'src/content/posts/x.md', name: 'y' });
  ok(outside.status === 400, '只能改 uploads 下的图');
  const same = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/bbb.jpg', name: 'bbb.jpg' });
  ok(same.status === 200 && same.data?.note === '名字没变', '名字没变时直接返回（不产生空提交）');

  /*
   * ★ 缩略图必须跟着主图走。
   *
   * 站点是按「主图同名 .jpg」去 thumbs/ 里找缩略图的（见 worker 的 thumbPathFor）。
   * 改名/删除时如果不管缩略图：
   *   · 改名后站点找不到缩略图 → 退回显示原图（变慢），图库还会标「原图」角标；
   *   · 删除后 thumbs/ 里留下**孤儿**。
   * 这不是破图级别的错，所以肉眼很难发现 —— 必须由测试盯住。
   */
  const thumbBytes = Buffer.from('THUMB-FOR-RENAME');
  gh.files.set('public/uploads/有缩略图.jpg', { base64: png.toString('base64'), sha: 's-th' });
  gh.files.set('public/uploads/thumbs/有缩略图.jpg', { base64: thumbBytes.toString('base64'), sha: 's-thumb' });

  const rnTh = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/有缩略图.jpg', name: '改过名' });
  ok(rnTh.status === 200, '带缩略图的图能改名', JSON.stringify(rnTh.data));
  ok(gh.files.has('public/uploads/thumbs/改过名.jpg'), '★ 缩略图跟着搬到了新名字下');
  ok(!gh.files.has('public/uploads/thumbs/有缩略图.jpg'), '★ 旧名字下的缩略图已删除（不留孤儿）');
  ok(Buffer.from(gh.files.get('public/uploads/thumbs/改过名.jpg').base64, 'base64').equals(thumbBytes),
    '★ 缩略图内容逐字节没变（只是换了个名字）');
  ok(rnTh.data?.thumbMoved === true, '响应里说明缩略图也搬了', String(rnTh.data?.thumbMoved));

  /* 没有缩略图的图改名：不该凭空造一个 */
  gh.files.set('public/uploads/没缩略图.jpg', { base64: png.toString('base64'), sha: 's-noth' });
  const rnNo = await call('/admin/image/rename', { ticket: 'good-ticket', path: 'public/uploads/没缩略图.jpg', name: '没缩略图-改名' });
  ok(rnNo.status === 200 && rnNo.data?.thumbMoved === false, '没有缩略图时改名照样成功，且不凭空造一个', JSON.stringify(rnNo.data));
  ok(!gh.files.has('public/uploads/thumbs/没缩略图-改名.jpg'), '没有多出文件');

  /* 删除：主图 + 缩略图一起清 */
  const delTh = await call('/admin/image/delete', { ticket: 'good-ticket', path: 'public/uploads/改过名.jpg' });
  ok(delTh.status === 200 && delTh.data?.thumbRemoved === true, '删除时报告缩略图也清了', JSON.stringify(delTh.data));
  ok(!gh.files.has('public/uploads/改过名.jpg'), '主图没了');
  ok(!gh.files.has('public/uploads/thumbs/改过名.jpg'), '★ 缩略图也一起删了（不留孤儿）');
}

console.log('=== 6.7 批处理：一次提交改多张图 ===');
{
  /*
   * 批处理现在只改「分类索引」—— 文件本身不动（都在根目录）。
   * 关键断言：**N 张图 = 1 条提交**，且没选中的图与索引里的其它记录都不受影响。
   */
  const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082';
  const png = Buffer.from(pngHex, 'hex').toString('base64');
  const metaOf = () => JSON.parse(gh.files.get('public/uploads/categories.json')?.base64
    ? Buffer.from(gh.files.get('public/uploads/categories.json').base64, 'base64').toString('utf8')
    : '{}');

  for (const n of ['批一.png', '批二.png', '批三.png', '别动.png']) {
    gh.files.set('public/uploads/' + n, { base64: png, sha: 'b-' + n });
  }
  gh.files.set('public/uploads/categories.json', { base64: Buffer.from(JSON.stringify({ '别动.png': '原有的分类' })).toString('base64'), sha: 's-meta' });
  gh.batchCommits = 0;

  const mv = await call('/admin/images/batch', {
    ticket: 'good-ticket', action: 'move', dir: '批量测试',
    paths: ['public/uploads/批一.png', 'public/uploads/批二.png', 'public/uploads/批三.png'],
  });
  ok(mv.status === 200, '批量归类成功', JSON.stringify(mv.data));
  ok(mv.data?.count === 3, '报告改了 3 张的分类', String(mv.data?.count));
  ok(gh.batchCommits === 1, '★ 3 张图只产生 1 条提交', '实际 ' + gh.batchCommits);
  const metaAfter = metaOf();
  ok(metaAfter['批一.png'] === '批量测试' && metaAfter['批三.png'] === '批量测试', '★ 索引里三条都改了', JSON.stringify(metaAfter));
  ok(metaAfter['别动.png'] === '原有的分类', '★ 没选中的图，索引里的记录一点没动');
  ok(gh.files.has('public/uploads/批一.png'), '文件仍在根目录（批处理不搬文件）');

  /* 再看一次「发给 GitHub 的提交里到底改了什么」 */
  const treeItems = (gh.lastTree && gh.lastTree.tree) || [];
  const puts = treeItems.filter((x) => x.sha !== null).map((x) => x.path);
  const dels = treeItems.filter((x) => x.sha === null).map((x) => x.path);
  ok(puts.length === 1 && puts[0] === 'public/uploads/categories.json', '★ 提交里只写了一个文件（分类索引）', puts.join(', '));
  ok(dels.length === 0, '没有删除任何文件', dels.join(', '));
  ok(gh.lastTree && !!gh.lastTree.base_tree, '★ 用了 base_tree（没列出来的文件自动沿用）');
  ok(gh.lastCommit && gh.lastCommit.includes('批量归类') && gh.lastCommit.includes('批量测试'), '提交信息说清了改成哪个分类', gh.lastCommit);

  /* 批量归类到同一个分类时应该跳过（不产生无意义的提交） */
  gh.batchCommits = 0;
  const again = await call('/admin/images/batch', {
    ticket: 'good-ticket', action: 'move', dir: '批量测试',
    paths: ['public/uploads/批一.png', 'public/uploads/批二.png'],
  });
  ok(again.data?.count === 0 && gh.batchCommits === 0, '★ 已经是该分类的不重复提交', JSON.stringify(again.data));

  /* 批量删除：文件与索引记录一起清 */
  gh.batchCommits = 0;
  const del = await call('/admin/images/batch', {
    ticket: 'good-ticket', action: 'delete',
    paths: ['public/uploads/批一.png', 'public/uploads/别动.png'],
  });
  ok(del.status === 200, '批量删除成功');
  ok(gh.batchCommits === 1, '★ 删除两张也只提交一次', '实际 ' + gh.batchCommits);
  const afterDel = metaOf();
  ok(!afterDel['批一.png'] && !afterDel['别动.png'], '★ 索引里对应的记录也清掉了', JSON.stringify(afterDel));
  ok(afterDel['批二.png'] === '批量测试', '没选的仍在索引里');

  /* 拦截 */
  const empty = await call('/admin/images/batch', { ticket: 'good-ticket', action: 'delete', paths: [] });
  ok(empty.status === 400, '空选择被拦');
  const outside = await call('/admin/images/batch', { ticket: 'good-ticket', action: 'delete', paths: ['src/content/posts/x.md'] });
  ok(outside.status === 400, '越界路径被拦（只能动 uploads 下的）');
  const tooMany = await call('/admin/images/batch', { ticket: 'good-ticket', action: 'delete', paths: Array.from({ length: 61 }, (_, i) => 'public/uploads/x' + i + '.png') });
  ok(tooMany.status === 400, '超过 60 张被拦');
  const unknown = await call('/admin/images/batch', { ticket: 'good-ticket', action: '打人', paths: ['public/uploads/批二.png'] });
  ok(unknown.status === 400, '未知操作被拦');
}

console.log('=== 6.8 统一提交：攒一批改动，一次推到 GitHub ===');
{
  const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082';
  const png = Buffer.from(pngHex, 'hex');
  const metaOf = () => JSON.parse(gh.files.get('public/uploads/categories.json')?.base64
    ? Buffer.from(gh.files.get('public/uploads/categories.json').base64, 'base64').toString('utf8')
    : '{}');

  /* 三张图：一张改名、一张换分类、一张删除；外加一篇引用了第一张的文章 */
  for (const n of ['甲.jpg', '乙.jpg', '丙.jpg']) {
    gh.files.set('public/uploads/' + n, { base64: png.toString('base64'), sha: 's-' + n });
  }
  gh.files.set('public/uploads/categories.json', { base64: Buffer.from(JSON.stringify({ '甲.jpg': '旧分类' })).toString('base64'), sha: 's-meta' });
  gh.files.set('src/content/posts/2026-02-02-use.md', {
    base64: Buffer.from('---\ntitle: 用了甲\n---\n\n![](/uploads/甲.jpg)\n').toString('base64'), sha: 's-p',
  });
  gh.batchCommits = 0;

  const r = await call('/admin/images/commit', {
    ticket: 'good-ticket',
    ops: [
      { from: 'public/uploads/甲.jpg', to: 'public/uploads/甲-新名.jpg', dir: '新分类' },
      { from: 'public/uploads/乙.jpg', from2: null, dir: '另一类' },
      { from: 'public/uploads/丙.jpg', delete: true },
    ],
  });
  ok(r.status === 200, '批量提交成功', JSON.stringify(r.data));
  ok(gh.batchCommits === 1, '★ 三项改动只产生 1 条提交', '实际 ' + gh.batchCommits);
  ok(r.data?.moved === 1 && r.data?.deleted === 1, '报告里改名 1 / 删除 1', JSON.stringify(r.data));

  ok(gh.files.has('public/uploads/甲-新名.jpg') && !gh.files.has('public/uploads/甲.jpg'), '★ 改名生效（新名在、旧名没了）');
  ok(Buffer.from(gh.files.get('public/uploads/甲-新名.jpg').base64, 'base64').equals(png), '★ 字节一字未改');
  ok(!gh.files.has('public/uploads/丙.jpg'), '★ 删除生效');
  ok(gh.files.has('public/uploads/乙.jpg'), '只换分类的文件仍在原处（不搬）');

  const meta = metaOf();
  ok(meta['甲-新名.jpg'] === '新分类' && !meta['甲.jpg'], '★ 改名的分类跟着走', JSON.stringify(meta));
  ok(meta['乙.jpg'] === '另一类', '★ 换分类写进索引', JSON.stringify(meta));
  ok(!meta['丙.jpg'], '★ 删除的索引记录也清掉', JSON.stringify(meta));

  const post = Buffer.from(gh.files.get('src/content/posts/2026-02-02-use.md').base64, 'base64').toString('utf8');
  ok(post.includes('/uploads/甲-新名.jpg') || post.includes(encodeURIComponent('甲-新名')), '★ 文章引用一起改了', post.split('\n').filter(Boolean).pop());
  ok(r.data?.refsUpdated === 1, '报告更新了 1 篇引用', String(r.data?.refsUpdated));

  /* 提交里到底动了什么：只该有 2 个写入（新名 + 索引）+ 文章，删除 2 个 */
  const items = (gh.lastTree && gh.lastTree.tree) || [];
  const puts = items.filter((x) => x.sha !== null).map((x) => x.path);
  const dels = items.filter((x) => x.sha === null).map((x) => x.path);
  ok(!puts.includes('public/uploads/乙.jpg'), '没改文件的不进提交（只改索引）', puts.join(', '));
  ok(dels.includes('public/uploads/丙.jpg') && dels.includes('public/uploads/甲.jpg'), '两个旧路径被删除', dels.join(', '));

  /* 拦截 */
  const empty = await call('/admin/images/commit', { ticket: 'good-ticket', ops: [] });
  ok(empty.status === 400, '空队列被拦');
  const outside = await call('/admin/images/commit', { ticket: 'good-ticket', ops: [{ from: 'src/content/posts/x.md', dir: 'a' }] });
  ok(outside.status === 400, '越界路径被拦');
  const many = await call('/admin/images/commit', {
    ticket: 'good-ticket',
    ops: Array.from({ length: 81 }, (_, i) => ({ from: 'public/uploads/x' + i + '.png', dir: 'a' })),
  });
  ok(many.status === 400, '超过 80 项被拦');
  /* 改名撞车：整批拒绝，不能悄悄覆盖 */
  gh.files.set('public/uploads/撞.jpg', { base64: png.toString('base64'), sha: 's-z' });
  const clash = await call('/admin/images/commit', {
    ticket: 'good-ticket',
    ops: [{ from: 'public/uploads/乙.jpg', to: 'public/uploads/撞.jpg' }],
  });
  ok(clash.status === 409, '★ 改名撞上已有文件 → 整批拒绝（不覆盖）', 'status=' + clash.status);
  ok(gh.files.get('public/uploads/乙.jpg').base64 === png.toString('base64'), '被拒绝后原文件没被动过');
  /* 无实际改动时应直接返回，不产生空提交 */
  gh.batchCommits = 0;
  const noop = await call('/admin/images/commit', { ticket: 'good-ticket', ops: [{ from: 'public/uploads/乙.jpg' }] });
  ok(noop.status === 200 && noop.data?.applied === 0 && gh.batchCommits === 0, '★ 没有实际改动时不产生空提交', JSON.stringify(noop.data));
}

console.log('=== 6.9 后台搜索索引的构建与读取 ===');
{
  /*
   * 这一段是补一个真实的坑：/admin/reindex 里我调了 slugify 却没定义，
   * 一上线就报「slugify is not defined」。当时测试没覆盖这条路径。
   * 现在真的走一遍：从假仓库读文章 → 抽 frontmatter → 存 KV → 再读回来。
   */
  /*
   * 用函数生成三篇，别在同一个字符串上连续 replace ——
   * 上一版就是那么写的，其中一处把 'title: ' 前缀漏掉了，YAML 直接坏掉，
   * 表现成「标题解析不出来」，排查了好一会儿。
   */
  const mkPost = ({ title, date, isPrivate = false, isDraft = false }) => [
    '---',
    'title: ' + title,
    'date: ' + date,
    'category: 技术',
    'tags: [测试, 索引]',
    'summary: 用来验证索引',
    'private: ' + (isPrivate ? 'true' : 'false'),
    'draft: ' + (isDraft ? 'true' : 'false'),
    '---',
    '',
    '正文里有一句独一无二的话：紫色河马在打字。',
    '',
  ].join('\n');
  const put = (file, text) => gh.files.set(file, { base64: Buffer.from(text, 'utf8').toString('base64'), sha: 's-' + file });
  put('src/content/posts/2024-03-03-index-test.md', mkPost({ title: '索引测试文章', date: '2024-03-03' }));
  put('src/content/posts/2024-03-04-hidden.md', mkPost({ title: '隐藏的索引文章', date: '2024-03-04', isPrivate: true }));
  put('src/content/posts/2024-03-05-draft.md', mkPost({ title: '草稿也进索引', date: '2024-03-05', isDraft: true }));

  const re = await call('/admin/reindex', { ticket: 'good-ticket' });
  ok(re.status === 200, '★ 重建索引成功（不会再报 slugify is not defined）', JSON.stringify(re.data).slice(0, 140));
  ok(re.data?.count >= 3, '索引里有至少 3 篇', String(re.data?.count));

  const idx = await call('/admin/posts-index', { ticket: 'good-ticket' });
  ok(idx.status === 200, '能读回索引');
  const list = idx.data?.posts || [];
  const hit = list.find((p) => p.title === '索引测试文章');
  ok(!!hit, '索引里有那篇测试文章');
  if (hit) {
    ok(hit.slug === '2024-03-03-index-test', '★ slug 算对了（slugify 生效）', hit.slug);
    ok(hit.category === '技术', '分类解析对了');
    ok(JSON.stringify(hit.tags) === JSON.stringify(['测试', '索引']), '标签解析对了');
    ok(String(hit.text).includes('紫色河马'), '★ 索引里带了正文（搜索要用）');
    ok(hit.draft === false && hit.hidden === false, '状态标记对');
  }
  const h2 = list.find((p) => p.title === '隐藏的索引文章');
  ok(h2 && h2.hidden === true, '隐藏文章被标成 hidden');
  const d2 = list.find((p) => p.title === '草稿也进索引');
  if (!d2) {
    console.log('   [调试] 索引里的标题: ' + JSON.stringify(list.map((p) => p.title)));
  }
  ok(d2 && d2.draft === true, '草稿也进索引（后台要能看到）', d2 ? 'draft=' + d2.draft : '标题都没找到');
  ok(list.find((p) => p.title === '索引测试文章')?.category === '技术', '（对照）三篇都进了索引');
  /* 索引必须存 KV，不能落公开文件 */
  ok(kvStore.has('posts:index'), '★ 索引存进了 KV（不是公开文件）');
}

console.log('=== 7. 服务端没配 GITHUB_TOKEN 时要给清楚提示 ===');
{
  const saved = env.GITHUB_TOKEN;
  env.GITHUB_TOKEN = '';
  const r = await call('/admin/posts', { ticket: 'good-ticket' });
  ok(r.status === 500 && /GITHUB_TOKEN/.test(r.data?.message || ''), '提示里点名了缺哪个 secret', r.data?.message);
  env.GITHUB_TOKEN = saved;
}

console.log('=== 6.95 文章增删改日志（新增 / 修改 / 删除，永久保留）===');
{
  /*
   * 站主要的是「谁在什么时候动了哪篇文章」，所以每条必须有：动作、标题、链接、IP。
   * 三条硬要求，各自钉一条断言：
   *   ① 只记增删改，不记浏览
   *   ② **永久保留** —— put 时绝不能带 expirationTtl（访问日志才有 90 天 TTL）
   *   ③ 删除的文章没有链接（文章都没了，链接点了是 404）
   */
  for (const k of [...kvStore.keys()]) if (k.startsWith('plog:')) kvStore.delete(k);
  for (const k of [...kvOpts.keys()]) if (k.startsWith('plog:')) kvOpts.delete(k);
  const put = (file, text) => gh.files.set(file, { base64: Buffer.from(text, 'utf8').toString('base64'), sha: 's-' + file });
  const mk = (title) => ['---', 'title: ' + title, 'date: 2024-05-05', 'category: 随笔', 'tags: []', '---', '', '正文。', ''].join('\n');

  /* ① 新增 */
  const add = await callAs('/admin/save', { ticket: 'good-ticket', title: '日志里的新文章', body: '正文。' });
  ok(add.status === 200, '新增一篇成功', JSON.stringify(add.data));
  const addUrl = add.data?.url || '';

  /* ② 修改（顺带验「改之前的标题」也记进去了） */
  put('src/content/posts/2024-05-05-log-old.md', mk('日志里的老标题'));
  const mod = await callAs('/admin/save', {
    ticket: 'good-ticket', path: 'src/content/posts/2024-05-05-log-old.md', title: '日志里的新标题', body: '正文。',
  });
  ok(mod.status === 200, '修改一篇成功');

  /* ③ 删除 */
  put('src/content/posts/2024-05-05-log-del.md', mk('要被删掉的文章'));
  const del = await callAs('/admin/delete', { ticket: 'good-ticket', path: 'src/content/posts/2024-05-05-log-del.md' });
  ok(del.status === 200, '删除一篇成功');

  /* 读取（真的走 KV list，桩支持 prefix） */
  const logs = await get('/admin/post-logs', 'logs-token');
  ok(logs.status === 200, '文章日志能读出来', JSON.stringify(logs.data).slice(0, 120));
  const rows = logs.data?.logs || [];
  ok(rows.length === 3, '三条动作各记了一条', '实际 ' + rows.length);
  const byAction = {};
  for (const r of rows) byAction[r.action] = r;
  ok(!!byAction['新增'], '记了「新增」');
  ok(!!byAction['修改'], '记了「修改」');
  ok(!!byAction['删除'], '记了「删除」');
  ok(byAction['新增']?.title === '日志里的新文章', '新增那条记的是文章标题', JSON.stringify(byAction['新增']));
  ok(byAction['修改']?.title === '日志里的新标题', '修改那条记的是新标题');
  ok(byAction['修改']?.was === '日志里的老标题', '★ 改标题时也记下了原来的标题（能看出「从什么改成什么」）', JSON.stringify(byAction['修改']));
  ok(!byAction['新增']?.was, '标题没变时不写多余的字段');
  ok(!!byAction['新增']?.url && byAction['新增'].url === addUrl, '新增那条带了可点开的链接', String(byAction['新增']?.url));
  ok(!!byAction['修改']?.url, '修改那条带了链接');
  ok(!byAction['删除']?.url, '★ 删除那条没有链接（文章已经不在了）', String(byAction['删除']?.url));
  ok(rows.every((r) => r.ip === IP), '★ 每条都记了访客 IP', JSON.stringify(rows.map((r) => r.ip)));
  ok(rows.every((r) => typeof r.atLocal === 'string' && r.atLocal.includes('+08:00')), '时间按 +08:00 记');

  /* ★ 永久保留：plog 的每一个键都不能带 expirationTtl */
  const plogKeys = [...kvOpts.keys()].filter((k) => k.startsWith('plog:'));
  ok(plogKeys.length >= 4, 'plog 键写进去了（3 条流水 + 1 份近期缓存）', '实际 ' + plogKeys.length);
  ok(plogKeys.every((k) => !kvOpts.get(k)?.expirationTtl), '★ 文章日志没有 TTL（永久保留，和访问日志的 90 天区分开）',
    JSON.stringify(plogKeys.map((k) => k + '→' + JSON.stringify(kvOpts.get(k)))));

  /* 访问日志（走的是另一条路）保持原样，别被顺手改了 */
  kvStore.set('log:x', JSON.stringify({ id: 'x', at: '2024-01-01T00:00:00.000Z', ok: true }));
  const visit = await get('/hidden/logs', 'logs-token');
  ok(visit.status === 200 && (visit.data?.logs || []).length === 1, '访问日志仍然读得到（两条路互不影响）');

  /* 只显示最新的一部分：窗口过滤 + 条数上限 */
  const limited = await get('/admin/post-logs?days=1&limit=2', 'logs-token');
  ok(limited.status === 200 && (limited.data?.logs || []).length === 2, '★ 默认窗口只回最近的 N 条（不会一次全渲染）',
    JSON.stringify(limited.data).slice(0, 120));
  const all = await get('/admin/post-logs?all=1', 'logs-token');
  ok(all.status === 200 && (all.data?.logs || []).length === 3, '「全部历史」把 3 条都读出来');
  ok((all.data?.logs || []).every((r) => r.action !== undefined), '全部历史里没有混进访问日志');

  /* 口令校验 */
  const noTok = await get('/admin/post-logs');
  ok(noTok.status === 401, '不带口令读日志被拒（401）', 'status=' + noTok.status);
  /* 口令必须是 ASCII —— HTTP 头装不下中文（写成中文会直接抛 ByteString 错，测不成） */
  const wrong = await get('/admin/post-logs', 'wrong-token');
  ok(wrong.status === 401, '错口令读日志被拒（401）', 'status=' + wrong.status);
}

console.log('=== 6.97 上传时带缩略图 ===');
{
  /*
   * 缺口：tools/make-thumbs.mjs 是离线跑的，只覆盖当时已经在仓库里的图。
   * 新上传的图要等谁手动跑一次才有缩略图 —— 在那之前站点按原图显示。
   * 现在上传时就把缩略图一起传，服务端写进 public/uploads/thumbs/，
   * 而且必须**和主图在同一次提交里**（否则会留下「有图没缩略图」的中间态）。
   */
  gh.files.delete('public/uploads/categories.json');
  gh.files.delete('public/uploads/thumbs/带缩略图的图.jpg');
  gh.batchCommits = 0;

  const main = 'data:image/png;base64,' + Buffer.from('MAIN-IMAGE').toString('base64');
  const thumb = 'data:image/jpeg;base64,' + Buffer.from('THUMB-JPEG').toString('base64');
  const up = await call('/admin/image/upload', {
    ticket: 'good-ticket', name: '带缩略图的图.png', dataUrl: main, thumbDataUrl: thumb, dir: '测试',
  });
  ok(up.status === 200, '带缩略图的上传成功', JSON.stringify(up.data));
  ok(gh.files.has('public/uploads/带缩略图的图.png'), '主图写进了仓库');
  ok(gh.files.has('public/uploads/thumbs/带缩略图的图.jpg'), '★ 缩略图写进了 thumbs/（同名 .jpg）', up.data?.thumb);
  ok(up.data?.thumb === 'public/uploads/thumbs/带缩略图的图.jpg', '响应里回了缩略图路径', up.data?.thumb);
  ok(Buffer.from(gh.files.get('public/uploads/thumbs/带缩略图的图.jpg').base64, 'base64').toString('utf8') === 'THUMB-JPEG',
    '★ 缩略图内容逐字节一致（没被当文本搞坏）');
  ok(gh.batchCommits === 1, '★ 主图 + 缩略图 + 索引是同一次提交', '实际 ' + gh.batchCommits);
  const items = (gh.lastTree && gh.lastTree.tree) || [];
  const paths = items.map((x) => x.path);
  ok(paths.includes('public/uploads/带缩略图的图.png') && paths.includes('public/uploads/thumbs/带缩略图的图.jpg'),
    '★ 提交里同时有主图和缩略图', paths.join(', '));

  /* 列表要能告诉界面「哪张还没有缩略图」（老图那个角标就靠它） */
  const l1 = await call('/admin/images', { ticket: 'good-ticket' });
  const one = (l1.data?.images || []).find((i) => i.name === '带缩略图的图.png');
  ok(one && one.hasThumb === true, '★ 列表里标出这张已经有缩略图', JSON.stringify(one));
  ok(!(l1.data?.images || []).some((i) => i.name.endsWith('.jpg') && i.path.includes('/thumbs/')),
    '★ 缩略图不会被当成一张「图片」列出来');

  /* 老图（没有缩略图）应当是 false */
  gh.files.set('public/uploads/没有缩略图的老图.png', { base64: Buffer.from('OLD').toString('base64'), sha: 's-old2' });
  const l2 = await call('/admin/images', { ticket: 'good-ticket' });
  const oldOne = (l2.data?.images || []).find((i) => i.name === '没有缩略图的老图.png');
  ok(oldOne && oldOne.hasThumb === false, '★ 没有缩略图的老图标成 false', JSON.stringify(oldOne));

  /* 不带缩略图照样能传（老客户端 / 小图 / gif）—— 不让它失败 */
  const up2 = await call('/admin/image/upload', { ticket: 'good-ticket', name: '没有缩略图.png', dataUrl: main });
  ok(up2.status === 200 && !up2.data?.thumb, '不带缩略图时上传照样成功（thumb 为空）', JSON.stringify(up2.data));
  ok(gh.files.has('public/uploads/没有缩略图.png'), '主图仍然写进去了');

  /* 缩略图格式不对：忽略它，但不能连累主图 */
  const up3 = await call('/admin/image/upload', {
    ticket: 'good-ticket', name: '格式不对.png', dataUrl: main, thumbDataUrl: 'data:image/png;base64,AAAA',
  });
  ok(up3.status === 200 && !up3.data?.thumb, '★ 缩略图不是 JPEG 时忽略它，主图照样上传', JSON.stringify(up3.data));
  ok(!gh.files.has('public/uploads/thumbs/格式不对.jpg'), '没有把非法缩略图写进仓库');

  /* 重名时主图会加时间戳后缀，缩略图必须跟着改名 —— 否则站点找不到它 */
  const up4 = await call('/admin/image/upload', {
    ticket: 'good-ticket', name: '重名.png', dataUrl: main, thumbDataUrl: thumb,
  });
  const up5 = await call('/admin/image/upload', {
    ticket: 'good-ticket', name: '重名.png', dataUrl: main, thumbDataUrl: thumb,
  });
  ok(up5.status === 200 && up5.data?.path !== up4.data?.path, '重名时主图换了名字', up5.data?.path);
  const t5 = String(up5.data?.thumb || '');
  ok(t5.endsWith('.jpg') && t5.includes(up5.data.path.split('/').pop().replace(/\.png$/, '')),
    '★ 缩略图跟着主图的新名字走（站点按同名找得到）', up5.data?.path + ' → ' + t5);
  ok(gh.files.has(up5.data.path) && gh.files.has(t5), '两张都写进了仓库');
}

console.log('');
if (failed) { console.log('Worker 写作接口检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('Worker 写作接口检查通过 ✓  提交内容、路径、保留字段、校验与错误提示都对');
