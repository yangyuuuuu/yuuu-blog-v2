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
import { slugify } from '../src/lib/slug.ts';
/* 私人角落的排序规则：拿真实清单跑，确认三种排序真的给出三种结果 */
import { orderOf, sortPosts } from '../src/lib/sort-posts.ts';

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
/*
 * 首屏行内 JS 预算。
 *
 * PRD 定的红线是 10 KB。2026-09-19 站主明确放宽到 12 KB：
 * 「超了 10KB 没事，体验好就行了」—— 起因是「明暗随时间自动切换」
 * 需要在首屏绘制前算好主题（否则会闪一下另一种颜色），
 * 只能放在 is:inline 脚本里，省不掉。
 *
 * 所以这个检查**保留**，但阈值改成 12 KB：
 * 它的作用从「守死红线」变成「防止以后失控膨胀」——
 * 首屏行内 JS 每多一 KB 都是用户每次打开页面都要下载并解析的字节。
 * 再加东西前先看看这里还剩多少。
 */
const INLINE_BUDGET = 12 * 1024;
head('2. 首屏 JS 预算（站主放宽到 < 12KB，原 PRD 红线 10KB）');
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
if (inline < INLINE_BUDGET) ok('首屏行内 JS ' + kb(inline) + ' < 12 KB');
else bad('首屏行内 JS ' + kb(inline) + ' 超过 12 KB');
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
    /* 用共享的 slug 规则 —— 直接拿文件名会在带点/大写的文件名上出错 */
    const slug = slugify(f);
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

/* ------------------------------------------------- 8.5 私人角落的三种排序 */
head('8.5 私人角落排序：三种模式必须真的给出三种顺序');
{
  const manifestPath = join(DIST, 'private', 'posts.json');
  if (!existsSync(manifestPath)) {
    bad('没有 dist/private/posts.json（npm run build 最后一步会生成它）');
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const posts = manifest.posts || [];
    if (posts.length < 3) {
      console.log('  只 ' + posts.length + ' 篇隐藏文章，跳过（三种排序至少要 3 篇才谈得上区分）');
    } else {
      const modes = ['date-desc', 'date-asc', 'updated-desc'];
      const orders = {};
      for (const m of modes) orders[m] = orderOf(posts, m);
      const uniq = new Set(modes.map((m) => orders[m]));
      /*
       * 这条是给「切换排序看起来没反应」兜底的。
       * 最容易撞车的是「最近修改」和「最新发布」：updated 只到「天」，
       * 一天里改过好几篇就全一样了 —— 所以清单里还有 touches 做同天时的次要依据。
       */
      if (uniq.size === modes.length) {
        ok('三种排序两两不同（' + posts.length + ' 篇隐藏文章）');
        for (const m of modes) console.log('      ' + m.padEnd(13) + ' ' + orders[m]);
      } else {
        for (const m of modes) console.log('      ' + m.padEnd(13) + ' ' + orders[m]);
        bad('有排序模式给出了相同顺序（切换会像没反应）—— 看上面对比');
      }
      /* 清单里每条都要有 touches，页面同天排序靠它 */
      const noTouch = posts.filter((x) => typeof x.touches !== 'number');
      if (noTouch.length) bad('清单里缺 touches 字段：' + noTouch.map((x) => x.title).join('、'));
      else ok('清单每条都带 touches（同日排序的次要依据）');
      /* 排序结果必须只是重排，不能丢条目或重复 */
      for (const m of modes) {
        const got = sortPosts(posts, m);
        if (got.length !== posts.length) bad(m + ' 排序后条数变了：' + got.length + ' ≠ ' + posts.length);
        else if (new Set(got.map((x) => x.url)).size !== posts.length) bad(m + ' 排序后有重复条目');
      }
      ok('三种排序都只是重排，不丢条目、不重复');
    }
  }
}

/* --------------------------------- 8.55 公开目录里不许放敏感内容 */
head('8.55 公开目录里不许出现正文 / 草稿 / 隐藏文章的内容');
{
  /*
   * 血泪教训：我一度把「后台搜索索引」生成到 dist/private/ 下，
   * 那个目录是**静态托管**的 —— 任何人访问 /private/posts-index.json
   * 都能拿到全部正文（含草稿和隐藏文章）。而「私人角落」那两份清单
   * 靠的是 Worker 的口令门槛，不是文件藏得深。
   *
   * 所以规矩是：**凡是含正文/草稿内容的文件，一律不能出现在 dist 里**，
   * 只能存在 KV（由 Worker 凭 ticket 提供）。
   */
  const privDir = join(DIST, 'private');
  if (existsSync(privDir)) {
    const files = readdirSync(privDir);
    /* 只认「像正文索引」的名字 —— 别把 index.html（私人角落的登录页）也算进去 */
    const banned = files.filter((f) => /(index|full|content|body|draft)[^.]*\.json$/i.test(f));
    if (banned.length) {
      banned.forEach((f) => bad('dist/private/' + f + ' 像正文索引 —— 这个目录是公开的，全文只能放 KV'));
    } else {
      ok('dist/private 下只有元信息清单（' + files.length + ' 个文件，无全文索引）');
    }
    /*
     * 逐篇检查公开清单里带了多长的正文。这里的经验值：
     * 摘要最多几百字，所以单篇 > 600 字、或整份合计 > 3000 字，就说明混进了正文。
     */
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const data = JSON.parse(readFileSync(join(privDir, f), 'utf8'));
      const list = data.posts || [];
      const longest = list.reduce((m, p) => Math.max(m, typeof p.text === 'string' ? p.text.length : 0), 0);
      const total = list.reduce((s, p) => s + (typeof p.text === 'string' ? p.text.length : 0), 0);
      if (longest > 600 || total > 3000) {
        bad('dist/private/' + f + ' 疑似含正文（单篇最长 ' + longest + ' 字，合计 ' + total + ' 字）—— 这是公开文件');
      } else {
        ok('dist/private/' + f + '：' + list.length + ' 篇，正文累计 ' + total + ' 字（都是摘要级）');
      }
    }
  } else {
    ok('没有 dist/private 目录');
  }
}

