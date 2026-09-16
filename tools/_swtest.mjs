/**
 * 逐个 Sveltia 版本试探：在真实浏览器里加载，看能不能渲染出界面。
 * 用 CDP 拿 console 报错 + 元素数。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VERSIONS = ['0.213.2', '0.200.0', '0.150.0', '0.100.0', '0.50.0'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = mkdtempSync(join(tmpdir(), 'sveltia-'));
// 本地静态站：/admin/probe.html 引用某个版本的 bundle，config 放在 /admin/config.yml
const { writeFileSync, mkdirSync, copyFileSync } = await import('node:fs');
const site = join(base, 'site', 'admin');
mkdirSync(site, { recursive: true });
copyFileSync('public/admin/config.yml', join(site, 'config.yml'));
writeFileSync(join(site, 'probe.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>t</title></head><body><script type="module" src="./cms.mjs"></script></body></html>');

const { createServer } = await import('node:http');
const { readFileSync, readdirSync, statSync } = await import('node:fs');
const server = createServer((req, res) => {
  const p = join(base, 'site', decodeURIComponent(req.url.split('?')[0]));
  try {
    const data = readFileSync(stAt(p));
    res.writeHead(200, { 'Content-Type': p.endsWith('.mjs') ? 'application/javascript' : p.endsWith('.yml') ? 'text/yaml' : 'text/html' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
function stAt(p) { return statSync(p).isDirectory() ? join(p, 'probe.html') : p; }
await new Promise((r) => server.listen(4500, r));

for (const v of VERSIONS) {
  try {
    const r = await fetch('https://unpkg.com/@sveltia/cms@' + v + '/dist/sveltia-cms.mjs');
    if (!r.ok) { console.log(v + ': 取不到 (' + r.status + ')'); continue; }
    writeFileSync(join(site, 'cms.mjs'), Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.log(v + ': 下载失败 ' + e.message); continue; }

  const profile = mkdtempSync(join(tmpdir(), 'p-'));
  const port = 9400 + Math.floor(Math.random() * 200);
  const edge = spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 30 && !target; i++) { await sleep(400); try { const l = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(); target = l.find((t) => t.type === 'page'); } catch {} }
  if (!target) { console.log(v + ': 连不上浏览器'); edge.kill(); continue; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errs = [];
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 160));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:4500/admin/probe.html' });
  await sleep(12000);
  const st = await send('Runtime.evaluate', { returnByValue: true, expression: 'document.querySelectorAll("body *").length + "|" + (document.body.innerText||"").replace(/\\s+/g," ").slice(0,60)' });
  console.log(v.padEnd(9), '元素数|文字:', st?.result?.value, errs.length ? '  报错: ' + errs[0] : '');
  ws.close(); edge.kill();
}
server.close();
process.exit(0);
