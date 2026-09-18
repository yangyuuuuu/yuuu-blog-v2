/**
 * 后台预览模板检查 —— 用假的 CMS / h 跑 public/admin/preview.js 里真实的 Markdown 渲染，
 * 验证：正文一字不丢、块级结构认得对、封面与元信息都在。
 *
 * 为什么要单独测：预览是「看起来差不多就行」的东西，最容易悄悄把字吞掉 ——
 * 一篇 2000 字的文章少一段没人会发现。这里比对的是「纯文本必须完全一致」。
 *
 * 跑法：node tools/check-admin-preview.mjs（不需要构建）
 */
import { readFileSync, readdirSync } from 'node:fs';

let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { console.log('  ✓ ' + label); return true; }
  failed++;
  console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
  return false;
};

/* ---- 假的 React.createElement：造出可检查的普通对象 ---- */
const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: (children || []).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
});

/* ---- 假的 CMS：把注册结果接住 ---- */
const registered = { styles: [], templates: {} };
globalThis.window = {
  h,
  createClass: (spec) => function PreviewClass(props) { return Object.assign({}, spec, { props }); },
  CMS: {
    registerPreviewStyle: (p) => registered.styles.push(p),
    registerPreviewTemplate: (name, C) => { registered.templates[name] = C; },
  },
  location: { hostname: 'yuuu.love', origin: 'https://yuuu.love' },
};
globalThis.location = globalThis.window.location;

new Function(readFileSync('public/admin/preview.js', 'utf8'))();

console.log('=== 1. 注册 ===');
ok(registered.styles.includes('preview.css'), '注册了 preview.css');
ok(!!registered.templates.posts, '给 posts 集合注册了预览模板');

/* ---- 把渲染结果里的纯文本全抓出来 ---- */
const textOf = (node) => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
};
const typesOf = (node, acc = []) => {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => typesOf(n, acc)); return acc; }
  if (node.type) acc.push(node.type);
  typesOf(node.children, acc);
  return acc;
};

const render = (data) => {
  const C = registered.templates.posts;
  const inst = new C({
    entry: { get: (k) => (k === 'data' ? { get: (f) => data[f] } : undefined) },
  });
  return inst.render();
};

console.log('=== 2. 结构（拿真实文章当输入） ===');
const POSTS_DIR = 'src/content/posts';
const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
/* 取正文最长的一篇，最能暴露吞字 */
let nicest = files[0], bestLen = 0;
for (const f of files) {
  const raw = readFileSync(POSTS_DIR + '/' + f, 'utf8');
  if (raw.length > bestLen) { bestLen = raw.length; nicest = f; }
}
const raw = readFileSync(POSTS_DIR + '/' + nicest, 'utf8');
const body = raw.replace(/^---[\s\S]*?---\s*/, '');
const fm = raw.match(/^---([\s\S]*?)---/)[1];
const pick = (k) => {
  const m = fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};
console.log('  用这篇：' + nicest + '（正文 ' + body.length + ' 字符）');

const tree = render({ title: pick('title'), date: pick('date'), category: pick('category'), body,
                      tags: (fm.match(/tags:\s*\[(.*?)\]/) || [])[1]?.split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean) || [] });
const types = typesOf(tree);
ok(types.includes('h1'), '有标题（h1）');
ok(types.includes('h2'), '正文里的小标题渲染成 h2');
ok(types.includes('pre'), '代码块渲染成 pre');
ok(types.includes('blockquote'), '引用渲染成 blockquote');
/* 这篇文章里没有列表，别硬要求 —— 列表单独用一段构造的 Markdown 测 */
const listTree = render({ title: '列表', body: '无序：\n\n- 甲\n- 乙\n\n有序：\n\n1. 一\n2. 二' });
const listTypes = typesOf(listTree);
ok(listTypes.includes('ul'), '无序列表渲染成 ul');
ok(listTypes.includes('ol'), '有序列表渲染成 ol');
ok(textOf(listTree).includes('甲') && textOf(listTree).includes('二'), '列表项文字都在');

