/**
 * 手机写作页逻辑（public/admin/m/app.js）的检查。
 *
 * 这些规则如果写错，用户会在手机上写半天然后被站点自检拦下 —— 所以要和
 * tools/verify.mjs 的规则逐条对齐（尤其是那条「20 字」）。
 *
 * 跑法：node tools/check-mobile-app.mjs
 */
import {
  validate, parseTags, joinTags, initialOf, describe, relativeDay, MIN_BODY,
  CATEGORIES, categoryNote, normalizeCategory,
} from '../public/admin/m/app.js';
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

console.log('=== 4.5 分类：三处必须一致 ===');
{
  /*
   * 分类列表写了两份：public/admin/config.yml（Decap 后台的下拉）
   * 和 public/admin/m/app.js 的 CATEGORIES（手机页的胶囊）。
   * 漂移的后果很隐蔽：手机上选了「安利」，而 Decap 的下拉里没有这一项 →
   * 用电脑打开这篇文章时分类显示空，一保存就把分类抹掉了。所以直接对账。
   */
  const cfg = readFileSync('public/admin/config.yml', 'utf8');
  const m = /options:\s*\[([^\]]+)\]/.exec(cfg);
  if (!m) {
    ok(false, 'config.yml 里找不到分类 options');
  } else {
    const fromCfg = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const fromApp = CATEGORIES.map((c) => c.id);
    /* 比集合，不比顺序 —— 手机页按常用度排、后台保持原顺序，都合理 */
    const onlyCfg = fromCfg.filter((x) => !fromApp.includes(x));
    const onlyApp = fromApp.filter((x) => !fromCfg.includes(x));
    ok(onlyCfg.length === 0 && onlyApp.length === 0, 'config.yml 与 app.js 的分类集合一致',
       (onlyCfg.length ? '只在后台有: ' + onlyCfg.join('、') + ' ' : '') + (onlyApp.length ? '只在手机页有: ' + onlyApp.join('、') : ''));
  }
  ok(!!categoryNote('安利'), '每个分类都有说明文字（手机上要显示）', categoryNote('安利'));
  ok(normalizeCategory('不存在的分类') === '随笔', '不认识的分类退回随笔（不会存成空值）');
  ok(normalizeCategory('安利') === '安利', '认识的分类原样保留');
  /* ★ 内容 schema 也必须认识这个分类 —— 漏了它构建会直接失败（加「安利」时就是这么栽的） */
  {
    const schema = readFileSync('src/content.config.ts', 'utf8');
    const m2 = /export const CATEGORIES = \[([^\]]+)\]/.exec(schema);
    if (!m2) {
      ok(false, 'content.config.ts 里找不到 CATEGORIES');
    } else {
      const fromSchema = m2[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      const onlySchema = fromSchema.filter((x) => !CATEGORIES.some((c) => c.id === x));
      const onlyApp = CATEGORIES.map((c) => c.id).filter((x) => !fromSchema.includes(x));
      ok(onlySchema.length === 0 && onlyApp.length === 0, '★ content.config.ts 与手机页的分类集合一致',
         (onlySchema.length ? '只在 schema 有: ' + onlySchema.join('、') + ' ' : '') + (onlyApp.length ? '只在手机页有: ' + onlyApp.join('、') : ''));
    }
  }

  /* 新增分类还要在归档页有颜色、在封面自动配色里有条目，否则那一栏是空的 */
  for (const [file, label] of [['src/pages/archive.astro', '归档页分类色'], ['src/lib/posts.ts', '封面自动配色']]) {
    const src = readFileSync(file, 'utf8');
    const missing = CATEGORIES.map((c) => c.id).filter((id) => !src.includes(id + ':'));
    ok(missing.length === 0, label + '覆盖了全部分类', missing.length ? '缺 ' + missing.join('、') : '');
  }
}

