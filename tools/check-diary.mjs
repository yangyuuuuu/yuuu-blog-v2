#!/usr/bin/env node
/**
 * 日记页（/diary/）的回归测试。
 *
 * 为什么用真浏览器：这一页的核心是**口令之后的三个视图**（年 → 月 → 列表）
 * 加「一天一篇」的判断，全靠运行时渲染。而且它最容易出的错是
 * **把日记标题写进公开 HTML** —— 那条由 audit 的 8.7 节守着，这里守交互。
 *
 * 跑法：node tools/check-diary.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = 'dist' + decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (!existsSync(p) && !extname(p)) p += '/index.html';
  if (!existsSync(p)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(8094, '127.0.0.1', r));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9341;
const PROF = process.env.TEMP + '\\edge-diary';
rmSync(PROF, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, '--window-size=420,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(300); } throw new Error('no edge'); }
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : null; };
let bad = 0;
const ok = (c, label, extra) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + label + (c || extra === undefined ? '' : '  → ' + extra)); if (!c) bad++; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/hidden/leave')) return new Response('{}', { status: 200 });
    if (u.includes('/hidden')) {
      return new Response(JSON.stringify({ ticket: 'T', posts: [
        { slug: '2026-08-15-diary-a', title: '八月十五那天的日记', date: '2026-08-15', category: '日记', draft: false },
        { slug: '2026-08-03-diary-b', title: '八月初三', date: '2026-08-03', category: '日记', draft: false },
        { slug: '2024-01-09-diary-c', title: '2024 年 1 月的一篇', date: '2024-01-09', category: '日记', draft: false },
        { slug: '2026-08-20-draft', title: '草稿不该出现', date: '2026-08-20', category: '日记', draft: true },
        { slug: '2026-08-21-tech', title: '技术文章不该出现', date: '2026-08-21', category: '技术', draft: false },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };`,
});
await send('Page.navigate', { url: 'http://127.0.0.1:8094/diary/' });
await sleep(2000);
ok(await ev("document.getElementById('dgLogin').hidden") === false, '先看到口令框');
ok(await ev("document.querySelectorAll('#dgYears a').length") === 0, '登录前没有任何年份（空壳）');
await ev("document.getElementById('dgPwd').value='x'; document.getElementById('dgForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))");
await sleep(1200);
ok(await ev("document.getElementById('dgApp').hidden") === false, '★ 输口令后进入');
const years = await ev("Array.from(document.querySelectorAll('#dgYears a b')).map(x=>x.textContent)");
ok(years.length >= 3 && years[0] === String(new Date().getFullYear()), '年视图从今年倒序', JSON.stringify(years));
ok(years.includes('2024'), '★ 最早到 2024（站主要求的起点）', JSON.stringify(years));
ok((await ev("document.querySelectorAll('#dgYears a')[0].querySelector('span').textContent")) === '2 篇', '今年（2026）显示 2 篇 —— 总数按年累计，不是只算当前月', await ev("document.querySelectorAll('#dgYears a')[0].querySelector('span').textContent"));
ok((await ev("Array.from(document.querySelectorAll('#dgYears a')).find(a=>a.querySelector('b').textContent==='2024').querySelector('span').textContent")) === '1 篇', '2024 显示 1 篇');
/* 点 2026 */
await ev("location.hash = '#/2026'");
await sleep(700);
ok(await ev("document.getElementById('dgMonths').hidden") === false, '★ 进入月视图');
ok(await ev("document.querySelectorAll('#dgMonths a').length") === 12, '★ 固定 12 个月选项', String(await ev("document.querySelectorAll('#dgMonths a').length")));
const aug = await ev("document.querySelectorAll('#dgMonths a')[7].querySelector('span').textContent");
ok(aug === '2 篇', '8 月显示 2 篇（草稿不算）', aug);
ok(await ev("document.querySelectorAll('#dgMonths a')[0].querySelector('span').textContent") === '空', '1 月显示「空」');
/* 进 8 月 */
await ev("location.hash = '#/2026/08'");
await sleep(700);
ok(await ev("document.getElementById('dgList').hidden") === false, '★ 进入该月列表');
const items = await ev("Array.from(document.querySelectorAll('#dgList .dg-item span')).map(x=>x.textContent)");
ok(items.length === 2 && items[0] === '八月十五那天的日记', '★ 列出 2 篇且按日期倒序', JSON.stringify(items));
ok(!items.some((t) => t.includes('草稿')) && !items.some((t) => t.includes('技术')), '★ 草稿与非日记分类都不出现', JSON.stringify(items));
ok(await ev("(document.querySelector('#dgList .dg-item')||{}).getAttribute && document.querySelector('#dgList .dg-item').getAttribute('href')") === '/posts/2026-08-15-diary-a/', '链接指向文章页');
/* 选日子 */
await ev("document.getElementById('dgWriteBtn').click()");
await sleep(500);
ok(await ev("document.getElementById('dgDays').hidden") === false, '★ 点「写这一天」出现选日子');
ok(await ev("document.querySelectorAll('#dgDayGrid .dg-day').length") === 31, '8 月列出 31 天', String(await ev("document.querySelectorAll('#dgDayGrid .dg-day').length")));
ok(await ev("document.querySelectorAll('#dgDayGrid .dg-day.is-written').length") === 2, '★ 已写过的那两天被标出来', String(await ev("document.querySelectorAll('#dgDayGrid .dg-day.is-written').length")));
console.log('');
ok(errs.length === 0, '没有控制台异常', errs.join(' | '));
console.log(bad ? '日记页验证失败 ✗ 共 ' + bad + ' 项' : '日记页验证通过 ✓ 年→月→列表 + 一天一篇');
edge.kill(); server.close(); process.exit(bad ? 1 : 0);
