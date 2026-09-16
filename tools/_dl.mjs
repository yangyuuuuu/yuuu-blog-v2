import { writeFileSync } from 'node:fs';
for (const v of ['0.212.2', '0.213.2']) {
  const r = await fetch('https://cdn.jsdelivr.net/npm/@sveltia/cms@' + v + '/dist/sveltia-cms.mjs');
  const c = await r.text();
  writeFileSync('probe-cms-' + v + '.mjs', c);
  console.log(v, c.length, 'bytes');
}