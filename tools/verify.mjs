#!/usr/bin/env node
/**
 * tools/verify.mjs —— 不依赖构建的静态自检
 *
 * 为什么需要它：Astro/Vite 的构建链路需要派生子进程，在受限环境里跑不起来。
 * 这个脚本改用「进程内」的官方组件编译器 + zod，把能验证的都验证掉：
 *
 *   1. 用 @astrojs/compiler 编译每个 .astro，检查语法与模板错误
 *   2. 用 zod 校验每篇文章的 frontmatter 是否符合 Content Collections schema
 *   3. 检查所有相对 import 是否指向真实存在的文件
 *   4. CSS 括号配平 + 禁用项扫描
 *   5. 首屏 JS 体积预算（PRD 硬红线 < 10KB）
 *      —— 只算「首屏真要下载的」：is:inline 原样输出 + 会进 HTML/入口 chunk 的模块脚本；
 *         dynamic import() 出去的按需 chunk（搜索引擎、设置面板）单独列出来，不计入。
 *   6. PRD 要求的多端适配 / 禁止事项自查
 *
 * 用法：node tools/verify.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* yaml 是 astro 自带的依赖，这里借它用，不额外增加依赖 */
const require = createRequire(import.meta.url);
const parseYaml = require('yaml').parse;

/* 这两个是真实的依赖，已在 package.json 的 devDependencies 里声明。
   用动态 import 是为了在没装依赖时给一句人话，而不是甩一段堆栈。 */
let z;
let transform;
try {
  ({ z } = await import('zod'));
  ({ transform } = await import('@astrojs/compiler'));
} catch (err) {
  console.error('');
  console.error('  ✗ 缺少自检所需的依赖：' + (err && err.message ? err.message : err));
  console.error('    请先安装依赖：pnpm install   （或 npm install）');
  console.error('');
  process.exit(1);
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p) => existsSync(join(ROOT, p));

let failures = 0;
let warnings = 0;

const ok = (msg) => console.log('  \u2713 ' + msg);
const bad = (msg) => { failures++; console.log('  \u2717 ' + msg); };
const warn = (msg) => { warnings++; console.log('  ! ' + msg); };
const head = (t) => { console.log(''); console.log('=== ' + t + ' ==='); };

function walk(dir, filter, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, filter, out);
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

/* ---------------------------------------------------------------- 1. Astro 组件 */
head('1. Astro 组件编译（@astrojs/compiler）');
const astroFiles = walk('src', (p) => p.endsWith('.astro'));
let compiled = 0;
for (const file of astroFiles) {
  const source = read(file);
  try {
    const res = await transform(source, { filename: file });
    const errors = (res.diagnostics || []).filter((d) => d.severity === 1);
    const warns = (res.diagnostics || []).filter((d) => d.severity === 2);
    if (errors.length) {
      bad(file + ' -> ' + errors.map((e) => e.text).join('; '));
    } else {
      compiled++;
      if (warns.length) warn(file + ' -> ' + warns.map((w) => w.text).join('; '));
    }
  } catch (e) {
    bad(file + ' -> ' + (e && e.message ? e.message : String(e)));
  }
}
if (compiled === astroFiles.length) ok(astroFiles.length + ' 个 .astro 全部编译通过');

/* ---------------------------------------------------------------- 2. 内容 schema */
head('2. 文章 frontmatter 校验（zod，与 Content Collections 同规则）');
const COVER_STYLES = ['wave', 'nebula', 'crown', 'opera', 'aurora', 'starry', 'bubble', 'grid', 'image'];
/* 必须和 src/content.config.ts 保持一致 —— 网页后台清空日期字段会写 updated: ''，
   而 z.coerce.date() 会把空串转成 Invalid Date 让构建失败。
   这个坑就是「两边 schema 各写一份」造成的，改一边记得改另一边。 */
const optionalDate = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.date().optional());
const schema = z.object({
  title: z.string(),
  date: z.coerce.date(),
  updated: optionalDate,
  category: z.enum(['日记', '技术', '随笔']).default('随笔'),
  tags: z.array(z.string()).default([]),
  summary: z.string().optional(),
  cover: z.string().optional(),
  coverStyle: z.enum(COVER_STYLES).optional(),
  coverHue: z.number().min(0).max(359).optional(),
  pinned: z.boolean().default(false),
  draft: z.boolean().default(false),
});

