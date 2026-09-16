import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const port = 9334;
const edge = spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await sleep(500); try { const l = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(); target = l.find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  const { method, params } = m;
  if (method === 'Runtime.consoleAPICalled') logs.push('[console.' + params.type + '] ' + params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (params.exceptionDetails.exception?.description || params.exceptionDetails.text || '').slice(0, 300));
  if (method === 'Network.loadingFailed') logs.push('[FAILED] ' + params.errorText + ' type=' + params.type);
  if (method === 'Network.responseReceived' && params.response.status >= 400) logs.push('[HTTP ' + params.response.status + '] ' + params.response.url.slice(0, 140));
});
ws.addEventListener('open', async () => {
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'https://yuuu.love/admin/' });
  await sleep(18000);
  const insp = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ els: [...document.querySelectorAll("*")].map(e => e.tagName + (e.id ? "#"+e.id : "") + (e.className && typeof e.className === "string" ? "."+e.className.split(" ").slice(0,2).join(".") : "")), scripts: [...document.scripts].map(s => s.src || "inline"), text: (document.body.innerText || "").slice(0, 300) })',
    returnByValue: true,
  });
  writeFileSync('probe-admin-inspect.json', insp?.result?.value || '{}', 'utf8');
  console.log(insp?.result?.value?.slice(0, 1200));
  console.log('--- 日志 ---');
  console.log(logs.length ? logs.slice(0, 25).join('\n') : '(无)');
  ws.close(); edge.kill(); process.exit(0);
});
