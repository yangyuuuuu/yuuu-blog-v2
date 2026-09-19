#!/usr/bin/env node
/**
 * Decap 媒体库增强（public/admin/decap-extras.js）的回归测试。
 *
 * 为什么要单独一个测试：这两个功能是**运行时注入 DOM** 的
 * （Decap 的媒体库没有扩展点，见那个文件顶部的说明），
 * 而注入代码最容易出的错就是**闭包问题** ——
 * 「点第一张图的按钮，弹出的却是最后一张」这种错在肉眼检查时几乎看不出来。
 * 这里用一个仿造 Decap 卡片结构的页面把它固定住。
 *
 * 跑法：node tools/check-decap-extras.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, rmSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';

let failed = 0;
const ok = (cond, label, extra) => {
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (cond || extra === undefined ? '' : '  → ' + extra));
  if (!cond) failed++;
};

const PAGE = '_dcx-test.html';
const ROOT = 'public';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.css': 'text/css' };

/* 仿造 Decap：卡片是带哈希类名的 div，里面一个指向 /uploads/ 的 img */
writeFileSync(ROOT + '/' + PAGE, [
  '<!doctype html><html><head><meta charset="utf-8"><title>dcx</title></head><body>',
  '<div id="grid">',
  '  <div class="sc-abc123 card"><img src="/uploads/0b91ecca7f2e7e9bba28b33b1ed75c64257c7c32.jpg" alt="第一张"></div>',
  '  <div class="sc-def456 card"><img src="/uploads/166187.jpg" alt="第二张"></div>',
  '</div>',
  '<script src="/admin/decap-extras.js"></script>',
  '</body></html>',
].join('\n'), 'utf8');

const server = createServer((req, res) => {
  const p = ROOT + decodeURIComponent(req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404); res.end('no'); return; }
  try { res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(8099, '127.0.0.1', r));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9295;
const PROF = process.env.TEMP + '\\edge-dcx-check';
rmSync(PROF, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = () => {
  try { edge.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { unlinkSync(ROOT + '/' + PAGE); } catch { /* 忽略 */ }
};

try {
  async function wsUrl() {
    for (let i = 0; i < 60; i++) {
      try {
        const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const p = l.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
      } catch { /* 还没起来 */ }
      await sleep(300);
    }
    throw new Error('Edge 没起来');
  }
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : null; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8099/' + PAGE });
  await sleep(2500);

  console.log('=== 注入 ===');
  ok(await ev("document.querySelectorAll('.dcx-tools').length") === 2, '每张图旁都挂上了工具条');
  ok(await ev("document.querySelectorAll('.dcx-btn').length") === 4, '两个按钮 × 两张图');
  ok(await ev("getComputedStyle(document.querySelector('.card')).position") === 'relative', '父容器被设成定位元素（按钮才贴得住角）');
  await sleep(900);
  ok(await ev("document.querySelectorAll('.dcx-tools').length") === 2, '★ 不会重复注入（观察者反复触发也只挂一次）');

  console.log('=== 看原图 ===');
  await ev("document.querySelectorAll('.dcx-btn')[0].click()");
  await sleep(700);
  ok(await ev("!!document.querySelector('.dcx-mask')"), '灯箱打开了');
  const first = await ev("document.querySelector('.dcx-mask img').getAttribute('src')");
  ok(String(first).includes('0b91ecca'), '★ 点第一张的按钮，看到的就是第一张（不是最后一张）', first);
  ok(await ev("Array.from(document.querySelectorAll('.dcx-bar button')).some(b=>b.textContent.includes('新标签'))"), '给了「在新标签打开原图」的出口');
  await ev("Array.from(document.querySelectorAll('.dcx-bar button')).find(b=>b.textContent==='关闭').click()");
  await sleep(400);
  ok(await ev("!document.querySelector('.dcx-mask')"), '能关掉');

  console.log('=== 第二张也要对（闭包 bug 的另一半）===');
  await ev("document.querySelectorAll('.dcx-btn')[2].click()");
  await sleep(700);
  const second = await ev("document.querySelector('.dcx-mask img').getAttribute('src')");
  ok(String(second).includes('166187'), '★ 点第二张的按钮，看到的是第二张', second);
  await ev("Array.from(document.querySelectorAll('.dcx-bar button')).find(b=>b.textContent==='关闭').click()");
  await sleep(300);

  console.log('=== 重命名入口 ===');
  await ev("document.querySelectorAll('.dcx-btn')[1].click()");
  await sleep(600);
  ok(await ev("(document.querySelector('.dcx-box h3')||{}).textContent") === '重命名图片', '弹出改名对话框');
  ok(await ev("(document.querySelector('.dcx-box input')||{}).type") === 'text', '输入框是文本（不是口令框）');
  const prefill = await ev("document.querySelector('.dcx-box input').value");
  ok(prefill === '0b91ecca7f2e7e9bba28b33b1ed75c64257c7c32', '预填了当前的文件名（去掉后缀）', prefill);
  await ev("document.querySelector('.dcx-box .row button').click()");
  await sleep(300);

  console.log('=== 异常 ===');
  ok(errs.length === 0, '没有控制台异常', errs.join(' | '));
} finally {
  cleanup();
}

console.log('');
if (failed) { console.log('Decap 增强检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('Decap 增强检查通过 ✓  看原图 / 重命名按钮注入正常，闭包没串图');
process.exit(0);
