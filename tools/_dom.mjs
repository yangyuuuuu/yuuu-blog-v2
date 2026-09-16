import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const local = readFileSync('public/admin/sveltia-cms.mjs');
console.log('本地文件大小:', local.length);
console.log('本地 sha256:', createHash('sha256').update(local).digest('hex').slice(0, 20));
console.log('末尾 200 字节:', JSON.stringify(local.subarray(-200).toString('utf8')));
console.log('');
for (const url of ['https://unpkg.com/@sveltia/cms@0.213.2/dist/sveltia-cms.mjs', 'https://registry.npmjs.org/@sveltia/cms/-/cms-0.213.2.tgz']) {
  try {
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(url, '->', buf.length, 'bytes', createHash('sha256').update(buf).digest('hex').slice(0, 20));
  } catch (e) { console.log(url, 'ERR', e.message); }
}
