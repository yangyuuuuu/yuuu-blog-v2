/**
 * tools/smoke-search.mjs —— 搜索按需加载的「运行时」冒烟测试
 *
 * verify/audit 只能证明「引擎不在首屏、chunk 切出来了」，
 * 证明不了「用户聚焦之后它真的能跑」。这里用一个极小的 DOM 假件
 * 把 dist 里真实的按需 chunk 跑起来，检查：
 *   1. 模块能 import，init() 幂等（重复调用不会把监听装两遍）
 *   2. 第一次输入会被补跑（模块是按下第一个键之后才下载的）
 *   3. 真实搜索流程：渲染结果、上下键选择、清空、Esc、Ctrl+K、「/」
 *   4. 索引缺失时走诊断分支（npm run dev 下最常见的坑）
 *
 * 不需要浏览器，也不需要联网。
 * 用法：npm run build 之后跑 node tools/smoke-search.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let fail = 0;
const ok = (m) => console.log('  \u2713 ' + m);
const bad = (m) => { fail++; console.log('  \u2717 ' + m); };
const head = (t) => { console.log(''); console.log('=== ' + t + ' ==='); };
const CACHE = join(ROOT, 'node_modules/.cache/yuuu-smoke');
mkdirSync(CACHE, { recursive: true });

/* ---------------------------------------------------------------- 假 DOM */
function el(id, tag = 'DIV') {
  return {
    id, tagName: tag, value: '', dataset: {}, style: {}, hidden: false,
    innerHTML: '', textContent: '', href: '', isContentEditable: false,
    listeners: {}, attrs: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatch(type, ev = {}) { (this.listeners[type] || []).forEach((fn) => fn({ target: this, preventDefault() {}, ...ev })); },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = v; },
    contains() { return false; },
    querySelectorAll(sel) { return sel === '.search-hit' ? this.hits : []; },
    getBoundingClientRect() { return { top: 0, bottom: 0 }; },
    scrollIntoView() {},
    focus() { this.dispatch('focus'); },
    select() { this.selected = true; },
    blur() { this.dispatch('blur'); },
  };
}

function makeEnv() {
  const nodes = {
    searchRoot: el('searchRoot'),
    yuuuSearch: el('yuuuSearch', 'INPUT'),
    yuuuSearchPanel: el('yuuuSearchPanel'),
    yuuuSearchResults: el('yuuuSearchResults'),
    yuuuSearchClear: el('yuuuSearchClear', 'BUTTON'),
  };
  nodes.yuuuSearchPanel.hidden = true;
  nodes.yuuuSearchClear.hidden = true;
  nodes.yuuuSearchResults.hits = [];
  nodes.searchRoot.contains = (t) => Object.values(nodes).includes(t);

  const doc = { listeners: {} };
  globalThis.document = {
    documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
    getElementById: (id) => nodes[id] || null,
    addEventListener: (t, fn) => { (doc.listeners[t] ||= []).push(fn); },
    querySelectorAll: () => [],
    createElement: () => el('tmp'),
  };
  globalThis.window = globalThis;
  globalThis.location = { href: 'http://localhost/', hash: '' };
  return { nodes, doc };
}

/** 把 dist 里真实的 chunk 就地改造成 Node 能 import 的文件：
 *  preload-helper 换成桩，pagefind 指到本地假件 */
