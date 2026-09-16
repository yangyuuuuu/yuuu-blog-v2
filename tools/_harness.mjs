import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const CMS = readFileSync('probe-cms.mjs', 'utf8');
const CFG = readFileSync('public/admin/config.yml', 'utf8');
const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>local cms test</title></head><body>
  <div id="status">loading…</div>
  <script>window.addEventListener('error',e=>{document.getElementById('status').textContent='ERR: '+e.message});
  window.addEventListener('unhandledrejection',e=>{document.getElementById('status').textContent='REJ: '+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)});</script>
</body></html>`;
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/admin/config.yml') { res.writeHead(200, {'Content-Type':'text/yaml'}); return res.end(CFG); }
  if (url === '/cms.mjs') { res.writeHead(200, {'Content-Type':'application/javascript'}); return res.end(CMS); }
  if (url === '/admin/' || url === '/admin') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(PAGE.replace('</body>', '<script type="module" src="/cms.mjs"></script></body>')); }
  res.writeHead(404); res.end('nope');
});
server.listen(4600, () => console.log('测试台已启动 http://localhost:4600/admin/'));