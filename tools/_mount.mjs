import { writeFileSync } from 'node:fs';
const r = await fetch('https://cdn.jsdelivr.net/npm/@sveltia/cms@0.213.2/dist/sveltia-cms.mjs');
const c = await r.text();
writeFileSync('probe-cms.mjs', c);
console.log('已下载', c.length, '字节');
const show = (i, b = 200, a = 300) => console.log(JSON.stringify(c.slice(Math.max(0, i - b), i + a)));
for (const key of ['createApp', 'mount(', 'getElementById']) {
  let i = -1, n = 0;
  while ((i = c.indexOf(key, i + 1)) >= 0 && n < 2) { n++; console.log('--- ' + key + ' @' + i + ' ---'); show(i); }
}