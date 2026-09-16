#!/usr/bin/env node
/**
 * tools/new-post.mjs —— 新建一篇文章
 *
 * 为什么需要它：cmd.exe / PowerShell 传中文参数会按本地代码页编码，
 * 脚本收到的是乱码。所以这里不用命令行参数，改成**交互式问三个问题**。
 *
 * 用法：
 *   npm run new
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'src/content/posts');

const CATEGORIES = ['随笔', '日记', '技术'];
const COVER_STYLES = ['wave', 'nebula', 'crown', 'opera', 'aurora', 'starry', 'bubble', 'grid'];

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

/* 文件名里不能出现这些字符；空白折成横线。中文保留 —— 现有的文章就是这么命名的 */
function slugify(s) {
  return s
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[·•・—–]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60);
}

/*
 * 两种用法：
 *   npm run new                     逐条问你（推荐，中文直接敲）
 *   npm run new -- "标题" 技术 标签1,标签2   一条命令建好，不用回答提问
 * 参数法在 cmd / PowerShell 下也能用：Windows 的 argv 是宽字符，中文不会乱。
 */
function parseArgs(argv) {
  const out = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--(date|category|tags|cover|summary)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else rest.push(a);
  }
  if (rest.length) {
    out.title = rest[0];
    if (rest[1]) out.category = rest[1];
    if (rest[2]) out.tags = rest[2];
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
if (argv.help) {
  console.log('');
  console.log('  npm run new                                逐条问（推荐）');
  console.log('  npm run new -- "标题" [分类] [标签,标签]   一条命令建好');
  console.log('  可选：--date=2026-09-17  --cover=wave  --summary="摘要"');
  console.log('');
  process.exit(0);
}

const rl = createInterface({ input: stdin, output: stdout });
let closed = false;
rl.on('close', () => { closed = true; });

/* 读到文件尾还在等输入时要抛出来，否则 await 永远挂着，
   Node 会以「unsettled top-level await」退出码 13 静默收场（踩过） */
const prompt = (q) => (closed ? Promise.reject(new Error('EOF')) : rl.question(q));

const ask = async (q, fallback = '') => {
  const a = (await prompt(q)).trim();
  return a || fallback;
};

try {
  let title = argv.title || '';
  let date = argv.date || '';
  let category = argv.category || '';
  let rawTags = argv.tags || '';
  let coverStyle = argv.cover || '';
  let summary = argv.summary || '';

  const interactive = !argv.title;
  if (interactive) {
    console.log('');
    console.log('  新建文章 —— 直接回车用方括号里的默认值');
    console.log('');
    while (!title) title = (await prompt('  标题：')).trim();
    date = await ask('  日期 [' + today() + ']：', today());
    category = await ask('  分类 [' + CATEGORIES.join(' / ') + ']：', '随笔');
    rawTags = await ask('  标签（逗号分隔，可留空）：');
    coverStyle = await ask('  封面样式 [' + COVER_STYLES.join(' / ') + '，可留空]：');
    summary = await ask('  摘要（可留空，留空就自动截取正文开头）：');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = today();
  }

  if (!CATEGORIES.includes(category)) {
    if (interactive && category) {
      console.log('');
      console.log('  ! 分类必须是 ' + CATEGORIES.join(' / ') + ' 之一，收到的是「' + category + '」。');
      console.log('    先按「随笔」写进去了，改 frontmatter 里的 category 就行。');
      console.log('');
    }
    category = '随笔';
  }
  if (coverStyle && !COVER_STYLES.includes(coverStyle)) {
    console.log('  ! 没有「' + coverStyle + '」这种封面样式，已忽略。可选：' + COVER_STYLES.join(' / '));
    coverStyle = '';
  }

  const tags = rawTags
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const body = [
    '---',
    'title: ' + title,
    'date: ' + date,
    'category: ' + category,
    'tags: [' + tags.join(', ') + ']',
  ];
  if (summary) body.push('summary: ' + summary);
  if (coverStyle) body.push('coverStyle: ' + coverStyle);
  body.push('draft: true');
  body.push('---');
  body.push('');
  body.push('正文写在这里。');
  body.push('');

  const slug = slugify(title) || 'untitled';
  const name = date + '-' + slug + '.md';
  const file = join(DIR, name);

  if (argv.dryRun) {
    console.log('');
    console.log('  --dry-run，没有写文件。本来会建：src/content/posts/' + name);
    console.log('');
    console.log(body.join('\n'));
  } else if (existsSync(file)) {
    console.log('');
    console.log('  ✗ 已经存在同名文件，什么都没改：src/content/posts/' + name);
    console.log('    换个标题，或者直接编辑那个文件。');
    console.log('');
    process.exitCode = 1;
  } else {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, body.join('\n'), 'utf8');
    console.log('');
    console.log('  ✓ 建好了：src/content/posts/' + name);
    console.log('');
    console.log('  接下来：');
    console.log('    1. 写正文            npm run edit ' + name);
    console.log('    2. 本地看效果        npm run serve      然后打开 http://localhost:4321');
    console.log('    3. 把 frontmatter 里的 draft: true 删掉（或改成 false）才算发布');
    console.log('    4. 上线              npm run publish');
    console.log('');
    console.log('  draft: true 的文章不会被构建出来，先写草稿是安全的。');
    console.log('');
  }
} catch (err) {
  console.log('');
  console.log('  输入中断了（管道读完 / Ctrl+C），什么都没建。');
  console.log('');
  process.exitCode = 1;
} finally {

  rl.close();
}