console.log('=== 4.8 图库逻辑（/admin/g/）===');
{
  const {
    groupByDir, categories, filterImages, humanSize, dirLabel, dirValue,
    toJpegName, dataUrlBytes, shouldCompress,
  } = await import('../public/admin/g/gallery.js');

  const imgs = [
    { name: 'a.jpg', dir: '', path: 'public/uploads/a.jpg' },
    { name: 'b.png', dir: '表情包', path: 'public/uploads/表情包/b.png' },
    { name: 'c.webp', dir: '封面', path: 'public/uploads/封面/c.webp' },
    { name: 'd.gif', dir: '表情包', path: 'public/uploads/表情包/d.gif' },
  ];
  const groups = groupByDir(imgs);
  ok(groups[0].dir === '', '「未分类」排在最前', groups.map((g) => g.label).join(','));
  ok(groups[0].label === '未分类', '空分类显示成「未分类」');
  ok(groups.length === 3, '三个分类分组', '实际 ' + groups.length);
  ok(groups.find((g) => g.dir === '表情包').images.length === 2, '同分类归到一起');

  const cats = categories(imgs);
  ok(cats[0].dir === '__all__' && cats[0].count === 4, '首个筛选是「全部」且计数对');
  ok(cats.find((c) => c.dir === '表情包').count === 2, '每个分类带数量');

  ok(filterImages(imgs, { dir: '表情包' }).length === 2, '按分类过滤');
  ok(filterImages(imgs, { keyword: 'b.png' }).length === 1, '按文件名搜索');
  ok(filterImages(imgs, { keyword: '表情' }).length === 2, '搜索也能命中分类名');
  ok(filterImages(imgs, { dir: '表情包', keyword: 'gif' }).length === 1, '分类与关键词同时生效');
  ok(filterImages(imgs, { dir: '不存在' }).length === 0, '不存在的分类给空数组');

  ok(dirValue('未分类') === '', '「未分类」→ 根目录', JSON.stringify(dirValue('未分类')));
  ok(dirValue('表情包') === '表情包', '普通分类名原样');
  ok(dirLabel('') === '未分类', '空 dir → 「未分类」');

  ok(humanSize(800) === '800 B', '体积显示 B', humanSize(800));
  ok(humanSize(2048) === '2.0 KB', '体积显示 KB', humanSize(2048));
  ok(humanSize(3 * 1024 * 1024) === '3.0 MB', '体积显示 MB', humanSize(3 * 1024 * 1024));
  ok(humanSize(0) === '0 B', '0 不炸');

  ok(toJpegName('IMG_1234.HEIC') === 'IMG_1234.jpg', '压缩后统一叫 .jpg', toJpegName('IMG_1234.HEIC'));
  ok(toJpegName('没有后缀') === '没有后缀.jpg', '没后缀也能处理');

  /* 压缩策略：小图不压、gif/svg 不压（压了就没动画/变糊） */
  ok(!shouldCompress({ type: 'image/jpeg', size: 100 * 1024 }), '小于 400KB 不压');
  ok(shouldCompress({ type: 'image/jpeg', size: 900 * 1024 }), '大图要压');
  ok(!shouldCompress({ type: 'image/gif', size: 5 * 1024 * 1024 }), '★ gif 不压（压了没动画）');
  ok(!shouldCompress({ type: 'image/svg+xml', size: 5 * 1024 * 1024 }), 'svg 不压');
  ok(!shouldCompress({ type: '', size: 5 * 1024 * 1024 }), '类型不明不压');

  const tiny = 'data:image/png;base64,' + Buffer.from('12345678').toString('base64');
  ok(dataUrlBytes(tiny) === 8, '能算出 dataURL 的字节数', String(dataUrlBytes(tiny)));
  ok(dataUrlBytes('不是dataurl') === 0, '非法输入给 0');
}

