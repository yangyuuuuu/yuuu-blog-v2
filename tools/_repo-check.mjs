/* 直接问 GitHub：uploads 下现在有哪些文件（只读，用 Worker 的同一套接口） */
const r = await fetch('https://oauth.yuuu.love/admin/whoami', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
console.log('worker 自检:', JSON.stringify(await r.json()).slice(0, 120));

/* 用 GitHub 公开 API 列 uploads（公开仓库不需要 token） */
const res = await fetch('https://api.github.com/repos/yangyuuuuu/yuuu-blog-v2/git/trees/main:public/uploads?recursive=1');
console.log('GitHub trees 状态:', res.status);
const j = await res.json();
if (!j.tree) { console.log(JSON.stringify(j).slice(0, 300)); process.exit(0); }
console.log('uploads 下共 ' + j.tree.length + ' 个条目：');
for (const e of j.tree) console.log('  [' + e.type + '] ' + e.path + (e.size ? '  ' + e.size + ' 字节' : ''));
