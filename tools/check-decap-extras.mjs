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
  /*
   * 媒体卡片：Decap 的真实结构 —— 卡片里有个图标位
   * [data-testid="card-file-icon"]，图片资源的卡片里再放一张缩略预览。
   * 「点图全屏」只认这种卡片；外面（比如这页的 grid）不碰。
   */
  /* 独立媒体页面的工具栏：有「选择」控件（选择弹窗里没有它）*/
  '<div id="toolbar"><button type="button">删除</button><button type="button">选择</button></div>',
  '<div id="media">',
  '  <div class="sc-card media-card"><span data-testid="card-file-icon"></span>',
  '    <img src="/uploads/166187.jpg" alt="媒体第一张"></div>',
  '  <div class="sc-card media-card"><span data-testid="card-file-icon"></span>',
  '    <img src="/uploads/166187.jpg" alt="媒体第二张"></div>',
  '  <button id="decoy"><img src="/uploads/0b91ecca7f2e7e9bba28b33b1ed75c64257c7c32.jpg" alt="按钮里的图"></button>',
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
  /*
   * ⚠️ 没有 Edge 的环境（CI / Cloudflare 构建机）要**优雅跳过**，不能算失败。
   * 这个测试需要真浏览器；构建机上跑不起来是正常的，不是代码有问题。
   * 之前没做这个区分 —— 如果构建命令里带了 check:all，就会把构建整个搞挂。
   */
  let wsUrlStr;
  try {
    wsUrlStr = await wsUrl();
  } catch (err) {
    console.log('  ⚠️ 跳过：这台机器上没有 Edge（或起不来），浏览器类检查需要它');
    try { server.close(); } catch (e) {}
    try { rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }
  const ws = new WebSocket(wsUrlStr);
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
  /* 用 #/media 进去 —— 媒体页就是用这个路由（decap-extras 靠它判断「是不是媒体页面」） */
  await send('Page.navigate', { url: 'http://127.0.0.1:8099/' + PAGE + '#/media' });
  await sleep(2500);

  console.log('=== 注入 ===');
  /*
   * 页面上有 5 张 /uploads/ 图：2 张普通卡片 + 2 张媒体卡片 + 1 张**在按钮里**。
   * 工具条只该挂在卡片的 4 张上（按钮里的那张要跳过，否则会干扰按钮自己的交互）。
   */
  ok(await ev("document.querySelectorAll('.dcx-tools').length") === 5, '每张 /uploads/ 图旁都挂上了工具条（含按钮里那张）');
  ok(await ev("document.querySelectorAll('.dcx-btn').length") === 10, '两个按钮 × 五张图');
  ok(await ev("getComputedStyle(document.querySelector('.card')).position") === 'relative', '父容器被设成定位元素（按钮才贴得住角）');
  await sleep(900);
  ok(await ev("document.querySelectorAll('.dcx-tools').length") === 5, '★ 不会重复注入（观察者反复触发也只挂一次）');

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

  console.log('=== 点图直接全屏（媒体库）===');
  {
    /* 媒体卡片里的图：点一下就该全屏 */
    await ev("document.querySelectorAll('.media-card img')[1].click()");
    await sleep(600);
    const shown = await ev("(document.querySelector('.dcx-mask img')||{}).src || ''");
    ok(await ev("!!document.querySelector('.dcx-mask')"), '★ 点媒体卡片里的图 → 全屏打开');
    ok(String(shown).includes('166187'), '★ 看的就是点的那张', shown);
    ok(await ev("!!document.querySelector('.dcx-name')"), '显示文件名');
    ok(await ev("!!document.querySelector('.dcx-mask--full')"), '用的是全屏版式（图片更大）');
    await ev("Array.from(document.querySelectorAll('.dcx-bar button')).find(b=>b.textContent==='关闭').click()");
    await sleep(350);
    ok(await ev("!document.querySelector('.dcx-mask')"), '能关掉');

    /* Escape 也要能关 */
    await ev("document.querySelectorAll('.media-card img')[0].click()");
    await sleep(500);
    ok(await ev("!!document.querySelector('.dcx-mask')"), '再点一次还能开');
    await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await sleep(350);
    ok(await ev("!document.querySelector('.dcx-mask')"), '★ Escape 能关掉');

    /* 不在卡片里的图不该被接管（原来那个「看原图」按钮仍然可用） */
    await ev("document.getElementById('decoy').click()");
    await sleep(400);
    ok(await ev("!document.querySelector('.dcx-mask')"), '★ 按钮里的图不会被接管（不吞别的交互）');

    /* 空白处点击不该出事 */
    await ev("document.getElementById('media').click()");
    await sleep(300);
    ok(await ev("!document.querySelector('.dcx-mask')"), '点空白处不会误开');

    /*
     * ★ 反向验一次「只在媒体页面接管单击」：
     * 把 hash 换成文章编辑路由（＝编辑器里的「选择图片」弹窗），
     * 再点同一张图 —— 单击必须**不接管**，否则用户单击就选不中图、插不进图片。
     * 这条要是红了，说明 gate 失效，插图流程会被破坏。
     */
    await ev("location.hash = '#/collections/posts/entries/2026-01-01-x'");
    await sleep(400);
    await ev("document.querySelectorAll('.media-card img')[0].click()");
    await sleep(400);
    ok(await ev("!document.querySelector('.dcx-mask')"), '★ 编辑器路由下单击不接管（插图流程不受影响）');

    /* 同一个位置：**双击**必须能全屏（这是给编辑器插图弹窗留的路） */
    await ev("document.querySelectorAll('.media-card img')[0].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    await sleep(500);
    ok(await ev("!!document.querySelector('.dcx-mask')"), '★ 编辑器路由下双击图片 → 全屏');
    await ev("Array.from(document.querySelectorAll('.dcx-bar button')).find(b=>b.textContent==='关闭').click()");
    await sleep(300);

    /* 路由变体：/medium/ 是 Decap「介质库」集合，也当作媒体页（它是管理图片的地方） */
    await ev("location.hash = '#/medium/2026'");
    await sleep(400);
    await ev("document.querySelectorAll('.media-card img')[0].click()");
    await sleep(450);
    ok(await ev("!!document.querySelector('.dcx-mask')"), '★ #/medium/... 也认（介质库集合）');
    await ev("Array.from(document.querySelectorAll('.dcx-bar button')).find(b=>b.textContent==='关闭').click()");
    await sleep(300);

    /* 回到媒体页，双击不重复开 */
    await ev("location.hash = '#/media'");
    await sleep(400);
  }

  console.log('=== 异常 ===');
  ok(errs.length === 0, '没有控制台异常', errs.join(' | '));
} finally {
  cleanup();
}

console.log('');
if (failed) { console.log('Decap 增强检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('Decap 增强检查通过 ✓  看原图 / 重命名按钮注入正常，闭包没串图');
process.exit(0);
