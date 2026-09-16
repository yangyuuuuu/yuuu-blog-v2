#!/usr/bin/env node
/**
 * tools/publish.mjs —— 一条命令把本地改动发布到线上
 *
 *   npm run publish               构建自检 → 提交 → 推送（Cloudflare 自动重建）
 *   npm run publish -- "提交说明"  自定义提交说明
 *   npm run publish -- --dry-run   只看会发生什么，什么都不做
 *   npm run publish -- --no-build  跳过本地构建（已经 build 过、或构建环境有问题时用）
 *
 * 构建失败时会把 npm 的完整输出原样抄给你：脚本自己猜不出你的构建为什么挂。
 *
 * 为什么不是一个 git push 就完事：
 *   1. 构建会失败是常事（frontmatter 写错、组件编译不过）。本地先构建，
 *      总比让 Cloudflare 那边报错、再回来翻日志强。
 *   2. 提交说明带中文时，cmd.exe 的 `git commit -m "…"` 会因为代码页乱码，
 *      所以这里把说明写进临时文件再用 `git commit -F`。
 *   3. 顺手提醒草稿（draft: true）—— 它们不会被构建出来，别以为是发布失败。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const POSTS = join(ROOT, 'src/content/posts');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noBuild = argv.includes('--no-build');
const message = argv.filter((a) => !a.startsWith('--')).join(' ').trim();

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
const verify = spawnSync('node tools/verify.mjs', [], {
  cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 20 * 1024 * 1024,
});
const verifyOut = (verify.stdout || '') + (verify.stderr || '');
process.stdout.write(verifyOut);
if (verify.status !== 0) {
  console.log('');
  console.log('  ✗ 自检没过（看上面带 ✗ 的那几行），什么都没提交。');
  console.log('    草稿（draft: true）不会被卡正文长度；要发布的文章至少 20 字。');
  process.exit(1);
}
if (verify.error) {
  console.log('');
  console.log('  ✗ 没能启动自检：' + verify.error.message);
  process.exit(1);
}

/* ---------------------------------------------------------------- 3. 这次要发布什么 */
head('3. 这次要发布什么');
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

/* ---------------------------------------------------------------- 4. 构建 */
head('4. 构建（npm run build）—— 构建失败就不推送（--no-build 可跳过）');
if (dryRun) {
  ok('--dry-run 跳过实际构建');
} else if (noBuild) {
  warn('--no-build：跳过本地构建。镜像会交给 Cloudflare 去构建');
  console.log('      它要是失败了，得去 Cloudflare 的 Deployments 里看日志。');
} else {
  /* 用 spawnSync 收完整输出而不是 stdio: inherit —— 构建挂掉时最要紧的就是那段报错，
     一定要原样抄出来。之前用 inherit + 只有一句「构建失败」，等于把线索藏起来了。 */
  const log = join(ROOT, '.build-error.log');
  /* shell 包一层：Windows 上 npm 实际是 npm.cmd，直接 spawn 'npm' 在某些环境会 ENOENT */
  const res = spawnSync('npm run build', [], {
    cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 40 * 1024 * 1024,
  });
  const out = (res.stdout || '') + (res.stderr || '');
  process.stdout.write(out);

  if (res.error) {
    console.log('');
    console.log('  ✗ 没能启动构建：' + res.error.message);
    console.log('    自己跑一次 npm run build 看看，或者：');
    console.log('      npm run publish -- --no-build   跳过本地构建，交给 Cloudflare');
    process.exit(1);
  }

  if (res.status !== 0) {
    writeFileSync(log, out, 'utf8');
    console.log('');
    console.log('  ────────────────────────────────────────────');
    console.log('  ✗ 构建失败（npm 退出码 ' + res.status + '），什么都没提交。');
    console.log('');
    console.log('  上面那段就是 npm 的完整输出，里面的报错才是真正的原因。');
    console.log('  如果输出里根本没有 error 字样，试试：');
    console.log('    npm run build                   单独再跑一次，看真实退出码');
    console.log('    npm run publish -- --no-build   跳过本地构建，交给 Cloudflare');
    console.log('');
    console.log('  完整日志也存了一份：.build-error.log（下次 publish 成功会自动删掉）');
    console.log('  排查手册：DEPLOY.md 第 7 节「构建失败排查」');
    console.log('  ────────────────────────────────────────────');
    console.log('');
    process.exit(1);
  }

  try { unlinkSync(log); } catch { /* 上一轮的残留，删不掉也无所谓 */ }
  ok('构建通过，dist/ 是新鲜的');
}

/* ---------------------------------------------------------------- 5. 提交 + 推送 */
head('5. 提交并推送');
const stamp = new Date().toISOString().slice(0, 10);
const postNames = status.split('\n')
  .filter((l) => l.includes('src/content/posts/'))
  .map((l) => l
    /* git 遇到非 ASCII 路径会给整条路径加双引号，还可能有 \ 转义 —— 先摘掉再取文件名 */
    .replace(/^\s*\S+\s+/, '')
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\/g, '/')
    .replace(/^src\/content\/posts\//, '')
    .replace(/\.md$/, ''));

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