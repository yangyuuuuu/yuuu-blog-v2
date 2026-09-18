/**
 * 排序下拉链路检查 —— 组件脚本 + private 页面脚本一起放进假 DOM 跑。
 *
 * 为什么需要它：主页和私人角落的排序分两半，一半在 SortSelect 组件（画下拉、
 * 把选中值写回隐藏的 <select>、派发 change），另一半在页面脚本（接住 change
 * 重排列表）。只测其中一半会漏掉「值变了但列表没动」这种断线 —— 2026-09 私人
 * 角落就栽在这里：组件一切正常，页面压根没监听 change。
 *
 * 链路：点选项 → select.value 变 → change → 页面 render() 重排。
 * 跑法：先 npm run build，再 node tools/check-sort-link.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

/* ---------- 假 DOM ---------- */
function mk(tag, attrs = {}) {
  const node = {
    tagName: tag.toUpperCase(), attrs, dataset: {}, children: [], listeners: {},
    hidden: false, _html: '', _text: '', style: { cssText: '', setProperty() {} },
    _value: attrs.value || '',
    get value() { return this._value; },
    set value(v) { this._value = v; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; },
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false,
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    contains(n) { return this.children.includes(n); },
    closest(sel) { return this._matchSelf(sel) ? this : (this.parentNode ? this.parentNode.closest?.(sel) : null); },
    _matchSelf(sel) {
      if (sel.startsWith('.')) return (this.attrs.class || '').split(/\s+/).includes(sel.slice(1));
      if (sel.startsWith('#')) return this.attrs.id === sel.slice(1);
      return this.tagName === sel.replace(/^:scope\s*>?\s*/, '').toUpperCase();
    },
    querySelectorAll(sel) {
      const out = [];
      const sel2 = sel.split(',')[0].trim();
      const walk = (n) => { for (const c of n.children) { if (c._matchSelf(sel2)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    focus() {}, select() {}, blur() {}, scrollIntoView() {},
  };
  return node;
}

/* ---------- 页面结构（只需脚本用到的那些 id） ---------- */
const ids = {};
const mkId = (id, tag = 'DIV', attrs = {}) => { const n = mk(tag, attrs); n.attrs.id = id; ids[id] = n; return n; };
mkId('pvLogin'); mkId('pvList', 'SECTION', { hidden: '' });
mkId('pvForm', 'FORM'); mkId('pvPwd', 'INPUT'); mkId('pvGo', 'BUTTON');
mkId('pvMsg'); ids.pvList.hidden = true; ids.pvLogin.hidden = false;
const items = mkId('pvItems', 'UL'); mkId('pvEmpty', 'P'); mkId('pvCount', 'P');
mkId('pvSearch', 'INPUT'); mkId('pvAgain', 'BUTTON');
mkId('searchVeil'); mkId('themeToggle'); mkId('siteHeader'); mkId('mainNav'); mkId('navToggle');

/* SortSelect 的 DOM（脚本用 document.querySelectorAll('.sortsel') 找它） */
const root = mk('div', { class: 'sortsel sortsel-md' });
const inner = mk('div', { class: 'sortsel-inner' });
const sel = mk('select'); sel.value = 'date-desc'; sel.attrs.id = 'pvSort'; ids.pvSort = sel;
const btn = mk('button', { class: 'sortsel-btn' });
const span = mk('span'); span.textContent = '最新发布'; btn.appendChild(span);
const list = mk('ul', { class: 'sortsel-list' }); list.hidden = true;
const MKOPT = (v, t) => { const li = mk('li'); li.dataset.value = v; li.textContent = t; return li; };
list.appendChild(MKOPT('date-desc', '最新发布'));
list.appendChild(MKOPT('date-asc', '最早发布'));
list.appendChild(MKOPT('updated-desc', '最近修改'));
inner.appendChild(sel); inner.appendChild(btn); inner.appendChild(list);
root.appendChild(inner);

globalThis.document = {
  getElementById: (id) => ids[id] || null,
  querySelectorAll: (s) => (s === '.sortsel' ? [root] : []),
  querySelector: () => null,
  createElement: (t) => mk(t),
  addEventListener() {},
  documentElement: { classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, hasAttribute: () => false, dataset: {} },
  visibilityState: 'visible',
};
const winListeners = {};
globalThis.window = {
  addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); },
  removeEventListener(t, fn) { winListeners[t] = (winListeners[t] || []).filter((f) => f !== fn); },
  dispatchEvent(ev) { (winListeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
  location: { search: '', href: '', origin: 'http://localhost' },
  sessionStorage: globalThis.sessionStorage,
};
globalThis.self = globalThis.window;
globalThis.location = { search: '', href: '' };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
/* Node 的 navigator 是只读的，只替换 sendBeacon */
try { globalThis.navigator.sendBeacon = () => true; } catch { Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon() {} }, configurable: true }); }
globalThis.Event = class { constructor(t) { this.type = t; } };
/* 浏览器里带 id 的元素会成为全局变量（private 脚本用了裸 again） */
globalThis.again = ids.pvAgain;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ posts: [] }) });

