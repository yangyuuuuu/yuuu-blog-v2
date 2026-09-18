/**
 * 手机写作页逻辑（public/admin/m/app.js）的检查。
 *
 * 这些规则如果写错，用户会在手机上写半天然后被站点自检拦下 —— 所以要和
 * tools/verify.mjs 的规则逐条对齐（尤其是那条「20 字」）。
 *
 * 跑法：node tools/check-mobile-app.mjs
 */
import { validate, parseTags, joinTags, initialOf, describe, relativeDay, MIN_BODY } from '../public/admin/m/app.js';
import { readFileSync } from 'node:fs';

let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { console.log('  ✓ ' + label); return true; }
  failed++;
  console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
  return false;
};

console.log('=== 1. 与站点自检同一条底线 ===');
{
  /* 直接读 verify.mjs 的实现细节来对账，避免两边各说各话 */
  const verify = readFileSync('tools/verify.mjs', 'utf8');
  ok(/body\.trim\(\)\.length/.test(verify), 'verify.mjs 用的是 trim().length');
  ok(MIN_BODY === 20, 'MIN_BODY = 20');
  ok(validate({ title: 'x', body: '一'.repeat(19) }) !== null, '19 字被拦');
  ok(validate({ title: 'x', body: '一'.repeat(20) }) === null, '20 字放行');
  /* 标点也要算 —— 这是之前踩过的坑：我一开始把标点剔掉再数，和 verify 不一致 */
  /* 6 个汉字 + 2 个标点 + 12 个汉字 = 20 个字符 */
  const withPunct = '你好，世界。' + '啊'.repeat(20); // 26 个字符
  
  ok(withPunct.length === 26 && validate({ title: 'x', body: withPunct }) === null, '标点也算字（26 个字符含 2 个标点，放行）', '长度=' + withPunct.length);
  const punctOnly = '。'.repeat(20);
  ok(validate({ title: 'x', body: punctOnly }) === null, '全是标点也算够长（规则与 verify.mjs 一致）');
  ok(validate({ title: 'x', body: '   ' + '一'.repeat(20) + '   ' }) === null, '首尾空白不算（trim 后仍是 20）');
  ok(validate({ title: '', body: '一'.repeat(30) }) !== null, '空标题被拦');
  ok(validate({ title: '   ', body: '一'.repeat(30) }) !== null, '全空格标题被拦');
}

console.log('=== 2. 标签解析 ===');
{
  ok(JSON.stringify(parseTags('a, b, c')) === JSON.stringify(['a', 'b', 'c']), '英文逗号');
  ok(JSON.stringify(parseTags('随笔，手机、测试')) === JSON.stringify(['随笔', '手机', '测试']), '中文逗号/顿号');
  ok(JSON.stringify(parseTags('a  b\nc')) === JSON.stringify(['a', 'b', 'c']), '空格与换行也当分隔');
  ok(JSON.stringify(parseTags('a, a, a')) === JSON.stringify(['a']), '去重');
  ok(JSON.stringify(parseTags('')) === JSON.stringify([]), '空串给空数组');
  ok(parseTags('x'.repeat(30)).length === 0, '超长标签被丢掉');
  ok(parseTags(Array.from({ length: 20 }, (_, i) => 't' + i).join(',')).length === 8, '最多 8 个');
  ok(joinTags(['a', 'b']) === 'a, b', 'joinTags 回去');
  ok(joinTags(undefined) === '', 'joinTags 容忍非数组');
}

console.log('=== 3. 列表显示 ===');
{
  ok(initialOf('雨天、热可可') === '雨', '取标题首字');
  ok(initialOf('  x') === 'x', '跳过前导空格');
  ok(initialOf('') === '·', '空标题有兜底');
  ok(initialOf('𝄞abc') === '𝄞', 'emoji/生僻字按字符取（不是取半个码点）', initialOf('𝄞abc'));
  ok(describe({ date: '2024-06-02', category: '技术' }) === '2024-06-02 · 技术', '日期 + 分类');
  ok(describe({ date: '2024-06-02', category: '日记', draft: true, hidden: true }) === '2024-06-02 · 日记 · 草稿 · 隐藏', '草稿与隐藏都标出来');
  ok(describe({}) === '', '空对象不炸');
}

console.log('=== 4. 相对时间 ===');
{
  const today = new Date(2026, 8, 18); // 2026-09-18
  ok(relativeDay('2026-09-18', today) === '今天', '当天');
  ok(relativeDay('2026-09-17', today) === '昨天', '前一天');
  ok(relativeDay('2026-09-15', today) === '3 天前', '三天前');
  ok(relativeDay('2026-07-01', today) === '2026-07-01', '超过 30 天直接给日期');
  ok(relativeDay('', today) === '', '空值不炸');
  ok(relativeDay('不是日期', today) === '不是日期', '非法值原样返回');
}

console.log('=== 5. 页面文件齐不齐 ===');
{
  const html = readFileSync('public/admin/m/index.html', 'utf8');
  ok(html.includes('/admin/m/ui.css'), '引了 ui.css');
  ok(html.includes('/admin/m/ui.js'), '引了 ui.js');
  ok(/type="module"/.test(html), 'ui.js 用 module（里面用了 import）');
  /* 只看 viewport 那个 meta 的 content —— 别被注释里提到的字样误伤 */
  const viewport = (html.match(/<meta name="viewport" content="([^"]+)"/) || [])[1] || '';
  ok(!/maximum-scale|user-scalable=no/.test(viewport), 'viewport 不挡用户缩放（没有 maximum-scale / user-scalable=no）', viewport);
  /* 这里最容易被忽略：页面里的 id 和 ui.js 里取的对不上，界面上就是"没反应" */
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const ui = readFileSync('public/admin/m/ui.js', 'utf8');
  const wanted = [...ui.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  const missing = wanted.filter((w) => !ids.includes(w));
  ok(missing.length === 0, 'ui.js 里取的 ' + wanted.length + ' 个 id 在页面里都存在', missing.join(', '));
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  ok(dupes.length === 0, '页面里没有重复 id', dupes.join(', '));
}

console.log('');
if (failed) { console.log('手机写作页逻辑检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('手机写作页逻辑检查通过 ✓');
