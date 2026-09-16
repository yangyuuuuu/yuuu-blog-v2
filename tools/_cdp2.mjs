import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const port = 9337;
const edge = spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--window-size=1280,900','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await sleep(500); try { const l = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(); target = l.find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
ws.addEventListener('open', async () => {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'https://yuuu.love/admin/' });
  await sleep(18000);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const deep = (root, out) => {
      for (const el of root.querySelectorAll('*')) {
        out.count++;
        if (el.shadowRoot) { out.shadows.push(el.tagName + (el.id ? '#' + el.id : '')); deep(el.shadowRoot, out); }
      }
    };
    const out = { count: 0, shadows: [], iframes: document.querySelectorAll('iframe').length, bodyHTML: document.body.innerHTML.length };
    deep(document, out);
    out.visibleText = (document.body.innerText || '').slice(0, 200);
    return JSON.stringify(out);
  })()` });
  console.log('深层元素统计:', r?.result?.value);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync('probe-admin.png', Buffer.from(shot.data, 'base64'));
    console.log('截图已保存 probe-admin.png');
  } else console.log('截图失败');
  ws.close(); edge.kill(); process.exit(0);
});
