import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const CFG = readFileSync('public/admin/config.yml', 'utf8');
const CMS = readFileSync('probe-cms-0.212.2.mjs', 'utf8');
/* 甲：直接 <script type=module src=/cms.mjs>；乙：fetch + blob + script src=blob */
const page = (mode) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>t</title></head><body>
  <p id="mark">MARK</p>
  <script>
    window.addEventListener('error', e => { document.getElementById('mark').textContent = 'ERR:' + e.message; });
    window.addEventListener('unhandledrejection', e => { document.getElementById('mark').textContent = 'REJ:' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason); });
  </script>
  ${'${mode}' === 'direct' ? '<script type="module" src="/cms.mjs"></script>' : `<script>(async()=>{const c=await (await fetch('/cms.mjs')).text();const u=URL.createObjectURL(new Blob([c],{type:'text/javascript'}));const s=document.createElement('script');s.type='module';s.src=u;document.body.appendChild(s);})()</script>`}
  </body></html>`;
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/direct/' || url === '/blob/') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(page(url.slice(1, -1))); }
  if (url === '/cms.mjs') { res.writeHead(200, {'Content-Type':'application/javascript'}); return res.end(CMS); }
  if (url === '/direct/config.yml' || url === '/blob/config.yml') { res.writeHead(200, {'Content-Type':'text/yaml'}); return res.end(CFG); }
  res.writeHead(404); res.end('nope');
});
server.listen(4603, () => console.log('h3 on 4603'));