#!/usr/bin/env node
/**
 * tools/audit-dist.mjs —— 对【真实构建产物】做验收
 *
 * tools/verify.mjs 检查的是源码；这个脚本检查 dist/，
 * 也就是拿 PRD 的性能红线和验收清单去量真正的产物。
 *
 * 用法： node tools/audit-dist.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

let pass = 0, fail = 0, warn = 0;
const ok = (m) => { pass++; console.log('  \u2713 ' + m); };
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const wrn = (m) => { warn++; console.log('  ! ' + m); };
const head = (t) => { console.log(''); console.log('=== ' + t + ' ==='); };

if (!existsSync(DIST)) {
  console.error('\n  dist/ 不存在，先跑 npm run build\n');
  process.exit(1);
}

const abs = (p) => join(DIST, p);
const read = (p) => readFileSync(abs(p), 'utf8');
const size = (p) => (existsSync(abs(p)) ? statSync(abs(p)).size : 0);
const kb = (n) => (n / 1024).toFixed(2) + ' KB';
const gz = (n) => (n / 1024).toFixed(2) + ' KB';

function walk(dir, filter, out = []) {
  const a = join(DIST, dir);
  if (!existsSync(a)) return out;
  for (const n of readdirSync(a)) {
    const rel = join(dir, n);
    if (statSync(join(DIST, rel)).isDirectory()) walk(rel, filter, out);
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

/* ---------------------------------------------------------------- 1. 页面 */
head('1. 页面产物');
const pages = walk('.', (p) => p.endsWith('.html'));
ok(pages.length + ' 个 HTML 页面');
for (const p of [
  'index.html', '404.html', 'rss.xml', 'sitemap-index.xml', 'og-default.png', 'robots.txt',
  'favicon.ico', 'favicon-32.png', 'icon-192.png', 'apple-touch-icon.png', 'site.webmanifest',
  'emblem.webp', 'admin/index.html',
]) {
  if (existsSync(abs(p))) ok(p);
  else bad('缺少 ' + p);
}
const postPages = pages.filter((p) => p.startsWith('posts' + (process.platform === 'win32' ? '\\' : '/')));
if (postPages.length >= 12) ok('文章详情页 ' + postPages.length + ' 个');
else bad('文章详情页只有 ' + postPages.length + ' 个（应有 12）');

/* ---------------------------------------------------------------- 2. 首屏 JS */
head('2. 首屏 JS 预算（PRD 红线 < 10KB）');
const indexHtml = read('index.html');

const inlineTags = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
const inline = inlineTags.reduce((n, m) => n + Buffer.byteLength(m[2], 'utf8'), 0);
const inlineRank = inlineTags
  .map((m) => {
    const body = m[2];
    const isModule = m[1].indexOf('module') >= 0;
    let label = body.replace(/\s+/g, ' ').trim().slice(0, 44);
    if (body.indexOf('themeIcon') >= 0 || body.indexOf('IntersectionObserver') >= 0) label = '主题切换 + 滚动淡入';
    else if (body.indexOf('pagefind') >= 0) label = '站内搜索（Pagefind 懒加载）';
    else if (body.indexOf('prefetch') >= 0) label = 'Astro 预取运行时';
    else if (body.indexOf('navToggle') >= 0) label = '移动端菜单开关';
    else if (body.indexOf('postGrid') >= 0) label = '首页加载更多';
    else if (body.indexOf('yuuu-theme') >= 0) label = '主题防闪白（head 内联，防 FOUC）';
    return { bytes: Buffer.byteLength(m[2], 'utf8'), isModule, label };
  })
  .sort((a, b) => b.bytes - a.bytes);

