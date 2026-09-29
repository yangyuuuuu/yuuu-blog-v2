#!/usr/bin/env node
/**
 * 「主题随时间自动切换」+「文章页回到开头/跳到末尾」的回归测试。
 *
 * 为什么要用真浏览器测：
 *   · 主题要**把时钟拨到各个小时**才能验证边界（7:00 和 19:00 到底算哪一边），
 *     还要验证跨夜区间（20-6）—— 光看代码很容易把边界写错，
 *     而这种错一年只在两次换季时被人发现。
 *   · 两个跳转按钮要真的滚一下才知道有没有生效（按钮位置、置灰时机）。
 * 所以这里起一个本地静态服务器 + 无头 Edge，用 CDP 固定时钟后逐项断言。
 *
 * 跑法：node tools/check-theme-jump.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  let p = 'dist' + decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (!existsSync(p) && !extname(p)) p += '/index.html';
  if (!existsSync(p)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(8096, '127.0.0.1', r));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9321;
const PROF = process.env.TEMP + '\\edge-v15';
rmSync(PROF, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(300); } throw new Error('no edge'); }
/* 没有 Edge 的环境（CI / 构建机）要**优雅跳过**，不能算失败 —— 见 check-decap-extras.mjs 里的说明 */
  let _wsUrl;
  try {
    _wsUrl = await wsUrl();
  } catch (err) {
    console.log('  ⚠️ 跳过：这台机器上没有 Edge（或起不来），浏览器类检查需要它');
    try { server.close(); } catch (e) {}
    process.exit(0);
  }
  const ws = new WebSocket(_wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : null; };
await send('Page.enable'); await send('Runtime.enable');

let bad = 0;
const ok = (c, label, extra) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + label + (c || extra === undefined ? '' : '  → ' + extra)); if (!c) bad++; };

/* ============ 1. 主题随时间自动 ============ */
console.log('=== #1 主题随时间自动 ===');
await send('Page.navigate', { url: 'http://127.0.0.1:8096/' });
await sleep(1800);
ok(!!(await ev('typeof window.__yuuuTheme')), '首屏脚本暴露了 window.__yuuuTheme');
/* 把时钟固定，逐个小时看结果 */
const probe = async (hour, themeVal, dayRange) => {
  return await ev(`(() => {
    localStorage.setItem('yuuu-theme', ${JSON.stringify(themeVal)});
    localStorage.setItem('yuuu-day', ${JSON.stringify(dayRange)});
    var real = Date.prototype.getHours;
    Date.prototype.getHours = function () { return ${hour}; };
    window.__yuuuTheme();
    Date.prototype.getHours = real;
    return document.documentElement.getAttribute('data-theme');
  })()`);
};
for (const h of [6, 7, 12, 18, 19, 23]) {
  const got = await probe(h, 'auto', '7-19');
  const want = h >= 7 && h < 19 ? 'light' : 'dark';
  ok(got === want, h + ' 点 → ' + want, got);
}
ok(await probe(22, 'auto', '20-6') === 'light', '跨夜区间 20-6：22 点算白天（亮）', await probe(22, 'auto', '20-6'));
ok(await probe(3, 'auto', '20-6') === 'light', '跨夜区间 20-6：凌晨 3 点也算白天（亮）', await probe(3, 'auto', '20-6'));
ok(await probe(12, 'auto', '20-6') === 'dark', '跨夜区间 20-6：中午 12 点是夜里（暗）', await probe(12, 'auto', '20-6'));
ok(await probe(23, 'light', '7-19') === 'light', '手动钉死 light → 深夜也是亮', await probe(23, 'light', '7-19'));
ok(await probe(12, 'dark', '7-19') === 'dark', '手动钉死 dark → 白天也是暗', await probe(12, 'dark', '7-19'));
ok(await probe(12, '', '7-19') === 'light', '没存过设置 → 默认 auto（12 点亮）', await probe(12, '', '7-19'));

