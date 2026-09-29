#!/usr/bin/env node
/**
 * 给 public/uploads 里的图片生成缩略图 → public/uploads/thumbs/<同名>.jpg
 *
 * 为什么要它：文章里的图现在是**原图直出**，一张 1MB 的图会让每次打开文章都下 1MB。
 * 站主要的是「默认小图、点击才加载原图」。而 Cloudflare Pages **没有按需缩放**
 * （那是 Cloudflare Images，另收费），所以缩略图必须**提前生成**。
 *
 * 为什么用无头浏览器而不是 sharp：
 * 这个仓库用 pnpm + CF 侧 --frozen-lockfile 安装。加一个依赖就要同步改
 * pnpm-lock.yaml，改不对**线上构建直接失败**（刚修好构建，不冒这个险）。
 * 浏览器里本来就有 canvas，正好用它做缩放 —— 零新依赖。
 *
 * 跑法：node tools/make-thumbs.mjs [--force]
 *   · 默认跳过已经存在的缩略图（增量，快）
 *   · --force 全部重做
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const WIDTH = 720;      /* 站主定的：宽 720px */
const QUALITY = 0.68;   /* 质量 68 */
const force = process.argv.includes('--force');

const SRC = 'public/uploads';
const OUT = join(SRC, 'thumbs');
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const todo = files.filter((f) => force || !existsSync(join(OUT, f.replace(/\.[^.]+$/, '.jpg'))));
console.log('共 ' + files.length + ' 张图，需要生成 ' + todo.length + ' 张缩略图');
if (!todo.length) { console.log('都齐了。'); process.exit(0); }

/* 极简静态服务器：只服务 public/ 下的图片 */
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const p = 'public' + decodeURIComponent(req.url.split('?')[0]);
  /* 目录（比如根路径 /uploads/）给一个空页面当载体 —— canvas 要在页面里跑 */
  if (!extname(p) || !existsSync(p) || !statSync(p).isFile()) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>thumbs</title>');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(8093, '127.0.0.1', r));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9351;
const PROF = process.env.TEMP + '\\edge-thumbs';
rmSync(PROF, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('Edge 起不来');
}
const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text).slice(0, 120));
  return r.result ? r.result.value : null;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8093/uploads/' });

let done = 0;
for (const f of todo) {
  const out = join(OUT, f.replace(/\.[^.]+$/, '.jpg'));
  /* 在页面里画到 canvas 再导出 base64 —— 缩放交给浏览器 */
  const dataUrl = await ev(`(async () => {
    const img = new Image();
    img.src = '/uploads/${encodeURIComponent(f)}?x=' + Date.now();
    await img.decode();
    const scale = Math.min(1, ${WIDTH} / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return JSON.stringify({ data: c.toDataURL('image/jpeg', ${QUALITY}), w: w, h: h, ow: img.naturalWidth });
  })()`);
  const { data, w, h, ow } = JSON.parse(dataUrl);
  const b64 = String(data).split(',')[1];
  writeFileSync(out, Buffer.from(b64, 'base64'));
  const size = statSync(out).size;
  done++;
  console.log('  ' + f + '  ' + ow + 'px → ' + w + 'x' + h + '  ' + (size / 1024).toFixed(0) + 'KB');
}
edge.kill(); server.close();
console.log('\n生成 ' + done + ' 张缩略图 → ' + OUT);
