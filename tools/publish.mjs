#!/usr/bin/env node
/**
 * tools/publish.mjs —— 一条命令把本地改动发布到线上
 *
 *   npm run publish               构建自检 → 提交 → 推送（Cloudflare 自动重建）
 *   npm run publish -- "提交说明"  自定义提交说明
 *   npm run publish -- --dry-run   只看会发生什么，什么都不做
 *
 * 为什么不是一个 git push 就完事：
 *   1. 构建会失败是常事（frontmatter 写错、组件编译不过）。本地先构建，
 *      总比让 Cloudflare 那边报错、再回来翻日志强。
 *   2. 提交说明带中文时，cmd.exe 的 `git commit -m "…"` 会因为代码页乱码，
 *      所以这里把说明写进临时文件再用 `git commit -F`。
 *   3. 顺手提醒草稿（draft: true）—— 它们不会被构建出来，别以为是发布失败。
 */
import { execFileSync, execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const POSTS = join(ROOT, 'src/content/posts');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const message = argv.filter((a) => a !== '--dry-run').join(' ').trim();

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit' });
}
const git = (...args) => run('git', args);
const gitOut = (...args) => run('git', args, { capture: true }).trim();

const head = (t) => { console.log(''); console.log('=== ' + t + ' ==='); };
const ok = (m) => console.log('  \u2713 ' + m);
const warn = (m) => console.log('  ! ' + m);

console.log('');
console.log(dryRun ? '  发布（--dry-run，不会真的提交或推送）' : '  发布到线上');

/* ---------------------------------------------------------------- 1. 草稿提醒 */
head('1. 草稿检查');
const drafts = [];
for (const name of readdirSync(POSTS)) {
  if (!name.endsWith('.md')) continue;
  const src = readFileSync(join(POSTS, name), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (fm && /^draft:\s*true\s*$/m.test(fm[1])) {
    const title = (/^title:\s*(.+)$/m.exec(fm[1]) || [])[1] || name;
    drafts.push({ name, title });
  }
}
if (drafts.length) {
  warn('有 ' + drafts.length + ' 篇还是草稿（draft: true），这次不会上线：');
  drafts.forEach((d) => console.log('      · ' + d.title + '  （' + d.name + '）'));
  console.log('      想让某篇上线：把那个文件里的 draft: true 删掉或改成 false');
} else {
  ok('没有未发布的草稿');
}

/* ---------------------------------------------------------------- 2. 源码自检 */
head('2. 源码自检（npm run verify）');
try {
  run('node', ['tools/verify.mjs']);
} catch {
  console.log('');
  console.log('  ✗ 自检没过，先修上面的问题再发布。什么都没提交。');
  process.exit(1);
}

/* ---------------------------------------------------------------- 3. 构建 */
head('3. 构建（npm run build）—— 构建失败就不推送');
if (dryRun) {
  ok('--dry-run 跳过实际构建');
} else {
  try {
    run('npm', ['run', 'build'], { capture: false });
    ok('构建通过，dist/ 是新鲜的');
  } catch {
    console.log('');
    console.log('  ✗ 构建失败，什么都没提交。');
    console.log('    常见原因：frontmatter 字段写错（比如 tags 忘了方括号）、正文里有没闭合的代码块。');
    process.exit(1);
  }
}

/* ---------------------------------------------------------------- 4. 改动盘点 */
head('4. 这次要发布什么');
const status = gitOut('status', '--short');
if (!status) {
  ok('工作区是干净的，没有新改动');
  const ahead = gitOut('log', '--oneline', 'origin/main..HEAD');
  if (ahead) {
    console.log('  但有 ' + ahead.split('\n').length + ' 个提交还没推送：');
    console.log(ahead.split('\n').map((l) => '      ' + l).join('\n'));
  } else {
    console.log('  线上已经是最新的了，不用做任何事。');
    console.log('');
    process.exit(0);
  }
} else {
  console.log(status.split('\n').map((l) => '    ' + l).join('\n'));
}

/* ---------------------------------------------------------------- 5. 提交 + 推送 */
head('5. 提交并推送');
const stamp = new Date().toISOString().slice(0, 10);
const postNames = status.split('\n')
  .filter((l) => l.includes('src/content/posts/'))
  .map((l) => l.replace(/^\s*\S+\s+/, '').replace(/^src\/content\/posts\//, '').replace(/\.md$/, ''));
const finalMessage = message
  || (postNames.length ? 'post: ' + postNames.join('、') : 'chore: 更新站点内容 ' + stamp);

console.log('  提交说明：' + finalMessage);

if (dryRun) {
  ok('--dry-run：不提交、不推送');
  console.log('');
  process.exit(0);
}

const msgFile = join(ROOT, '.git', 'DSh-publish-msg.txt');
writeFileSync(msgFile, finalMessage + '\n', 'utf8');
try {
  git('add', '-A');
  git('commit', '-F', msgFile);
} catch {
  console.log('');
  console.log('  ! 提交没成功（可能没有实际改动）。下面的推送会带上已有提交。');
} finally {
  try { unlinkSync(msgFile); } catch { /* 忽略 */ }
}

try {
  git('push');
  ok('推送完成');
} catch {
  console.log('');
  console.log('  ✗ 推送失败。常见原因：网络不通、需要 GitHub 登录、远端有新提交要先 git pull。');
  console.log('    本地提交还在，网络好了再跑一次 npm run publish 就行。');
  process.exit(1);
}

console.log('');
console.log('  ────────────────────────────────────────────');
console.log('  Cloudflare Pages 收到 push 后会自己构建，约 60 秒上线。');
console.log('  看构建进度：https://dash.cloudflare.com/ → Workers & Pages → yuuu-blog-v2 → Deployments');
console.log('  ────────────────────────────────────────────');
console.log('');