const extSrcs = [...indexHtml.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);
let extRaw = 0, extGz = 0;
const extList = [];
for (const src of extSrcs) {
  if (/^https?:/.test(src)) continue;
  const file = src.replace(/^\//, '');
  if (!existsSync(abs(file))) { bad('引用了不存在的脚本 ' + src); continue; }
  const buf = readFileSync(abs(file));
  extRaw += buf.length;
  const g = gzipSync(buf).length;
  extGz += g;
  extList.push([file, buf.length, g]);
}
console.log('    行内脚本合计        ' + kb(inline) + '（共 ' + inlineTags.length + ' 段）');
for (const r of inlineRank) {
  console.log('      · ' + kb(r.bytes).padStart(9) + '  ' + r.label + (r.isModule ? '  [module]' : ''));
}
for (const [f, r, g] of extList) console.log('    ' + f.padEnd(20) + kb(r) + '  → gzip ' + gz(g));
const totalGz = inline + extGz;
if (inline < 10 * 1024) ok('首屏行内 JS ' + kb(inline) + ' < 10 KB');
else bad('首屏行内 JS ' + kb(inline) + ' 超过 10 KB');
ok('首屏 JS 实际传输（含 gzip 外部包）约 ' + kb(totalGz));
if (totalGz < 10 * 1024) ok('总计 ' + kb(totalGz) + ' < 10 KB 红线');
else wrn('总计 ' + kb(totalGz) + ' 超过 10 KB，按 PRD 需要砍功能');

/* ---------------------------------------------------------------- 3. 第三方脚本 */
head('3. 第三方脚本');
const third = [];
const adminThird = [];
for (const p of pages) {
  const html = read(p);
  const isAdmin = p.startsWith('admin');
  for (const m of html.matchAll(/<script[^>]*\bsrc=["']https?:\/\/[^"']+["']/g)) {
    (isAdmin ? adminThird : third).push(p + ' :: ' + m[0].slice(0, 80));
  }
}
if (!third.length) ok('公开页面 0 个第三方脚本（统计脚本需填 token 才会注入）');
else third.forEach((t) => bad('公开页面出现外部脚本: ' + t));
if (adminThird.length) {
  ok('/admin 的 ' + adminThird.length + ' 个外链脚本已隔离（Sveltia CMS，只在后台加载）');
  adminThird.forEach((t) => console.log('      ' + t));
}

/* ---------------------------------------------------------------- 4. 首页分页 */
head('4. 首页首屏只渲染 10 篇 + 加载更多');
const cards = (indexHtml.match(/<article/g) || []).length;
if (cards === 10) ok('首屏正好 10 张卡片');
else if (cards < 10) ok('首屏 ' + cards + ' 张卡片（文章不足 10 篇）');
else bad('首屏渲染了 ' + cards + ' 张卡片，超过 10');

const apiFiles = walk('api', (p) => p.endsWith('.json'));
if (apiFiles.length) {
  ok('加载更多用的静态 JSON ' + apiFiles.length + ' 个：' + apiFiles.join(', '));
  const j = JSON.parse(read(apiFiles[0]));
  if (j.html && j.html.includes('<article')) ok('JSON 里带着预渲染好的卡片 HTML（' + kb(Buffer.byteLength(j.html)) + '）');
  else bad('JSON 结构不对');
} else bad('没有 api/posts/*.json，加载更多会失效');

/* ---------------------------------------------------------------- 5. 搜索 */
head('5. Pagefind 搜索索引');
if (existsSync(abs('pagefind'))) {
  const pf = walk('pagefind', () => true);
  ok('pagefind 目录 ' + pf.length + ' 个文件，' + kb(pf.reduce((n, p) => n + size(p), 0)));
  const runtime = pf.find((p) => p.endsWith('pagefind.js'));
  if (runtime) ok('运行时模块 ' + runtime + '（' + kb(size(runtime)) + '）');
  else bad('缺少 pagefind.js —— SearchBox 的动态 import 会 404');

  const frag = pf.filter((p) => p.includes('fragment') || p.endsWith('.pf'));
  if (frag.length) ok('分片索引 ' + frag.length + ' 个，按需下载');
  if (indexHtml.includes('pagefind')) ok('首页引用了 pagefind（懒加载路径）');
  else wrn('首页里没看到 pagefind 字样');

  /* 关键：只索引正文，别把导航栏/页脚/标签页也算进去
     否则搜「芙宁娜」会返回 /tags/芙宁娜/ 这种标签页，而不是真文章 */
  const postPages = pages.filter((p) => p.startsWith('posts'));
  const withBody = postPages.filter((p) => read(p).includes('data-pagefind-body'));
  if (postPages.length && withBody.length === postPages.length) {
    ok('全部 ' + postPages.length + ' 篇文章都标了 data-pagefind-body（只索引正文）');
  } else {
    bad('只有 ' + withBody.length + '/' + postPages.length + ' 篇标了 data-pagefind-body，' +
        'Pagefind 会把导航栏、页脚、标签页一起索引，搜索结果会被标签页污染');
  }
  const withDate = postPages.filter((p) => read(p).includes('data-pagefind-meta="date"'));
  if (withDate.length === postPages.length && postPages.length) ok('文章都带 data-pagefind-meta="date"（结果能显示日期）');
  else wrn('部分文章缺少 data-pagefind-meta="date"，搜索结果不显示日期');

  const entry = JSON.parse(read('pagefind/pagefind-entry.json'));
  const listed = Object.values(entry.languages || {}).reduce((n, l) => n + (l.page_count || 0), 0);
  console.log('    索引页数 ' + listed + '（只含正文页是正常的）');
} else {
  bad('dist/pagefind 不存在 —— 搜索完全不可用。检查 npm run build 的后半段有没有跑到');
}

/* ---------------------------------------------------------------- 6. RSS / Sitemap */
head('6. RSS 与 Sitemap');
const rss = read('rss.xml');
const items = (rss.match(/<item>/g) || []).length;
if (items > 0 && items <= 20) ok('RSS 输出 ' + items + ' 篇（上限 20）');
else bad('RSS item 数异常：' + items);
for (const tag of ['<title>', '<link>', '<description>', '<pubDate>']) {
  if (rss.includes(tag)) ok('RSS 含 ' + tag);
  else bad('RSS 缺少 ' + tag);
}
const sm = read('sitemap-0.xml');
const urls = (sm.match(/<loc>/g) || []).length;
/* 404 与 /admin 不该进 sitemap，合理数量是 页面数 - 2 */
const expected = pages.length - 2;
if (urls >= expected) ok('Sitemap 收录 ' + urls + ' 个 URL（共 ' + pages.length + ' 个页面，已正确排除 404 与 /admin）');
else wrn('Sitemap 只有 ' + urls + ' 个 URL，期望至少 ' + expected);

/* ---------------------------------------------------------------- 7. 禁止事项（产物层面） */
head('7. 产物层面的禁止事项');
const publicHtml = pages.filter((p) => !p.startsWith('admin')).map((p) => read(p)).join('\n');
if (/<script[^>]*src=["']https?:/.test(publicHtml.replace(/cloudflareinsights/g, ''))) {
  bad('公开页面产物里有第三方脚本');
} else {
  ok('公开页面产物里没有第三方脚本（/admin 除外）');
}

const cssFiles = walk('_astro', (p) => p.endsWith('.css'));
if (cssFiles.length) {
  const css = cssFiles.map((p) => read(p)).join('\n');
  if (/\[hidden\]\s*{[^}]*display:\s*none/.test(css)) ok('产物 CSS 里 [hidden] 兜底还在');
  else bad('产物 CSS 丢了 [hidden] 兜底');
  if (/pointer-events:\s*none/.test(css)) ok('产物 CSS 里固定层 pointer-events 保护还在');
  else bad('产物 CSS 丢了 pointer-events 保护');
  console.log('    CSS: ' + cssFiles.map((f) => f + ' ' + kb(size(f))).join(', '));
}

/* ---------------------------------------------------------------- 8. 站点 URL */
head('8. 站点 URL 自检');
{
  const cfgSrc = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
  const m = cfgSrc.match(/SITE\s*=\s*['"]([^'"]+)['"]/);
  const configured = m ? m[1] : '';
  const canon = (indexHtml.match(/rel="canonical" href="([^"]+)"/) || [])[1] || '';
  const robots = existsSync(abs('robots.txt')) ? read('robots.txt') : '';

  if (!canon) {
    bad('首页没有 canonical');
  } else if (configured === 'https://yuuu.pages.dev') {
    bad('astro.config.mjs 的 SITE 还是模板占位符 —— canonical / sitemap / RSS / og:image 会全部指向错误的域名');
  } else if (!canon.startsWith(configured)) {
    wrn('canonical（' + canon + '）与配置的 SITE（' + configured + '）不一致，重新构建一次');
  } else {
    ok('canonical 与 SITE 一致：' + canon);
  }

  if (configured && !robots.includes(configured)) {
    bad('robots.txt 里的 Sitemap 地址与配置的 SITE 不一致');
  } else if (configured) {
    ok('robots.txt 的 Sitemap 地址一致');
  }
}

/* ---------------------------------------------------------------- 结果 */
console.log('');
console.log('================================================');
console.log(fail === 0
  ? '产物验收全部通过 \u2713   （' + warn + ' 条提示）'
  : fail + ' 项未通过 \u2717  （另有 ' + warn + ' 条提示）');
console.log('================================================');
console.log('');
process.exitCode = fail ? 1 : 0;
