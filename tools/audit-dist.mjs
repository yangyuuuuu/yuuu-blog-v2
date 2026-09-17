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
import { isHiddenData } from '../src/lib/hidden.ts';

/*
 * 只用正则取判定需要的两个键 —— 不 import 'yaml'。
 * 那是 astro 的传递依赖：npm 会提升到顶层所以本地能用，
 * pnpm 的隔离模式下却不可见（构建/审核都会报 Cannot find module 'yaml'）。
 */
function readHiddenKeys(raw) {
  const yaml = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(raw) || [])[1] || '';
  const pick = (key) => {
    const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(yaml);
    return m ? m[1].replace(/^["']|["']$/g, '') : undefined;
  };
  return { private: pick('private') === 'true', category: pick('category') };
}

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

/*
 * 首屏到底要下载哪些 JS？两种都要算：
 *   1. index.html 里内联的（行内脚本 + 被内联进来的模块）
 *   2. index.html 用 <script src> 直接引的静态入口 chunk
 * 只有「构建时切出去、运行时才 import() 的按需 chunk」不算 —— 那些见下面的懒加载表。
 */
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

/* 首屏只该下载 HTML 里出现过的东西；_astro 下其余的 .js 都是 import() 切的按需 chunk */
const onDemand = walk('_astro', (p) => p.endsWith('.js'))
  .filter((p) => !extList.some(([f]) => f.split(/[\\/]/).pop() === p.split(/[\\/]/).pop()))
  .map((p) => [p, read(p)]);
const lazy = [];
for (const [file, src] of onDemand) {
  const engine = /search-engine/.test(file) || src.includes('excerptLength') || src.includes('yuuuSearchPanel');
  const settings = /settings-panel/.test(file) || src.includes('yuuu-skin');
  const more = /loadMore|postGrid|__yuuuReveal/.test(src);
  const label = engine ? '搜索引擎（聚焦 / Ctrl+K 时才下载）'
    : settings ? '设置面板（点齿轮时才下载）'
      : more ? '首页加载更多（点按钮时才下载）'
        : 'Vite 共享依赖（静态入口的静态 import，随首屏一起下）';
  lazy.push([file, label, engine || settings || more]);
}
console.log('    行内脚本合计        ' + kb(inline) + '（共 ' + inlineTags.length + ' 段）');
for (const r of inlineRank) {
  console.log('      · ' + kb(r.bytes).padStart(9) + '  ' + r.label + (r.isModule ? '  [module]' : ''));
}
for (const [f, r, g] of extList) console.log('    ' + f.padEnd(20) + kb(r) + '  → gzip ' + gz(g));
for (const [f, label, isDeferred] of lazy) {
  console.log('    ' + (isDeferred ? '按需 ' : '静态 ') + f.padEnd(46) + kb(size(f)) + '  ' + label);
}
const totalGz = inline + extGz;
if (inline < 10 * 1024) ok('首屏行内 JS ' + kb(inline) + ' < 10 KB');
else bad('首屏行内 JS ' + kb(inline) + ' 超过 10 KB');
ok('首屏 JS 实际传输（含 gzip 外部包）约 ' + kb(totalGz));
if (totalGz < 10 * 1024) ok('总计 ' + kb(totalGz) + ' < 10 KB 红线');
else wrn('总计 ' + kb(totalGz) + ' 超过 10 KB，按 PRD 需要砍功能');

/*
 * 关键回归检查：搜索引擎如果被构建回入口（内联进 HTML 或并成静态 chunk），
 * 「首屏 JS」的账面上看不出来，但用户其实照样在首屏下载它。
 * 这里直接按产物内容判定：HTML/入口里出现了 pagefind 或 search-hit 就是退回去了。
 */
/*
 * 只扫脚本正文，不扫 <div id="yuuuSearchPanel"> 这种标记 ——
 * 引导脚本要往面板里写「正在准备搜索…」占位，提到这个 id 是正常的。
 * 这里找的是只有在引擎里才会出现的字符串。
 *   excerptLength / search-chips / search-hit → 结果渲染
 *   pagefind.js                               → 索引加载
 */
const firstScreenSrc = inlineTags.map((m) => m[2]).join('\n') +
  extList.map(([f]) => read(f)).join('\n');
const engineMarks = ['excerptLength', 'search-chips', 'search-hit', 'search-empty-art', 'pagefind.js'];
const leaked = engineMarks.filter((k) => firstScreenSrc.includes(k));
if (leaked.length) {
  bad('搜索引擎代码又回到首屏了（命中 ' + leaked.join(' / ') + '）：它应该只存在于按需 chunk 里' +
      '（见 src/scripts/search-engine.ts，别改成静态 import）');
} else {
  ok('搜索引擎不在首屏脚本里，只在按需 chunk 里（聚焦 / Ctrl+K 才下载）');
}
const engineChunk = walk('_astro', (p) => /search-engine/.test(p) && p.endsWith('.js'))[0];
if (!engineChunk) bad('缺少 search-engine 按需 chunk —— 构建没有把它切出去，或者动态 import 写错了');
else {
  const code = read(engineChunk);
  const missing = engineMarks.filter((k) => !code.includes(k));
  if (missing.length) bad('search-engine chunk 里缺少 ' + missing.join(' / ') + '，可能被打包器摇掉了');
  else ok('按需 chunk ' + engineChunk + ' 内容完整（' + kb(size(engineChunk)) + '，gzip ' + gz(gzipSync(readFileSync(abs(engineChunk))).length) + '）');
  /* 引导里的 import() 必须指向这个 chunk，否则用户一聚焦就是 404 */
  const boot = extList.map(([f]) => read(f)).join('\n');
  const target = engineChunk.split(/[\\/]/).pop().replace(/\.js$/, '');
  if (boot.includes(target)) ok('SearchBox 引导的 import() 指向 ' + target + '（路径对得上）');
  else bad('SearchBox 引导里的 import() 没指向 ' + target + '，聚焦搜索会 404');
}

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
/*
 * /admin 的 CMS 脚本来自 CDN —— 这是刻意的，别再改回自托管。
 * 自托管 = 浏览器要从本站下一个 1.9 MB 的文件，在「挂代理 + 跨境」的网络上
 * 经常被中途掐断，浏览器拿到半截 JS 就整页白屏、还没有任何提示（真实踩过）。
 * 这里要守住的是「必须锁死版本」：不然某天 CDN 上的新版会悄悄改坏配置。
 */
const adminHtml = existsSync(abs('admin/index.html')) ? read('admin/index.html') : '';
if (!adminHtml) {
  bad('缺少 admin/index.html —— 后台打不开');
} else if (/unpkg\.com|cdn\.jsdelivr\.net/.test(adminHtml)) {
  /* CMS 站点的唯一要求：从 CDN 加载（别自托管大文件）+ 版本锁死（别被新版改坏） */
  const known = /@sveltia\/cms/.test(adminHtml) ? 'Sveltia CMS' : /decap-cms/.test(adminHtml) ? 'Decap CMS' : '';
  const pinned = [...adminHtml.matchAll(/(?:@sveltia\/cms|decap-cms)@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  if (!known) {
    bad('/admin 引入了一个不认识的 CMS，检查一下 index.html');
  } else if (!pinned.length) {
    bad('/admin 的 ' + known + ' 地址没有锁版本（缺 @x.y.z）—— CDN 发新版可能改坏配置');
  } else {
    ok('/admin 从 CDN 加载 ' + known + '，版本已锁定：' + [...new Set(pinned)].join(' / '));
  }
} else {
  const cmsMatch = /<script[^>]*\bsrc=["']([^"']*sveltia[^"']*)["']/.exec(adminHtml);
  if (cmsMatch && existsSync(abs(cmsMatch[1].replace(/^\//, '')))) {
    ok('CMS 自托管在 ' + cmsMatch[1] + '（注意：大文件在弱网下容易被截断导致白屏）');
  } else {
    bad('admin/index.html 里找不到 CMS 的加载方式，后台会白屏');
  }
}

/* ---------------------------------------------------------------- 4. 首页分页 */
head('4. 首页首屏只渲染 10 篇 + 加载更多');
const cards = (indexHtml.match(/<article/g) || []).length;
if (cards === 10) ok('首屏正好 10 张卡片');
else if (cards < 10) ok('首屏 ' + cards + ' 张卡片（文章不足 10 篇）');
else bad('首屏渲染了 ' + cards + ' 张卡片，超过 10');

const apiFiles = walk('api', (p) => p.endsWith('.json'));
/* 公开文章不足一页时，本来就没有「下一页」，没有 JSON 是正确的 —— 所以按源码算出总数 */
const publicPostCount = readdirSync(join(ROOT, 'src/content/posts'))
  .filter((n) => n.endsWith('.md'))
  .filter((n) => {
    const raw = readFileSync(join(ROOT, 'src/content/posts', n), 'utf8');
    return !/^draft:\s*true\s*$/m.test(raw) && !isHiddenData(readHiddenKeys(raw));
  }).length;
if (apiFiles.length) {
  ok('加载更多用的静态 JSON ' + apiFiles.length + ' 个：' + apiFiles.join(', '));
  const j = JSON.parse(read(apiFiles[0]));
  if (j.html && j.html.includes('<article')) ok('JSON 里带着预渲染好的卡片 HTML（' + kb(Buffer.byteLength(j.html)) + '）');
  else bad('JSON 结构不对');
} else if (publicPostCount <= 10) {
  ok('公开文章 ' + publicPostCount + ' 篇，不到一页，本来就没有下一页（没有 api/posts/*.json 是正确的）');
  if (/id=["']?loadMore/.test(indexHtml)) wrn('没有下一页，但首页还有「加载更多」按钮的痕迹，确认一下它是不是隐藏的');
  else ok('没有下一页时，首页也不渲染「加载更多」按钮');
} else {
  bad('公开文章有 ' + publicPostCount + ' 篇（不止一页），却没有 api/posts/*.json，加载更多会失效');
}

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
/*
 * 期望值要按「实际会被排除的页面」算，别拍脑袋写 -2：
 * 排除 404、/admin/*、/private/*，以及隐藏文章。
 */
const sitemapExcluded = pages.filter((p) => {
  const norm = '/' + p.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '');
  if (norm === '/404') return true;
  if (/^\/(admin|private)(\/|$)/.test(norm)) return true;
  const m = /^\/posts\/([^/]+)\/?$/.exec(norm);
  if (m) {
    const srcDir = join(ROOT, 'src/content/posts');
    const file = m[1] + '.md';
    if (existsSync(join(srcDir, file))) {
      const raw = readFileSync(join(srcDir, file), 'utf8');
      if (/^draft:\s*true\s*$/m.test(raw) || isHiddenData(readHiddenKeys(raw))) return true;
    }
  }
  return false;
});
const expected = pages.length - sitemapExcluded.length;
if (urls >= expected) {
  ok('Sitemap 收录 ' + urls + ' 个 URL（共 ' + pages.length + ' 个页面，已排除 404 / /admin / /private / 隐藏文章等 ' + sitemapExcluded.length + ' 个）');
} else {
  wrn('Sitemap 只有 ' + urls + ' 个 URL，期望至少 ' + expected);
}

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

/* ---------------------------------------------------------------- 8. 隐藏文章 */
head('8. 隐藏文章（category: 日记 或 private: true）');
{
  const srcDir = join(ROOT, 'src/content/posts');
  const hidden = [];
  const visible = [];
  for (const f of readdirSync(srcDir).filter((n) => n.endsWith('.md'))) {
    const raw = readFileSync(join(srcDir, f), 'utf8');
    if (/^draft:\s*true\s*$/m.test(raw)) continue;
    const slug = f.replace(/\.md$/, '');
    (isHiddenData(readHiddenKeys(raw)) ? hidden : visible).push(slug);
  }

  if (!hidden.length) {
    ok('没有隐藏文章（分类「日记」或 private: true 会自动隐藏）');
  } else {
    const leaks = [];
    for (const slug of hidden) {
      const file = 'posts/' + slug + '/index.html';
      if (!existsSync(abs(file))) { bad('隐藏文章的页面没生成 —— 直接开链接也看不到了: ' + slug); continue; }
      const html = read(file);
      const art = (/<article[^>]*>/.exec(html) || [''])[0];
      if (art.includes('data-pagefind-body')) leaks.push(slug + ' 仍参与搜索索引');
      if (!html.includes('noindex')) leaks.push(slug + ' 缺少 noindex');
    }
    /* 所有「浏览入口」的产物里都不该出现隐藏文章的 slug */
    const surfaces = [
      ['首页', 'index.html'], ['归档', 'archive/index.html'], ['标签总览', 'tags/index.html'],
      ['RSS', 'rss.xml'], ['sitemap', 'sitemap-0.xml'],
      ...walk('api', (p) => p.endsWith('.json')).map((p) => ['分页 JSON', p]),
    ];
    for (const [label, file] of surfaces) {
      if (!existsSync(abs(file))) continue;
      const body = read(file);
      const hit = hidden.filter((s) => body.includes(s));
      if (hit.length) leaks.push(label + ' 里泄漏了: ' + hit.join(', '));
    }
    if (leaks.length) leaks.forEach((l) => bad('隐藏文章泄漏 —— ' + l));
    else {
      ok(hidden.length + ' 篇隐藏文章：页面在、noindex 在，搜索/列表/标签/RSS/sitemap 里都没有它们');
      console.log('      ' + hidden.join('、'));
      console.log('      （直接开 /posts/<slug>/ 仍能看 —— 纯静态站没有登录，这是设计如此）');
    }
  }
  ok('公开文章 ' + visible.length + ' 篇，搜索索引只应包含它们');
}

/* ---------------------------------------------------------------- 9. 站点 URL */
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