/* 设置面板 */
await ev(`(function(){ localStorage.removeItem('yuuu-theme'); localStorage.removeItem('yuuu-day'); document.getElementById('settingsToggle').click(); })()`);
await sleep(1200);
ok(await ev("!!document.querySelector('[data-theme-auto]')"), '设置面板里有「自动切换」开关');
ok(await ev("!!document.querySelector('[data-day-from]') && !!document.querySelector('[data-day-to]')"), '有白天区间的两个下拉');
ok(await ev("document.querySelectorAll('[data-day-from] option').length") === 24, '下拉是 0~23 共 24 项', String(await ev("document.querySelectorAll('[data-day-from] option').length")));
ok(await ev("document.querySelector('[data-theme-auto]').checked") === true, '默认就是开（勾选）');
ok(await ev("document.querySelector('[data-day-from]').value") === '7' && await ev("document.querySelector('[data-day-to]').value") === '19', '默认区间 7 点到 19 点');
ok(await ev("document.querySelector('[data-theme-day]').hidden") === false, '开的时候区间可见');
ok(/现在 \d\d 点/.test(String(await ev("document.querySelector('[data-theme-now]').textContent"))), '显示了「现在几点 → 亮/暗」', await ev("document.querySelector('[data-theme-now]').textContent"));
/* 改区间 → 自动打开 + 存盘 */
await ev("document.querySelector('[data-day-from]').value='9'; document.querySelector('[data-day-from]').dispatchEvent(new Event('change'))");
await sleep(300);
ok(await ev("localStorage.getItem('yuuu-day')") === '9-19', '改开始时间已存盘', await ev("localStorage.getItem('yuuu-day')"));
/* 关掉自动 */
await ev("document.querySelector('[data-theme-auto]').checked=false; document.querySelector('[data-theme-auto]').dispatchEvent(new Event('change'))");
await sleep(300);
const fixVal = await ev("localStorage.getItem('yuuu-theme')");
ok(fixVal === 'light' || fixVal === 'dark', '关掉自动 → 钉死成当前明暗', fixVal);
ok(await ev("document.querySelector('[data-theme-day]').hidden") === true, '关掉后面板里的区间隐藏');
/* 顶栏按钮手动覆盖 */
await ev("document.getElementById('themeToggle').click()");
await sleep(300);
ok(await ev("localStorage.getItem('yuuu-theme')") !== 'auto', '点顶栏按钮 → 变成手动固定', await ev("localStorage.getItem('yuuu-theme')"));

/* ============ 5. 文章页两个按钮 ============ */
console.log('=== #5 文章页 回到开头 / 跳到末尾 ===');
await send('Page.navigate', { url: 'http://127.0.0.1:8096/posts/2024-09-16-astro-rewrite/' });
await sleep(1800);
ok(await ev("!!document.getElementById('jumpTop') && !!document.getElementById('jumpEnd')"), '两个按钮都在');
ok(await ev("getComputedStyle(document.getElementById('postJump')).position") === 'fixed', '容器是 fixed（浮在视口上）');
ok(await ev("document.getElementById('jumpTop').disabled") === true, '在开头时「开头」按钮置灰');
const h = await ev('document.documentElement.scrollHeight');
console.log('  页面总高 ' + h + ' / 视口 ' + (await ev('window.innerHeight')));
/* 等按钮状态稳定（平滑滚动 + rAF 回调都走完）—— 死等固定毫秒会抖 */
const waitDisabled = async (id, want, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await ev("document.getElementById('" + id + "').disabled")) === want) return true;
    await sleep(150);
  }
  return false;
};
/* 跳到末尾 */
await ev("document.getElementById('jumpEnd').click()");
await sleep(1600);
const y1 = await ev('Math.round(window.scrollY)');
const maxY = await ev('document.documentElement.scrollHeight - window.innerHeight');
ok(y1 > 100, '★ 点「末尾」滚下去了', 'scrollY=' + y1 + ' / 最大 ' + maxY);
/*
 * ⚠️ 这条断言别写死成「必须置灰」。
 * 图片是懒加载的，等它们加载完，文章的底边会往下移 —— 也就是说
 * 「末尾」这个位置本身变了，按钮保持可点**是对的**（再点一下还能继续往下）。
 * 所以判据是：要么已经置灰，要么确实滚到了当时算出来的文章末尾附近。
 */
{
  const target = await ev('Math.min(document.documentElement.scrollHeight - window.innerHeight, document.querySelector("article").getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 96)');
  const off = Math.abs(y1 - target);
  const dis = await ev("document.getElementById('jumpEnd').disabled");
  ok(dis || off <= 60, '★ 到文章末尾后「末尾」按钮置灰（或已停在末尾附近）', 'disabled=' + dis + ' scrollY=' + y1 + ' 目标≈' + Math.round(target) + ' 偏差=' + Math.round(off));
}
/* 回到开头 */
await ev("document.getElementById('jumpTop').click()");
await sleep(1600);
const y2 = await ev('Math.round(window.scrollY)');
ok(y2 < 100, '★ 点「开头」滚回文章最上面', 'scrollY=' + y2);
ok((await ev("document.getElementById('jumpTop').disabled")) === true || (await ev('Math.round(window.scrollY)')) <= 8, '回到开头后「开头」按钮置灰');

console.log('');
console.log('=== 控制台异常 ===');
ok(errs.length === 0, '没有异常', errs.join(' | '));
console.log('');
console.log(bad ? '验证失败 ✗ 共 ' + bad + ' 项' : '验证通过 ✓ #1 与 #5 行为符合预期');
edge.kill(); server.close(); process.exit(bad ? 1 : 0);
