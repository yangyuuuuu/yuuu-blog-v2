/* 用 GitHub API 取那张被归类的图，检查字节与线上可达性 */
const path = 'public/uploads/芙芙/21c79930a788c8c5fa661a1f25de152e.jpg';
const api = 'https://api.github.com/repos/yangyuuuuu/yuuu-blog-v2/contents/' + path.split('/').map(encodeURIComponent).join('/');
const r = await fetch(api, { headers: { 'User-Agent': 'check', Accept: 'application/vnd.github+json' } });
console.log('GitHub API 状态:', r.status);
const j = await r.json();
if (!j.content) { console.log(JSON.stringify(j).slice(0, 300)); process.exit(0); }
const buf = Buffer.from(j.content.replace(/\n/g, ''), 'base64');
console.log('仓库里这张图字节:', buf.length);
console.log('前 4 字节（JPEG 应为 ffd8ffe0/ffd8ffe1）:', buf.slice(0, 4).toString('hex'));
console.log('末 2 字节（JPEG 应为 ffd9）:', buf.slice(-2).toString('hex'));
const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
console.log('★ 仍是完整 JPEG:', isJpeg);

const fs = await import('node:fs');
const localName = '21c79930a788c8c5fa661a1f25de152e.jpg';
if (fs.existsSync('public/uploads/' + localName)) {
  const orig = fs.readFileSync('public/uploads/' + localName);
  console.log('本地原图字节:', orig.length, '| ★ 与仓库里完全相同:', orig.length === buf.length && orig.equals(buf));
} else {
  console.log('本地那张已不在（move 时删掉了旧路径）');
}
console.log('--- 线上站点能不能打开 ---');
for (const p of ['/uploads/芙芙/' + localName, '/uploads/' + localName]) {
  try {
    const s = await fetch('https://yuuu.love' + p, { method: 'GET' });
    const b = Buffer.from(await s.arrayBuffer());
    console.log('  ' + p + ' → ' + s.status + ' | ' + b.length + ' 字节 | JPEG: ' + (b[0] === 0xff && b[1] === 0xd8));
  } catch (e) { console.log('  ' + p + ' → 请求失败 ' + e.message); }
}
