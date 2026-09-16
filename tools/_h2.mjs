import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const CFG = readFileSync('public/admin/config.yml', 'utf8');
const BUNDLES = { 'a': readFileSync('probe-cms-0.212.2.mjs', 'utf8'), 'b': readFileSync('probe-cms-0.213.2.mjs', 'utf8') };
const mk = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>t</title></head><body>
  <p id="mark">MARKER-VISIBLE</p>
  <script>window.addEventListener('error',e=>{document.getElementById('mark').textContent='ERR:'+e.message});
  window.addEventListener('unhandledrejection',e=>{document.getElementById('mark').textContent='REJ:'+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)});</script>
  </body></html>`;
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  const m = /^\/t\/(a|b)\/(with|without)\//.exec(url + '/');
  if (m) {
    const [, bundle, cfg] = m;
    let html = mk();
    html = html.replace('</body>', '<script type="module" src="/bundle/' + bundle + '.mjs"></script></body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  const b = /^\/bundle\/(a|b)\.mjs$/.exec(url);
  if (b) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(BUNDLES[b[1]]); }
  if (url === '/t/a/with/config.yml' || url === '/t/b/with/config.yml') { res.writeHead(200, { 'Content-Type': 'text/yaml' }); return res.end(CFG); }
  res.writeHead(404); res.end('nope');
});
server.listen(4602, () => console.log('h2 on 4602'));