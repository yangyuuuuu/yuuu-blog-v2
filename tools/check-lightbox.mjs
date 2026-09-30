#!/usr/bin/env node
/**
 * 正文图片灯箱的回归测试（src/layouts/PostLayout.astro）。
 *
 * 为什么要它：站主在手机上点图报「一片空白」—— 原因是灯箱直接把 src 换成原图，
 * 原图好几 MB，等它下载的那几秒屏幕是**全黑**的。现在改成：
 *   1. 先把缩略图铺上去（几十 KB，立刻可见）
 *   2. 显示「正在加载原图…」
 *   3. 原图加载完再盖上去
 *
 * 这几条都是**时序行为**，肉眼看代码看不出问题，必须有真浏览器 + 限速来盯。
 * 跑法：node tools/check-lightbox.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';

let failed = 0;
const ok = (cond, label, extra) => {
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (cond || extra === undefined ? '' : '  → ' + extra));
  if (!cond) failed++;
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = join('dist', decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && !extname(p)) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(8203, '127.0.0.1', r));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROF = process.env.TEMP + '\edge-lightbox-check';
rmSync(PROF, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9302', '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = () => {
  try { edge.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { rmSync(PROF, { recursive: true, force: true }); } catch { /* 忽略 */ }
};

try {
  /* 没有 dist 就直接说清楚（check:all 里 build 在前，正常不会走到） */
  if (!existsSync('dist/posts')) {
    console.log('  ⚠️ 跳过：还没有 dist（先 npm run build）');
    cleanup();
    process.exit(0);
  }
  /* 找一篇带 data-full 图的文章页 —— 不写死某篇文章（用户可能改名/删除） */
  const { readdirSync, statSync } = await import('node:fs');
  let page = '';
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (e !== 'index.html' || page) continue;
      const html = readFileSync(p, 'utf8');
      if (/data-full="[^"]*\/uploads\//.test(html) && /src="\/uploads\/thumbs\//.test(html)) page = p;
    }
  };
  walk('dist');
  if (!page) {
    console.log('  ⚠️ 跳过：产物里找不到「缩略图 + data-full」的文章页');
    cleanup();
    process.exit(0);
  }
  const url = 'http://127.0.0.1:8203/' + page.replace(/^dist[\\/]/, '').replace(/[\\/]index\.html$/, '/');

  let ws;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch('http://127.0.0.1:9302/json/list')).json(); const t = l.find((x) => x.type === 'page'); if (t) { ws = t.webSocketDebuggerUrl; break; } } catch { /* 还没起来 */ }
    await sleep(300);
  }
  if (!ws) {
    console.log('  ⚠️ 跳过：这台机器上没有 Edge（或起不来），浏览器类检查需要它');
    cleanup();
    process.exit(0);
  }
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 0; const pending = new Map();
  sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); sock.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : null; };
  const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(250); } return false; };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  /* 手机视口 + 50KB/s：模拟站主报问题时的场景（原图要十几秒才到） */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
  await send('Page.navigate', { url });
  await sleep(10000);

  console.log('=== 手机慢网下点开正文图片 ===');
  ok(await ev("!!document.querySelector('.article-wrap img[data-full]')"), '文章里有可点开的图', url);
  await ev("document.querySelector('.article-wrap img[data-full]').click()");
  await sleep(500);

  ok(await ev("!document.getElementById('imgView').hidden"), '灯箱打开了');
  ok(await ev("document.getElementById('imgViewPh').complete && document.getElementById('imgViewPh').naturalWidth > 0"),
    '★ 立刻看到缩略图（不是黑屏）');
  ok(await ev("!document.getElementById('imgViewLoading').hidden"), '★ 提示「正在加载原图…」');
  ok(await ev("!document.getElementById('imgViewPic').classList.contains('is-ready')"), '原图还没到时不显示它（避免半张白图）');

  const shown = await waitFor("document.getElementById('imgViewPic').classList.contains('is-ready')", 90000);
  ok(shown, '★ 原图加载完会自动盖上来');
  if (shown) {
    ok(await ev("document.getElementById('imgViewLoading').hidden"), '提示收起来了');
    ok(await ev("document.getElementById('imgViewPic').naturalWidth > 0"), '原图确实有内容（不是破图）');
    ok(await waitFor("getComputedStyle(document.getElementById('imgViewPic')).opacity === '1'", 3000), '原图完全不透明（淡入结束）');
    /*
     * ★ 站主报过「全屏图上盖着原位置的缩略图」：
     * 缩略图层（ph）不撤掉的话会一直压在原图上面 —— 尤其两张图尺寸不同，
     * 露在外面的那一圈糊图特别明显。原图就绪后 ph 必须退场（透明度归零）。
     */
    ok(await waitFor("getComputedStyle(document.getElementById('imgViewPh')).opacity === '0'", 3000),
      '★★ 原图就绪后缩略图层被撤掉（不再遮挡全屏图）');
    ok(await ev("getComputedStyle(document.getElementById('imgViewPh')).pointerEvents === 'none'"),
      '缩略图层不再接收点击');
  }

  await ev("document.getElementById('imgViewClose').click()");
  await sleep(300);
  ok(await ev("document.getElementById('imgView').hidden"), '关得掉');
} finally {
  cleanup();
}

console.log('');
if (failed) { console.log('正文图片灯箱检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('正文图片灯箱检查通过 ✓  先缩略图、后原图，慢网下不再黑屏');
process.exit(0);