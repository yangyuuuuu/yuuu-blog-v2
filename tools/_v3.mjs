const bust = '?x=' + Date.now();
const get = async (p) => { const r = await fetch('https://yuuu.love' + p + bust); return { s: r.status, t: await r.text() }; };
const target = '/posts/2026-09-19-%E6%9B%B4%E8%A1%A3%E4%BA%BA%E5%81%B6%E5%9D%A0%E5%85%A5%E7%88%B1%E6%B2%B3/';
for (let i = 1; i <= 8; i++) {
  const a = await get(target);
  const all = await (await fetch('https://yuuu.love/private/posts-all.json' + bust)).json();
  const hit = all.posts.find((p) => String(p.title).includes('更衣人偶'));
  console.log('第 ' + i + ' 次: 文章=' + a.s + ' | 清单=' + all.count + ' 篇 | 清单里有它: ' + (hit ? hit.category + ' / hidden=' + hit.hidden : '没有'));
  if (a.s === 200 && hit) break;
  await new Promise((r) => setTimeout(r, 12000));
}
console.log('=== 归档页与标签页（安利分类第一次出现）===');
for (const p of ['/archive/', '/tags/', '/tags/%E5%AE%89%E5%88%A9/']) console.log('  ' + decodeURIComponent(p).padEnd(22) + (await get(p)).s);
const arch = await get('/archive/');
console.log('  归档页含「更衣人偶」: ' + arch.t.includes('更衣人偶'));
