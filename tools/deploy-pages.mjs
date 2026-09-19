#!/usr/bin/env node
/**
 * 安全部署到 Cloudflare Pages —— tools/deploy-pages.mjs
 *
 * ⚠️ 为什么需要它（血泪教训）：
 * Cloudflare Pages 的每一次部署都是**完整快照** —— 发布哪个 dist，线上就是哪个 dist。
 * 而 /admin/g/ 和 /admin 上传图片是**直连 GitHub API** 的，本地仓库不会自动更新。
 * 所以：**如果本地没先 pull 就 build + 部署，那些通过后台新加的图片会被"挤掉"**
 * （线上文件消失 → 用户看到 404 / 空白卡片）。
 *
 * 这个脚本把顺序固定下来，漏一步都不行：
 *   1. git pull --rebase（先同步后台通过 API 加的图片/文章）
 *   2. astro build + 清单 + pagefind
 *   3. 检查产物里没有"缺文件"的迹象（可选，见下）
 *   4. wrangler pages deploy（用唯一 hash，避免 CF 复用旧部署）
 *
 * 用法：node tools/deploy-pages.mjs
 *   --dry-run   只跑到构建，不真的发布
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const dryRun = process.argv.includes('--dry-run');
const ROOT = process.cwd();
/*
 * ⚠️ Windows 上不要用 shell: true 来跑 npx/npm ——
 * shell 会把参数交给 cmd.exe 重新解析，我这里踩过一次：
 * 进程直接以 0xC0000409（栈溢出）崩掉，报错还看不出原因。
 * 正确做法是 shell: false + 补上 .cmd 后缀。
 */
const exe = (cmd) => (process.platform === 'win32' && ['npm', 'npx', 'pnpm'].includes(cmd) ? cmd + '.cmd' : cmd);
const run = (cmd, args, opts = {}) => {
  console.log('\n▶ ' + cmd + ' ' + args.join(' '));
  return execFileSync(exe(cmd), args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
};
const out = (cmd, args) => {
  try { return execFileSync(exe(cmd), args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false }).trim(); }
  catch { return ''; }
};

/* 0. 工作区必须干净：有未提交的改动时 pull --rebase 会直接拒绝 */
const dirty = out('git', ['status', '--porcelain']);
if (dirty) {
  console.log('=== 0. 工作区不干净 ===');
  console.log(dirty.split('\n').slice(0, 8).map((l) => '  ' + l).join('\n'));
  console.log('  先 git add -A && git commit（或者 git stash）再部署 —— ');
  console.log('  这个脚本刻意不帮你自动提交：提交信息该由人来写。');
  process.exit(1);
}

/* 1. 先同步远端 —— 这一步是关键，别跳过 */
console.log('=== 1. 同步远端（后台通过 API 加的图片/文章都在远端）===');
try {
  run('git', ['-c', 'http.proxy=', '-c', 'https.proxy=', '-c', 'http.https://github.com.proxy=', 'pull', '--rebase', 'origin', 'main']);
} catch {
  console.log('  ⚠️ pull 失败 —— 继续会很危险：本地产物可能缺文件（后台新加的图会从线上消失）。');
  console.log('     确认是网络问题、且本地已是最新，可以加 --force 硬发。');
  if (!process.argv.includes('--force')) process.exit(1);
}
const head = out('git', ['rev-parse', '--short', 'HEAD']);
console.log('  当前提交: ' + head);

/* 2. 构建 */
console.log('\n=== 2. 构建 ===');
run('npm', ['run', 'build']);

/* 3. 体检：产物里 uploads 的图片数量，跟仓库里的对一下 */
console.log('\n=== 3. 产物体检 ===');
const repoUploads = out('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'public/uploads'])
  .split('\n').filter((x) => /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i.test(x));
const distUploads = existsSync('dist/uploads')
  ? (() => {
      const acc = [];
      const walk = (d, rel = '') => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) walk(d + '/' + e.name, rel + e.name + '/');
          else if (/\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i.test(e.name)) acc.push(rel + e.name);
        }
      };
      walk('dist/uploads');
      return acc;
    })()
  : [];
console.log('  仓库里 ' + repoUploads.length + ' 张，产物里 ' + distUploads.length + ' 张');
const missing = repoUploads.filter((p) => !distUploads.includes(p.replace(/^public\/uploads\//, '')));
if (missing.length) {
  console.log('  ❌ 产物里缺这些图（发布出去就会 404）:');
  missing.slice(0, 10).forEach((m) => console.log('     ' + m));
  console.log('  多半是构建前没同步远端。已中止。');
  process.exit(1);
}
console.log('  ✅ 产物里的图片与仓库一致');

if (dryRun) { console.log('\n--dry-run：到此为止，没有发布。'); process.exit(0); }

/* 4. 发布（唯一 hash，避免 CF 把同 hash 当成同一个部署而复用旧产物） */
console.log('\n=== 4. 发布到 Cloudflare Pages ===');
const tag = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
run('npx', ['--yes', 'wrangler', 'pages', 'deploy', 'dist',
  '--project-name', 'yuuu-blog', '--branch', 'main',
  '--commit-hash', tag, '--commit-message', 'deploy ' + head + ' @ ' + tag]);
console.log('\n✅ 发布完成（自定义域传播要 40~60 秒）');