/* ------------------------------------------- 8.65 slug 规则必须与 Astro 完全一致 */
head('8.65 slug 规则：全部文章逐个与产物目录对账');
{
  /*
   * ★ 这条是补一个**真实发生过的漏洞**。
   *
   * 8.6 只检查「清单里的 URL 能不能打开」—— 清单和站点地图都用的是我们自己的
   * slugify，所以它俩一致时 8.6 永远是绿的；但**页面路径其实是 Astro 生成的**。
   * 两者规则不一致时，表现是「用户从私人角落点文章 → 404」。
   *
   * 实例：2026-09-20-恭喜自己，终于脱贫啦！.md
   *   Astro：标点【删掉】 → /posts/2026-09-20-恭喜自己终于脱贫啦/
   *   我们：标点【换成 -】→ /posts/2026-09-20-恭喜自己-终于脱贫啦/  (404)
   * 上次对账只挑了 2026-09-18-SEP.-26 一个样本，而那一条恰好两种规则结果相同
   * （那个点后面本来就跟着 -），于是漏了。
   *
   * 所以这里改成**集合比较**：每个 .md 文件名过一遍 slugify，
   * 结果必须恰好是 dist/posts 下的一组目录名。一篇对不上就报错。
   */
  const postFiles = readdirSync(join(ROOT, 'src/content/posts')).filter((f) => f.endsWith('.md'));
  const distSlugs = new Set(readdirSync(join(DIST, 'posts')));
  const missing = [];
  for (const f of postFiles) {
    const s = slugify(f);
    if (!distSlugs.has(s)) missing.push(f + ' → ' + s);
  }
  if (missing.length) {
    missing.slice(0, 5).forEach((m) => bad('slug 规则与 Astro 不一致：' + m));
    bad('（Astro 会把标点删掉，我们如果换成 - 就会差一个字符 —— 见 src/lib/slug.ts 的说明）');
  } else {
    ok(postFiles.length + ' 篇文章的 slug 与产物目录逐个对上');
  }
}

/* ------------------------------------------- 8.7 受口令保护的页面不许泄漏内容 */
head('8.7 日记页 / 私人角落的公开 HTML 里不能有文章标题');
{
  /*
   * ★ 这两页的隐私**全靠「公开的只是个空壳」**。
   * 一旦有人手滑把文章列表渲染进静态 HTML（比如把 getStaticPaths 当成普通列表页用），
   * 标题就进了公开可下载的文件，口令形同虚设 —— 而且从页面上看不出任何异常。
   * 所以这里拿**全部文章的标题**去 grep 这两页的产物，一个都不许命中。
   */
  const allPath = join(DIST, 'private', 'posts-all.json');
  if (!existsSync(allPath)) {
    bad('缺少 private/posts-all.json，无法做泄漏检查');
  } else {
    const titles = (JSON.parse(readFileSync(allPath, 'utf8')).posts || [])
      .map((p) => String(p.title || '').trim())
      .filter((t) => t.length >= 3);   /* 太短的容易误伤（比如「嗯」） */
    for (const page of ['diary/index.html', 'private/index.html']) {
      const abs = join(DIST, page);
      if (!existsSync(abs)) { bad('缺少 ' + page); continue; }
      const html = readFileSync(abs, 'utf8');
      const leaked = titles.filter((t) => html.indexOf(t) >= 0);
      if (leaked.length) {
        leaked.slice(0, 3).forEach((t) => bad(page + ' 的公开 HTML 里出现了文章标题：' + t));
      } else {
        ok(page + '：' + titles.length + ' 个标题一个都没泄漏');
      }
    }
  }
}

/* ------------------------------------------- 8.6 清单里的 URL 必须能打开 */
head('8.6 清单 URL 与产物对照（点开不能 404）');
{
  /*
   * 为什么专测这个：清单里的 url 是**构建脚本自己拼**的，而页面路径是 **Astro 生成**的，
   * 两套规则一旦不一致（比如文件名里有个点：SEP.-26.md → Astro 出 sep-26，
   * 脚本拼成 SEP.-26），页面本身是对的、但清单里的链接全是 404 ——
   * 私人角落和手机写作页点开就打不开，而且很难想到是这个原因。
   */
  for (const [name, file] of [['隐藏文章清单', 'private/posts.json'], ['手机写作页清单', 'private/posts-all.json']]) {
    const abs = join(DIST, file);
    if (!existsSync(abs)) { bad('缺少 ' + file); continue; }
    const data = JSON.parse(readFileSync(abs, 'utf8'));
    const posts = data.posts || [];
    const broken = posts.filter((p) => {
      const slug = p.url ? String(p.url).replace(/^\/posts\//, '').replace(/\/$/, '') : p.slug;
      return !existsSync(join(DIST, 'posts', slug, 'index.html'));
    });
    if (broken.length) {
      broken.slice(0, 5).forEach((p) => bad(name + '里的链接打不开：' + (p.url || p.slug) + '（' + p.title + '）'));
    } else {
      ok(name + '：' + posts.length + ' 条的 URL 都能对上产物目录');
    }
  }
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