/* ---------- 取出真实脚本并执行 ---------- */
const html = readFileSync('dist/private/index.html', 'utf8');
const inlines = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const comp = inlines.find((s) => s.includes('dataset.bound'));
const priv = inlines.find((s) => s.includes('yuuu-private'));
let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { console.log('  ✓ ' + label); return true; }
  failed++;
  console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
  return false;
};

console.log('=== 1. 产物里的两段脚本都在 ===');
ok(!!comp, 'SortSelect 组件脚本在产物里');
ok(!!priv, 'private 页面脚本在产物里');

console.log('=== 2. 组件绑定 ===');
new Function(comp)();
ok(root.dataset.bound === '1', '组件给根节点打了 data-bound');
ok(!!list.listeners.click && list.listeners.click.length > 0, '组件给选项列表挂了 click');


/* private 脚本：先给它一批数据，模拟「已验证并展示」 */
const POSTS = [
  { title: '安静', url: '/a/', date: '2024-08-15', updated: '2026-09-16', category: '日记', summary: 's1', tags: [], text: 't1' },
  { title: '雨天', url: '/b/', date: '2024-07-21', updated: '2026-09-16', category: '日记', summary: 's2', tags: [], text: 't2' },
  { title: '开博啦', url: '/c/', date: '2024-05-20', updated: '2026-09-17', category: '日记', summary: 's3', tags: [], text: 't3' },
];
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ posts: POSTS, ticket: 'x' }) });

new Function(priv)();

/* 模拟已进入列表状态：直接调用表单提交（会走 verify → enter → render） */
ids.pvPwd.value = 'pw';
await ids.pvForm.listeners.submit[0]({ preventDefault() {} });

const titles = () => items.children.map((li) => li.children[0].textContent).join(' | ');
const click = (i) => list.listeners.click[0]({ target: list.children[i] });
const DESC = '安静 | 雨天 | 开博啦';   // 2024-08-15 / 07-21 / 05-20
const ASC = '开博啦 | 雨天 | 安静';
const UPDATED = '开博啦 | 安静 | 雨天'; // updated 2026-09-17 / 09-16 / 09-16，后者按日期倒序

console.log('=== 3. 进列表后的初始状态 ===');
ok(sel.value === 'date-desc', '默认选中「最新发布」', sel.value);
ok(titles() === DESC, '默认按发布时间倒序', titles());

console.log('=== 4. 点每个选项都要真的重排（之前就是断在这里） ===');
click(1);
ok(sel.value === 'date-asc', '点「最早发布」写回了 select', sel.value);
ok(titles() === ASC, '点「最早发布」列表重排了', titles());

click(2);
ok(sel.value === 'updated-desc', '点「最近修改」写回了 select', sel.value);
ok(titles() === UPDATED, '点「最近修改」列表重排了', titles());

click(0);
ok(sel.value === 'date-desc', '点回「最新发布」写回了 select', sel.value);
ok(titles() === DESC, '点回「最新发布」列表重排了', titles());

console.log('=== 5. 三种排序结果必须互不相同（否则切换看着像没反应） ===');
ok(DESC !== ASC && ASC !== UPDATED && DESC !== UPDATED, '三种顺序两两不同');

console.log('');
if (failed) {
  console.log('排序下拉链路检查失败 ✗  共 ' + failed + ' 项');
  process.exit(1);
}
console.log('排序下拉链路检查通过 ✓  组件 → select → change → 重排，全链路接通');

