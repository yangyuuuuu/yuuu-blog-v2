const b = '?x=' + Date.now();
const get = async (p) => { const r = await fetch('https://yuuu.love' + p + b); return { s: r.status, t: await r.text() }; };
console.log('=== 线上隐藏清单的字段 ===');
const pv = await (await fetch('https://yuuu.love/private/posts.json' + b)).json();
pv.posts.forEach((p) => console.log('  slug=' + JSON.stringify(p.slug) + '  url=' + p.url));
console.log('=== 逐个点开（日记页用的就是这些链接）===');
for (const p of pv.posts) {
  const r = await fetch('https://yuuu.love' + (p.url || '/posts/' + encodeURIComponent(p.slug) + '/') + b);
  console.log('  ' + r.status + '  ' + decodeURIComponent(p.url));
}
console.log('=== 日记页本身 ===');
console.log('  /diary/ → ' + (await get('/diary/')).s);
