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
const env = {
  GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y',
  HIDDEN_PASSWORD: 'pw',
  GITHUB_TOKEN: 'ghp_fake',
  LOGS: {
    get: async (k) => (kvStore.has(k) ? kvStore.get(k) : null),
    put: async (k, v) => { kvStore.set(k, v); },
    delete: async (k) => { kvStore.delete(k); },
    list: async () => ({ keys: [] }),
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

  const path = decodeURIComponent(url.split('/contents/')[1]?.split('?')[0] || '');
  gh.calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, message: init.body ? JSON.parse(init.body).message : '' });

  if (method === 'GET') {
    const f = gh.files.get(path);
    if (!f) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({
      sha: f.sha, path,
      content: Buffer.from(f.text, 'utf8').toString('base64'),
      encoding: 'base64',
    }), { status: 200 });
  }
  if (method === 'PUT') {
    const text = Buffer.from(gh.calls.at(-1).body.content, 'base64').toString('utf8');
    gh.files.set(path, { text, sha: 'sha-' + (gh.files.size + 1) });
    gh.lastPutText = text;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (method === 'DELETE') { gh.files.delete(path); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  return new Response('{}', { status: 200 });
};

const worker = (await import('../workers/oauth/src/index.ts')).default;
const call = async (path, body) => {
  const res = await worker.fetch(new Request('https://oauth.yuuu.love' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://yuuu.love' },
    body: JSON.stringify(body),
  }), env);
  let data = null;
  try { data = await res.json(); } catch { /* 可能不是 json */ }
  return { status: res.status, data };
};

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
  gh.files.set('src/content/posts/old.md', { text: OLD, sha: 'sha-old' });
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
  const b = await call('/admin/save', { ticket: 'good-ticket', title: '够长标题', body: '太短' });
  ok(b.status === 400, '正文太短被拦（站点自检底线是 20 字）', 'status=' + b.status);
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

/* ---------- 6. 删除 ---------- */
console.log('=== 6. 删除 ===');
{
  const r = await call('/admin/delete', { ticket: 'good-ticket', path: 'src/content/posts/old.md' });
  ok(r.status === 200, '删除成功');
  ok(!gh.files.has('src/content/posts/old.md'), '文件真的从（假）仓库里没了');
}

/* ---------- 7. 没配 token 时的提示 ---------- */
console.log('=== 7. 服务端没配 GITHUB_TOKEN 时要给清楚提示 ===');
{
  const saved = env.GITHUB_TOKEN;
  env.GITHUB_TOKEN = '';
  const r = await call('/admin/posts', { ticket: 'good-ticket' });
  ok(r.status === 500 && /GITHUB_TOKEN/.test(r.data?.message || ''), '提示里点名了缺哪个 secret', r.data?.message);
  env.GITHUB_TOKEN = saved;
}

console.log('');
if (failed) { console.log('Worker 写作接口检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('Worker 写作接口检查通过 ✓  提交内容、路径、保留字段、校验与错误提示都对');