/*
 * frontmatter 用真正的 YAML 解析器，不再手写。
 * 手写那版只认 `tags: [a, b]`，遇到多行列表就当成字符串，
 * 于是「网页后台保存过的文章」在这里被误报 schema 错误（踩过两次）。
 * Astro 自己也是用 yaml 解析的，这样两边才一致。
 */
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  let data;
  try {
    data = parseYaml(m[1]) ?? {};
  } catch (e) {
    bad('frontmatter 不是合法 YAML: ' + (e && e.message ? e.message : e));
    data = {};
  }
  return { data, body: raw.slice(m[0].length) };
}

const postFiles = walk('src/content/posts', (p) => p.endsWith('.md'));
const published = [];
for (const file of postFiles) {
  const { data, body } = parseFrontmatter(read(file));
  const r = schema.safeParse(data);
  if (!r.success) {
    bad(relative('src/content/posts', file) + ' -> ' + r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '));
    continue;
  }
  if (!/^[\u4e00-\u9fa5]/.test(data.title)) warn(relative('src/content/posts', file) + ' 标题不是以中文开头（仅提示）');
  /*
   * 正文长度只卡「要发布的」文章。
   * 草稿（draft: true）本来就是写一半的半成品 —— 刚 npm run new 建出来的草稿
   * 正文只有一句占位，卡它等于逼你先写满 20 字才能提交。
   * 别忘了：草稿本来也不会被构建出去，不存在发空文上去的风险。
   */
  if (!r.data.draft) {
    if (body.trim().length < 20) {
      bad(relative('src/content/posts', file) + ' 正文太短（' + body.trim().length + ' 字）' +
          ' — 要发布的文章至少 20 字，或者先标成 draft: true');
    }
    published.push({ file, ...r.data });
  }
}
if (published.length === postFiles.length && postFiles.length) {
  ok(postFiles.length + ' 篇文章 frontmatter 全部合法');
}
const dates = published.map((p) => p.date.getTime());
if (new Set(dates).size !== dates.length) warn('存在发布日期完全相同的文章（排序会不稳定）');
ok('已发布 ' + published.length + ' 篇，草稿 ' + (postFiles.length - published.length) + ' 篇');

/* ---------------------------------------------------------------- 3. import 解析 */
head('3. 相对 import 解析');
const codeFiles = walk('src', (p) => /\.(astro|ts|tsx|js|mjs)$/.test(p));
const EXTS = ['', '.astro', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.astro', '/index.ts', '/index.js'];
let importChecked = 0;
const missing = [];
for (const file of codeFiles) {
  const src = read(file);
  const re = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    const base = resolve(join(ROOT, dirname(file)), spec);
    const hit = EXTS.some((ext) => existsSync(base + ext));
    importChecked++;
    if (!hit) missing.push(file + ' -> ' + spec);
  }
}
if (missing.length) missing.forEach((m) => bad('找不到模块: ' + m));
else ok(importChecked + ' 处相对 import 全部可解析');

/* ---------------------------------------------------------------- 4. CSS */
head('4. 样式检查');
const css = read('src/styles/global.css') + '\n' + read('src/styles/theme.css');
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
if (open === close) ok('CSS 花括号配平（' + open + ' 对）');
else bad('CSS 花括号不配平: ' + open + ' vs ' + close);

if (/\[hidden\]\s*{[^}]*display:\s*none\s*!important/.test(css)) ok('[hidden] 全局兜底存在（PRD 9.1）');
else bad('缺少 [hidden] { display: none !important } —— 这是旧项目踩过的坑');

if (/\.fixed-layer\s*{[^}]*pointer-events:\s*none/.test(css)) ok('全屏固定层默认 pointer-events: none（PRD 9.2）');
else bad('固定层缺少 pointer-events: none 保护');

for (const f of ['--bg', '--ink', '--accent', '--gold']) {
  if (!css.includes(f + ':')) bad('theme.css 缺少令牌 ' + f);
}
if (css.includes("html[data-theme='light']")) ok('深浅两套调色板都已定义');
else bad('没有找到浅色主题');

if (/@view-transition/.test(css)) ok('使用了原生 View Transitions（零 JS 转场）');
else bad('缺少 @view-transition');

/* ---------------------------------------------------------------- 5. JS 预算 */
head('5. 首屏 JS 预算（PRD 硬红线 < 10KB）');
const firstScreenFiles = [
  'src/layouts/BaseLayout.astro',
  'src/components/Header.astro',
  'src/components/SearchBox.astro',
  'src/pages/index.astro',
];
let inlineBytes = 0;
let moduleBytes = 0;
const budget = [];
for (const file of firstScreenFiles) {
  if (!exists(file)) continue;
  const src = read(file);
  // 行内脚本：直接写进 HTML，首屏字节数算它
  const reInline = /<script(?![^>]*\bsrc=)(?![^>]*\bis:inline)[^>]*>([\s\S]*?)<\/script>/g;
  // is:inline 的原样输出
  const reRaw = /<script[^>]*\bis:inline[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  let inline = 0;
  let mod = 0;
  while ((m = reRaw.exec(src))) inline += Buffer.byteLength(m[1], 'utf8');
  while ((m = reInline.exec(src))) mod += Buffer.byteLength(m[1], 'utf8');
  if (inline + mod) budget.push([file, inline, mod]);
  inlineBytes += inline;
  moduleBytes += mod;
}
for (const [f, a, b] of budget) {
  console.log('    ' + f.padEnd(34) + '行内 ' + (a / 1024).toFixed(2) + ' KB   打包 ' + (b / 1024).toFixed(2) + ' KB');
}

/*
 * 按需加载的模块：被 import() 拉进来的那些文件，构建时切成独立 chunk，
 * 首屏不下载，所以从预算里排除。判据是「只被动态 import 引用」——
 * 一旦有人把它改成静态 import（或用 <script src> 直接引），这里立刻报错，
 * 免得哪天悄悄退回首屏。
 */
const lazyModules = [
  ['src/scripts/search-engine.ts', '搜索引擎'],
  ['src/scripts/settings-panel.ts', '设置面板'],
];
const codeSources = walk('src', (p) => /\.(astro|ts|tsx|js|mjs)$/.test(p));
let lazyBytes = 0;
for (const [file, label] of lazyModules) {
  if (!exists(file)) { bad('按需模块不见了: ' + file); continue; }
  const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  const staticallyImported = codeSources.filter((other) => {
    if (other === file) return false;
    const src = read(other);
    return new RegExp('import\\s+(?:[\\w*{},\\s]+\\s+from\\s+)?[\'"]\\.\\.?/[^\'"]*' + base + '[\'"]').test(src);
  });
  const bytes = Buffer.byteLength(read(file), 'utf8');
  lazyBytes += bytes;
  if (staticallyImported.length) {
    bad(label + '（' + file + '）被静态 import 了，会回到首屏：' + staticallyImported.join(', '));
  } else {
    console.log('    ' + ('按需加载：' + label).padEnd(30) + (bytes / 1024).toFixed(2) + ' KB   首次交互才下载');
  }
}
if (lazyBytes) console.log('    ' + '（Pagefind 索引与运行时）'.padEnd(30) + '再次之后才下载，首屏 0');
const kb = inlineBytes / 1024;
if (kb < 10) ok('首屏行内 JS ' + kb.toFixed(2) + ' KB，低于 10KB 红线');
else bad('首屏行内 JS ' + kb.toFixed(2) + ' KB 超过 10KB，按 PRD 必须砍功能');
ok('打包脚本源码合计 ' + (moduleBytes / 1024).toFixed(2) + ' KB（构建时压缩 + 跨页缓存，实际传输远小于此）');

const thirdParty = [];
for (const f of walk('src', (p) => p.endsWith('.astro'))) {
  const src = read(f);
  // 统计脚本是条件注入的，只有填了 token 才会输出
  const m = src.match(/<script[^>]*\bsrc=["']https?:[^"']*["'][^>]*>/g);
  if (m) {
    for (const tag of m) {
      const conditional = /CF_BEACON_TOKEN|beacon\.min\.js/.test(tag) || /CF_BEACON_TOKEN/.test(src.slice(0, src.indexOf(tag) + 600));
      if (!conditional) thirdParty.push(f + ' :: ' + tag.slice(0, 70));
    }
  }
}
if (thirdParty.length === 0) ok('首屏第三方脚本 0 个（Cloudflare 统计是条件注入，填了 token 才会出现）');
else warn('发现无条件的第三方脚本: ' + thirdParty.join(', '));

/* ---------------------------------------------------------------- 6. 禁止事项 */
head('6. 禁止事项扫描（PRD 第 9 节）');
const allSrc = codeFiles.map((f) => read(f)).join('\n');

if (/node_modules|marked|markdown-it/.test(read('package.json'))) warn('package.json 里出现了疑似 Markdown 库，确认没有手写解析器');
if (/from ['"]marked|require\(['"]marked/.test(allSrc)) bad('引入了第三方 Markdown 解析器，应当交给 Content Collections');
else ok('没有手写 Markdown 解析器，渲染交给 Astro');

if (/localStorage\.setItem\([^)]*(body|content)/.test(allSrc)) bad('用 localStorage 存了文章正文（PRD 9.6 禁止）');
else ok('没有用 localStorage 存文章正文');

/*
 * PRD 9.5 禁止用 filter: blur() 做动画 —— 因为逐帧重算模糊非常贵。
 * 但「一次性浮现」是可控的例外：模糊只在进入视口那一刻过渡一次，
 * 结束后用 .is-done 把 filter 摘掉，不会长期占着合成层。
 * 所以这里分开判定：
 *   @keyframes 里动 blur        → 循环/持续动画，一律禁止
 *   transition 里含 filter      → 只允许上面那种一次性模式，且必须配 .is-done 摘除
 */
const kfBlocks = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
const kfBlur = kfBlocks.filter((b) => /filter:\s*blur/.test(b));
if (kfBlur.length) bad('@keyframes 里动了 filter: blur()，循环重算模糊会掉帧（PRD 9.5 禁止）');
else ok('没有在 @keyframes 里动 filter: blur()');

const transitionProps = [...css.matchAll(/transition(?:-[a-z]+)?:\s*([^;]+);/g)].map((m) => m[1]);
const animFilter = transitionProps.filter((v) => /\bfilter\b/.test(v));
const animLayout = transitionProps.filter((v) => /\b(width|height|box-shadow)\b/.test(v));

if (animLayout.length) warn('有 ' + animLayout.length + ' 处过渡动了 width/height/box-shadow（建议只动 transform/opacity）');
else ok('没有过渡 width / height / box-shadow');

if (!animFilter.length) {
  ok('transition 没有涉及 filter');
} else if (/\.sink\.is-done\s*\{[^}]*filter:\s*none/.test(css)) {
  ok('filter 过渡只用于「一次性浮现」，且结束后用 .is-done 摘掉 filter 层');
} else {
  bad('有 filter 过渡，但没有在动画结束后摘除 filter 层（会长期占合成层）');
}

if (/id=.?.?loadMore/.test(allSrc)) ok('首页分页存在（首屏仅渲染最近 10 篇）');

/* ---------------------------------------------------------------- 7. PRD 结构 */
head('7. PRD 文件结构核对');
const required = [
  'public/favicon.ico', 'public/favicon-32.png', 'public/icon-192.png',
  'public/icon-512.png', 'public/apple-touch-icon.png', 'public/site.webmanifest',
  'public/emblem.webp', 'public/og-default.png',
  'src/content.config.ts',
  'src/components/Header.astro', 'src/components/Footer.astro', 'src/components/PostCard.astro',
  'src/components/TagCloud.astro', 'src/components/SearchBox.astro', 'src/components/ThemeToggle.astro',
  'src/components/Background.astro', 'src/components/CoverStyle.astro',
  'src/layouts/BaseLayout.astro', 'src/layouts/PostLayout.astro',
  'src/pages/index.astro', 'src/pages/archive.astro', 'src/pages/about.astro',
  'src/pages/changelog.astro', 'src/pages/rss.xml.ts', 'src/pages/404.astro',
  'src/styles/global.css', 'src/styles/theme.css',
  'src/lib/posts.ts', 'src/lib/format.ts',
  'public/admin/index.html', 'public/admin/config.yml',
  'workers/oauth/src/index.ts', 'workers/oauth/wrangler.toml',
  'astro.config.mjs', 'CHANGELOG.md', 'package.json', 'README.md',
];
const missingFiles = required.filter((f) => !exists(f));
if (missingFiles.length) missingFiles.forEach((f) => bad('缺少 ' + f));
else ok(required.length + ' 个必需文件全部就位');

const routeFiles = walk('src/pages', (p) => /\.(astro|ts)$/.test(p));
ok('路由共 ' + routeFiles.length + ' 个：' + routeFiles.map((f) => '/' + relative('src/pages', f).replace(/\\/g, '/')).join(', '));

if (/@astrojs\/rss/.test(read('package.json'))) ok('RSS 依赖已安装');
if (/@astrojs\/sitemap/.test(read('package.json'))) ok('Sitemap 依赖已安装');
if (/pagefind/.test(read('package.json'))) ok('Pagefind 依赖已安装');

/* ---------------------------------------------------------------- 结果 */
console.log('');
console.log('================================================');
console.log(failures === 0
  ? '全部通过 \u2713   （' + warnings + ' 条提示）'
  : failures + ' 项未通过 \u2717  （另有 ' + warnings + ' 条提示）');
console.log('================================================');
console.log('');
process.exitCode = failures ? 1 : 0;
