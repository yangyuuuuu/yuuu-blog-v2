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

  /* 图库列表走的是 git/trees 接口（递归列出 uploads 下所有文件） */
  const treeMatch = /\/git\/trees\/[^/]+:([^?]+)/.exec(url);
  if (treeMatch) {
    const dir = decodeURIComponent(treeMatch[1]);
    gh.calls.push({ method, path: 'tree:' + dir, body: null, message: '' });
    const tree = [...gh.files.entries()]
      .filter(([k]) => k.startsWith(dir + '/'))
      .map(([k, v], i) => ({ path: k.slice(dir.length + 1), type: 'blob', size: Buffer.from(v.base64, 'base64').length, sha: 'blob' + i }));
    return new Response(JSON.stringify({ sha: 't', truncated: false, tree }), { status: 200 });
  }
  /* /git/blobs 上传二进制 */
  if (/\/git\/blobs$/.test(url) && method === 'POST') {
    const b = JSON.parse(init.body);
    const text = Buffer.from(String(b.content).replace(/\n/g, ''), 'base64').toString('base64');
    const sha = 'blob-' + Math.random().toString(36).slice(2, 8);
    gh.blobs = gh.blobs || new Map();
    gh.blobs.set(sha, String(b.content));
    gh.calls.push({ method, path: 'blob', body: b, message: '' });
    return new Response(JSON.stringify({ sha }), { status: 201 });
  }

  const path = decodeURIComponent(url.split('/contents/')[1]?.split('?')[0] || '');
  gh.calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, message: init.body ? JSON.parse(init.body).message : '' });

  if (method === 'GET') {
    const f = gh.files.get(path);
    if (!f) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    /*
     * 假的 GitHub 和真的行为一致：content 永远是 **base64**，
     * 不做 UTF-8 解码。之前这里把内容解码成文本再编码回去，
     * 于是「二进制损坏」这一类 bug 全被掩盖了 —— 图库那次就是这么漏过去的。
     */
    return new Response(JSON.stringify({
      sha: f.sha, path,
      content: f.base64 + '\n',
      encoding: 'base64',
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
  /* 站点有 20 字底线，样本前面补一段够长的固定文字（不影响要验的结尾/中间部分） */
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
console.log('=== 6.5 图库：列表 / 上传 / 归类 / 删除 ===');
{
  /* 造两张图：一张在根目录（老图，算「未分类」），一张已经在分类目录里 */
  gh.files.set('public/uploads/old-pic.jpg', { base64: Buffer.from('OLD-IMAGE-BYTES').toString('base64'), sha: 's-old' });
  gh.files.set('public/uploads/表情包/meme-one.png', { base64: Buffer.from('MEME-BYTES').toString('base64'), sha: 's-meme' });

  const list = await call('/admin/images', { ticket: 'good-ticket' });
  ok(list.status === 200, '列表能取到', JSON.stringify(list.data).slice(0, 120));
  const imgs = list.data?.images || [];
  ok(imgs.length === 2, '列出 2 张图', '实际 ' + imgs.length);
  const old = imgs.find((i) => i.name === 'old-pic.jpg');
  ok(old && old.dir === '', '根目录的老图算「未分类」（dir 为空）', JSON.stringify(old));
  ok(old && old.url === '/uploads/old-pic.jpg', '未分类图的 URL 正确', old && old.url);
  const meme = imgs.find((i) => i.name === 'meme-one.png');
  ok(meme && meme.dir === '表情包', '分类目录里的图带上了分类名', JSON.stringify(meme));
  ok(meme && decodeURIComponent(meme.url) === '/uploads/表情包/meme-one.png', '★ 中文分类的 URL 做了编码', meme && meme.url);
  ok(JSON.stringify(list.data?.dirs) === JSON.stringify(['表情包']), '分类列表里去掉了「未分类」', JSON.stringify(list.data?.dirs));

  /* 上传 */
  const dataUrl = 'data:image/png;base64,' + Buffer.from('NEW-PNG').toString('base64');
  const up = await call('/admin/image/upload', { ticket: 'good-ticket', name: '我的 新图.png', dataUrl, dir: '封面' });
  ok(up.status === 200, '上传成功', JSON.stringify(up.data));
  ok(up.data?.path === 'public/uploads/封面/我的_新图.png', '★ 文件名净化 + 归到指定分类', up.data?.path);
  ok(decodeURIComponent(up.data?.url || '') === '/uploads/封面/我的_新图.png', '上传返回可用的 URL');
  ok(gh.files.has('public/uploads/封面/我的_新图.png'), '文件真的写进（假）仓库了');

  /* 格式与路径的拦截 */
  const bad1 = await call('/admin/image/upload', { ticket: 'good-ticket', name: 'x', dataUrl: 'data:text/plain;base64,aGk=' });
  ok(bad1.status === 400, '非图片格式被拦', 'status=' + bad1.status);
  const bad2 = await call('/admin/image/upload', { ticket: 'good-ticket', name: 'x', dataUrl: '不是 dataURL' });
  ok(bad2.status === 400, '乱填的数据被拦');

  /* ★ 二进制完整性：真实的一张小 PNG（不是 base64 文本）走一遍「归类」 */
  {
    /* 一个最小的合法 PNG（1x1 透明），字节里含 0x00 / 0xFF / 0x89 这类非文本字节 */
    const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082';
    const pngBuf = Buffer.from(pngHex, 'hex');
    const pngB64 = pngBuf.toString('base64');
    gh.files.set('public/uploads/真图.png', { base64: pngB64, sha: 's-real' });

    const before = Buffer.from(gh.files.get('public/uploads/真图.png').base64, 'base64');
    const mv = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/真图.png', dir: '测试分类' });
    ok(mv.status === 200, '★ 真实 PNG 能归类', JSON.stringify(mv.data));
    const moved = gh.files.get('public/uploads/测试分类/真图.png');
    ok(!!moved, '★ 归类后文件还在（没丢）');
    if (moved) {
      const after = Buffer.from(moved.base64, 'base64');
      ok(after.length === before.length, '★ 字节数一致', after.length + ' vs ' + before.length);
      ok(after.equals(before), '★ 字节完全相同（PNG 没被当文本搞坏）', after.equals(before) ? '' : '前 8 字节 ' + after.slice(0, 8).toString('hex') + ' vs ' + before.slice(0, 8).toString('hex'));
    }
    /* 归类之后列表里必须还能看到它 */
    const list2 = await call('/admin/images', { ticket: 'good-ticket' });
    const still = (list2.data?.images || []).find((i) => i.name === '真图.png');
    ok(!!still && still.dir === '测试分类', '★ 归类后列表里仍然能看到它', JSON.stringify(still));
  }

  /* 归类：把未分类的 old-pic.jpg 挪进「电影截图」 */
  const before = gh.files.get('public/uploads/old-pic.jpg')?.base64;
  const mv = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/old-pic.jpg', dir: '电影截图' });
  ok(mv.status === 200, '归类成功', JSON.stringify(mv.data));
  ok(mv.data?.path === 'public/uploads/电影截图/old-pic.jpg', '新路径正确', mv.data?.path);
  ok(!gh.files.has('public/uploads/old-pic.jpg'), '旧路径已删除（真正移走，不是复制两份）');
  const after = gh.files.get('public/uploads/电影截图/old-pic.jpg')?.base64;
  ok(after === before, '★ 图片内容一字未改（base64 原样搬运）');

  /* 移回未分类 */
  const mv2 = await call('/admin/image/move', { ticket: 'good-ticket', path: 'public/uploads/电影截图/old-pic.jpg', dir: '' });
  ok(mv2.data?.path === 'public/uploads/old-pic.jpg', '能移回「未分类」', mv2.data?.path);

  /* 路径校验 */
  const badPath = await call('/admin/image/move', { ticket: 'good-ticket', path: '../../etc/passwd', dir: 'x' });
  ok(badPath.status === 400, '越界路径被拦', 'status=' + badPath.status);
  const badPath2 = await call('/admin/image/delete', { ticket: 'good-ticket', path: 'src/content/posts/x.md' });
  ok(badPath2.status === 400, '只能删 uploads 下的图', 'status=' + badPath2.status);

  /* 删除 */
  const del = await call('/admin/image/delete', { ticket: 'good-ticket', path: 'public/uploads/old-pic.jpg' });
  ok(del.status === 200, '删除成功');
  ok(!gh.files.has('public/uploads/old-pic.jpg'), '文件真的没了');
}

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