function prepare(env, name, { breakPagefind = false } = {}) {
  const dir = join(ROOT, 'dist/_astro');
  const file = readdirSync(dir).find((f) => /search-engine.*\.js$/.test(f));
  if (!file) throw new Error('dist/_astro 里没有 search-engine chunk，先 npm run build');
  let code = readFileSync(join(dir, file), 'utf8');

  const before = code;
  code = code.replace(/import\{([^}]+)\}from"\.\/preload-helper[^"]*";/, (_m, spec) => {
    const local = spec.split(' as ').pop().trim();
    return 'const ' + local + ' = (dep) => Promise.resolve(dep());';
  });
  if (code === before) throw new Error('没能替换 preload-helper 依赖，产物结构变了');

  /*
   * 引擎里那句 import('pagefind.js') 是构建时故意留着的运行时路径（/* @vite-ignore *\/），
   * Node 不认 —— 换成同一个目录下真实存在的文件：
   *   正常路径 → 假 Pagefind；诊断路径 → 一个不存在的文件名（触发 catch）。
   */
  const pf = breakPagefind ? 'yuuu-smoke-missing.mjs' : 'yuuu-smoke-pagefind.mjs';

  const beforePf = code;
  // 压缩器可能把字符串字面量换成反引号，两种都认；引号里的路径原样留着（下面按变量名找）
  const literal = [/["'`]\/pagefind\/pagefind\.js["'`]/, /(["'`])(\/pagefind\/pagefind\.js)\1/]
    .map((re) => re.exec(code)).find(Boolean);
  if (!literal) throw new Error('chunk 里没找到 pagefind 路径，产物结构变了');
  const original = literal[2] || literal[0].replace(/["'`]/g, '');
  code = code.split(original).join('./' + pf);

  // 找到真正的那句 import(...)，确认它用的是常量还是被压缩成变量了
  const importRe = /import\((?:"([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z_$][\w$]*))\)/g;
  let m, found = null;
  while ((m = importRe.exec(code))) found = m;
  if (!found) throw new Error('chunk 里没找到动态 import，产物结构变了');
  env.dynamicImport = found[1] || found[2] || found[3] || ('变量 ' + found[4] + ' = ' + './' + pf);
  if (code === beforePf) throw new Error('没能改写 pagefind 路径，产物结构变了');

  const out = join(CACHE, name + '.mjs');
  writeFileSync(out, code);
  return 'file:///' + out.replace(/\\/g, '/');
}

/* ---------------------------------------------------------------- 假 Pagefind */
writeFileSync(join(CACHE, 'yuuu-smoke-pagefind.mjs'), `export async function options() {}
export async function init() {}
export const calls = [];
const DOCS = [
  { url: '/posts/2024-06-18-furina-and-theatre/', excerpt: '芙宁娜在<mark>歌剧院</mark>的那场演出。',
    meta: { title: '芙宁娜与歌剧院', date: '2024-06-18', dateText: '2024-06-18', tags: '原神,随笔', category: '随笔', words: '1200', minutes: '4' } },
  { url: '/posts/2024-05-20-hello-fontaine/', excerpt: '第一篇文章，写给<mark>枫丹</mark>的午后。',
    meta: { title: '你好，枫丹', date: '2024-05-20', dateText: '2024-05-20', tags: '开始,随笔', category: '随笔', words: '800', minutes: '3' } },
  { url: '/posts/2024-09-14-pagefind-search/', excerpt: 'Pagefind 的静态索引与<mark>中文</mark>分词问题。',
    meta: { title: 'Pagefind 与中文搜索', date: '2024-09-14', dateText: '2024-09-14', tags: '搜索,性能', category: '技术', words: '2400', minutes: '9' } },
];
export async function search(term, opts) {
  calls.push([term, opts]);
  return { results: DOCS.map((d) => ({ data: async () => d })) };
}
`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hitNodes = () => [0, 1, 2].map((i) => ({
  href: '', classList: { toggle() {}, add() {}, remove() {} },
  getBoundingClientRect: () => ({ top: 0, bottom: 0 }), scrollIntoView() {},
}));

/* ================================================================ 正常路径 */
head('1. 正常路径：真实按需 chunk + 假 Pagefind');
{
  const env = makeEnv();
  const { nodes, doc } = env;
  const url = prepare(env, 'engine-ok');
  ok('索引路径按需加载：import(' + env.dynamicImport + ') —— 首屏不碰它');
  const mod = await import(url + '?v=ok');
  ok('dist 里的 search-engine chunk 可直接 import，导出 init(): ' + (typeof mod.init === 'function'));

  mod.init();
  mod.init();
  const inputEvents = ['focus', 'blur', 'input', 'keydown'].filter((t) => nodes.yuuuSearch.listeners[t]);
  ok('输入框装了 ' + inputEvents.length + ' 类监听：' + inputEvents.join(' / '));
  if ((nodes.yuuuSearch.listeners.input || []).length === 1) ok('重复 init() 没把监听装两遍（幂等）');
  else bad('input 监听数量异常：' + (nodes.yuuuSearch.listeners.input || []).length);
  if ((doc.listeners.keydown || []).length) ok('全局键盘监听已装（Esc / Ctrl+K /「/」）');
  else bad('没装全局键盘监听');

  head('2. 第一次输入被补跑（模块是按下第一个键之后才下载的）');
  nodes.yuuuSearch.value = '芙宁娜';
  nodes.yuuuSearch.dispatch('focus');
  await wait(450);
  if (nodes.yuuuSearchPanel.hidden === false) ok('面板已展开');
  else bad('面板没展开 —— 用户敲的字被吞了');
  const html = nodes.yuuuSearchResults.innerHTML;
  if (html.includes('class="search-hit"')) ok('结果渲染出来了（' + (html.match(/search-hit"/g) || []).length + ' 条）');
  else bad('没有渲染结果：' + html.slice(0, 90));
  if (html.includes('search-foot')) ok('底部键盘提示已渲染（↑↓ / Enter / Esc）');
  else bad('缺少底部键盘提示');
  if (html.includes('?q=')) ok('结果链接带着 ?q= 关键词（文章页高亮用）');
  else bad('结果链接没带 ?q=');

  head('3. 交互');
  nodes.yuuuSearchResults.hits = hitNodes();
  const safe = (label, fn) => {
    try { const r = fn(); ok(label); return r; } catch (e) { bad(label + ' -> ' + e.message); }
  };
  safe('↓ 选中第一条', () => nodes.yuuuSearch.dispatch('keydown', { key: 'ArrowDown' }));
  safe('↑ 选中最后一条', () => nodes.yuuuSearch.dispatch('keydown', { key: 'ArrowUp' }));
  safe('Enter 打开当前项', () => nodes.yuuuSearch.dispatch('keydown', { key: 'Enter' }));
  safe('输入触发防抖搜索', () => { nodes.yuuuSearch.value = 'tag:技术'; nodes.yuuuSearch.dispatch('input'); });
  await wait(300);
  if (nodes.yuuuSearchResults.innerHTML.includes('search-chips')) ok('筛选条件标签渲染出来了（tag:技术）');
  else bad('筛选条件标签没渲染：' + nodes.yuuuSearchResults.innerHTML.slice(0, 80));
  safe('Ctrl+K 唤出', () => (doc.listeners.keydown || []).forEach((fn) => fn({ key: 'k', ctrlKey: true, target: { tagName: 'BODY' }, preventDefault() {} })));
  if (nodes.yuuuSearch.selected) ok('Ctrl+K 之后输入框被选中（直接覆盖输入）');
  else bad('Ctrl+K 没有选中输入框');
  safe('「/」唤出', () => (doc.listeners.keydown || []).forEach((fn) => fn({ key: '/', target: { tagName: 'BODY' }, preventDefault() {} })));
  safe('Esc 收起', () => (doc.listeners.keydown || []).forEach((fn) => fn({ key: 'Escape', target: nodes.yuuuSearch })));
  if (nodes.yuuuSearchPanel.hidden === true) ok('Esc 之后面板收起');
  else bad('Esc 没收起面板');
  safe('清空按钮', () => nodes.yuuuSearchClear.dispatch('click'));
  if (nodes.yuuuSearch.value === '' && nodes.yuuuSearchClear.hidden === true) ok('清空按钮清掉了输入');
  else bad('清空按钮没生效');
  safe('blur 不炸', () => nodes.yuuuSearch.dispatch('blur'));
}

/* ================================================================ 索引缺失 */
head('4. 索引缺失（npm run dev 下最常见的坑）走诊断分支');
{
  const env = makeEnv();
  const { nodes } = env;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const url = prepare(env, 'engine-nopagefind', { breakPagefind: true });
  const mod = await import(url + '?v=nopf');
  mod.init();
  nodes.yuuuSearch.value = '芙宁娜';
  nodes.yuuuSearch.dispatch('focus');
  await wait(450);
  const html = nodes.yuuuSearchResults.innerHTML;
  if (html.includes('npm run dev') && html.includes('npm run preview')) {
    ok('给出的是「要 build + preview」的正确建议，而不是干巴巴的报错');
  } else bad('诊断文案不对：' + html.replace(/<[^>]+>/g, ' ').slice(0, 120));
}

/* ================================================================ 加载顺序 */
head('5. 其他页面脚本要能等到引导脚本（搜索指南页会填值 + 派发 input）');
{
  const html = readFileSync(join(ROOT, 'dist/search-guide/index.html'), 'utf8');
  const bootAt = html.indexOf('SearchBox.astro_astro_type_script');
  const guide = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => [m.index, m[1]])
    .filter(([, s]) => s.includes('yuuuSearch') && !s.includes('search-engine'));
  if (bootAt < 0) bad('搜索指南页里没有引导脚本，搜索引擎永远不会加载');
  else if (!guide.length) bad('搜索指南页里没找到填值的脚本');
  else {
    const [guideAt] = guide[0];
    if (guideAt > bootAt) {
      ok('引导脚本排在填值脚本前面（相隔 ' + (guideAt - bootAt) + ' 字节）—— 指南页派发的 input 事件有人接');
    } else bad('引导脚本排在填值脚本后面，指南页点例子会搜不出来');
  }
  if (html.includes('yuuuSearchPanel')) ok('搜索指南页带着完整搜索框（引导按需拉引擎）');
  else bad('搜索指南页缺搜索框');
}

console.log('');
console.log('================================================');
console.log(fail === 0 ? '搜索运行时冒烟测试通过 \u2713' : fail + ' 项未通过 \u2717');
console.log('================================================');
console.log('');
process.exitCode = fail ? 1 : 0;