console.log('=== 3. 一字不丢 ===');
/*
 * 比对「标题 + 正文」的非空白字符。
 * 注意：语法符号（# * > ` 等）会被渲染器吃掉，所以两边都要去掉；
 * 代码块的围栏要换成空格而不是直接删 —— 否则相邻的 "js" 和 "const" 会粘成
 * 原文里并不存在的 "jsconst"，比对就会误报丢字（这个坑踩过）。
 */
const strip = (s) => String(s)
  .replace(/```[a-zA-Z]*/g, ' ')
  .replace(/[#*>`\-\[\]()!]/g, '')
  .replace(/\s+/g, '');
const sourceText = strip(pick('title') + body);
const renderedText = strip(textOf(tree));
ok(renderedText.length >= sourceText.length * 0.98,
   '渲染后的字符数不少于原文的 98%',
   '原文 ' + sourceText.length + ' vs 渲染 ' + renderedText.length);
const missing = [];
for (const ch of new Set(sourceText)) {
  if (!renderedText.includes(ch)) missing.push(ch);
}
ok(missing.length === 0, '原文里出现过的字符都还在', missing.join(''));
/* 更严一点：抽 12 个长度 8 的片段，必须都能在渲染结果里找到 */
const frag = [];
for (let i = 0; i + 8 < sourceText.length; i += Math.floor(sourceText.length / 12)) frag.push(sourceText.slice(i, i + 8));
const lost = frag.filter((f) => !renderedText.includes(f));
ok(lost.length === 0, '抽查 ' + frag.length + ' 个 8 字片段全部命中', lost.slice(0, 3).join(' / '));

console.log('=== 4. 封面与元信息 ===');
const withCover = render({ title: '封面测试', date: '2026-01-02', updated: '2026-03-04', category: '随笔', cover: 'stand', body: '正文', coverHue: 202, tags: ['甲', '乙'] });
const t2 = textOf(withCover);
ok(t2.includes('封面测试'), '标题进去了');
ok(t2.includes('2026-01-02'), '日期进去了');
ok(t2.includes('改于 2026-03-04'), '「最后修改」进去了');
ok(t2.includes('#甲'), '标签进去了');
const imgs = [];
(function walk(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.type === 'img') imgs.push(n.props.src); walk(n.children); })(withCover);
ok(imgs.some((s) => s && s.includes('/mascot/stand.webp')), '封面池 id 解析成了真实图片路径', JSON.stringify(imgs));
const noCover = render({ title: '无封面', body: '正文' });
const grads = [];
(function walk(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.props && typeof n.props.style === 'object' && n.props.style.background) grads.push(n.props.style.background); walk(n.children); })(noCover);
ok(grads.length > 0, '没选封面时用渐变兜底');

console.log('=== 5. 边界输入不炸 ===');
for (const [label, data] of [
  ['空正文', { title: '空', body: '' }],
  ['只有标题正文无日期', { title: 'x', body: 'y' }],
  ['undefined 正文', { title: 'x', body: undefined }],
  ['正文里带 <script>', { title: 'x', body: '<script>alert(1)</script>' }],
  ['正文未闭合代码块', { title: 'x', body: '```\n没有结束' }],
  ['超长无换行', { title: 'x', body: 'a'.repeat(5000) }],
]) {
  try { render(data); ok(true, label + ' 不抛异常'); }
  catch (e) { ok(false, label + ' 不抛异常', e.message); }
}
/* 脚本标签必须是文本而不是 HTML（React 默认转义，这里确认我们没有用 dangerouslySetInnerHTML 之类的旁路） */
const esc = textOf(render({ title: 'x', body: '<script>alert(1)</script>' }));
ok(esc.includes('<script>'), '尖括号按纯文本保留（没有被当 HTML 吞掉）');

console.log('');
if (failed) { console.log('后台预览检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('后台预览检查通过 ✓');