console.log('=== 4.9 文章管理页的搜索（/admin/p/）===');
{
  const { filtersOf, applyFilter, searchPosts, snippet, query, postUrl } = await import('../public/admin/p/posts.js');

  /* ★ 打开文章的链接不能拼错 —— 错一个字就是 404 */
  ok(postUrl({ slug: '2026-09-18-SEP.-26' }) === '/posts/2026-09-18-sep-26/',
     '★ 带点/大写的 slug 也能拼出正确路径', postUrl({ slug: '2026-09-18-SEP.-26' }));
  ok(postUrl({ slug: 'x', url: '/posts/x/' }) === '/posts/x/', '索引里带 url 时优先用它');
  ok(postUrl({ slug: '2026-09-16-yuuu的第一篇文章' }) === '/posts/2026-09-16-yuuu的第一篇文章/', '中文 slug 原样保留');
  ok(postUrl({}) === '', '没有 slug 时给空串（界面上就不会当链接用）');
  ok(postUrl({ slug: '--a--b--' }) === '/posts/a-b/', '首尾多余的连字符去掉');

  const posts = [
    { slug: 'a', title: '雨天、热可可，和楼下那只猫', category: '日记', tags: ['日常'], date: '2024-07-21', draft: false, hidden: true, summary: '写点小事', text: '今天下了雨，我喝了热可可，猫在楼下。' },
    { slug: 'b', title: '重新整理一次前端开发环境', category: '技术', tags: ['工具链', 'Node'], date: '2024-06-02', draft: false, hidden: false, summary: '换电脑之后重新搭了一遍', text: '把用到的东西记下来。' },
    { slug: 'c', title: '还没写完的草稿', category: '随笔', tags: [], date: '2026-09-01', draft: true, hidden: false, summary: '', text: '' },
    { slug: 'd', title: '看完《辉夜大小姐》', category: '安利', tags: ['番剧'], date: '2026-09-10', draft: false, hidden: false, summary: '强烈推荐', text: '这部番的节奏非常好，热可可那段也很甜。' },
  ];

  const f = filtersOf(posts);
  ok(f[0].id === 'all' && f[0].count === 4, '筛选里第一个是「全部」且数量对');
  ok(f.find((x) => x.id === 'draft').count === 1, '草稿数量对');
  ok(f.find((x) => x.id === 'published').count === 3, '已发布数量对');
  ok(f.find((x) => x.id === 'hidden').count === 1, '隐藏数量对');
  ok(f.some((x) => x.id === 'cat:安利'), '★ 分类筛选是从数据里现算的（新增分类不用改代码）');
  ok(f.find((x) => x.id === 'cat:安利').count === 1, '分类计数对');

  ok(applyFilter(posts, 'draft').length === 1, '按草稿过滤');
  ok(applyFilter(posts, 'published').length === 3, '按已发布过滤');
  ok(applyFilter(posts, 'cat:技术').length === 1, '按分类过滤');
  ok(applyFilter(posts, 'all').length === 4, '全部不过滤');
  ok(applyFilter(posts, '不存在的档位').length === 4, '未知档位退回全部（不炸）');

  /* ★ 搜索的核心要求：该搜到的必须搜到 */
  const byTitle = searchPosts(posts, '热可可');
  ok(byTitle.length === 2, '★ 标题和正文里的「热可可」都能搜到（2 篇）', '实际 ' + byTitle.length);
  ok(byTitle[0].post.slug === 'a', '★ 标题命中的排在正文命中的前面', byTitle.map((h) => h.post.slug).join(','));
  ok(byTitle[0].where.includes('标题'), '标出命中在标题');
  ok(byTitle.some((h) => h.where.includes('正文')), '标出命中在正文');

  ok(searchPosts(posts, '工具链')[0].post.slug === 'b', '按标签搜到');
  ok(searchPosts(posts, '技术')[0].post.slug === 'b', '按分类搜到');
  ok(searchPosts(posts, '换电脑')[0].post.slug === 'b', '按摘要搜到');
  ok(searchPosts(posts, '辉夜')[0].post.slug === 'd', '按标题里的书名号内容搜到');
  ok(searchPosts(posts, '不存在的词').length === 0, '搜不到就返回空');
  ok(searchPosts(posts, '').length === 4, '空关键词返回全部');
  ok(searchPosts(posts, '  ').length === 4, '只有空格也算空关键词');

  /* 大小写不敏感 */
  ok(searchPosts(posts, 'node').length === 1, '小写能搜到大写标签');
  ok(searchPosts(posts, 'NODE').length === 1, '大写也能搜到');

  /* 片段：要把关键词周围取出来，而不是只给开头 */
  const sn = snippet('前面一堆无关的话'.repeat(5) + '这里的重点是热可可很好喝' + '后面还有一堆'.repeat(5), '热可可');
  ok(sn.includes('热可可'), '片段包含关键词');
  ok(sn.length < 120, '片段有长度上限（不会把整篇塞进列表）', String(sn.length));
  ok(snippet('', 'x') === '', '空正文给空片段');
  ok(snippet('abc', '找不到') === 'abc', '没命中时给开头');

  /* 组合：先按分类过滤，再搜 */
  const combo = query(posts, { filterId: 'cat:安利', keyword: '热可可' });
  ok(combo.length === 1 && combo[0].post.slug === 'd', '★ 分类 + 关键词能叠加', JSON.stringify(combo.map((h) => h.post.slug)));
  const combo2 = query(posts, { filterId: 'draft', keyword: '热可可' });
  ok(combo2.length === 0, '草稿档里搜不到已发布的文章');
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

  /* 图库页也照同样的规矩查一遍：id 对不上就是「点了没反应」 */
  const gHtml = readFileSync('public/admin/g/index.html', 'utf8');
  ok(gHtml.includes('/admin/g/ui.js'), '图库页引了 ui.js');
  ok(/type="module"/.test(gHtml), '图库页的 ui.js 用 module 加载');
  const gIds = [...gHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const gUi = readFileSync('public/admin/g/ui.js', 'utf8');
  const gWanted = [...gUi.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  const gMissing = gWanted.filter((w) => !gIds.includes(w));
  ok(gMissing.length === 0, '图库页 ui.js 取的 ' + gWanted.length + ' 个 id 都存在', gMissing.join(', '));
  const gDupes = gIds.filter((x, i) => gIds.indexOf(x) !== i);
  ok(gDupes.length === 0, '图库页没有重复 id', gDupes.join(', '));
  /* token 绝不能在两个前端页面上出现 */
  const leak2 = [gUi, readFileSync('public/admin/g/gallery.js', 'utf8'), gHtml]
    .filter((s) => /ghp_|github_pat_|GITHUB_TOKEN/.test(s));
  ok(leak2.length === 0, '图库前端文件里没有 token 字样');
}

console.log('');
if (failed) { console.log('手机写作页逻辑检查失败 ✗  共 ' + failed + ' 项'); process.exit(1); }
console.log('手机写作页逻辑检查通过 ✓');
