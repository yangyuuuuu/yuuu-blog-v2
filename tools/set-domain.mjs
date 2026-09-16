#!/usr/bin/env node
/**
 * tools/set-domain.mjs —— 一条命令改全站域名
 *
 * 全站有 5 处写死了绝对域名，改自定义域名时漏一处，canonical / RSS / sitemap
 * 就会指向旧地址（这个坑已经踩过一次）。用这个脚本一次改完。
 *
 * 用法： node tools/set-domain.mjs https://yuuu.love
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let domain = (process.argv[2] || '').trim().replace(/\/+$/, '');
if (!domain) {
  console.error('');
  console.error('  用法: node tools/set-domain.mjs https://你的域名');
  console.error('');
  process.exit(1);
}
if (!/^https?:\/\/[^/\s]+$/.test(domain)) {
  console.error('');
  console.error('  域名格式不对，应该写成 https://yuuu.love 这种（不带结尾斜杠和路径）');
  console.error('');
  process.exit(1);
}

const JOBS = [
  { file: 'astro.config.mjs', label: 'SITE', re: /export const SITE = '[^']*';/, to: "export const SITE = '" + domain + "';" },
  { file: 'public/robots.txt', label: 'Sitemap', re: /Sitemap: \S+/, to: 'Sitemap: ' + domain + '/sitemap-index.xml' },
  { file: 'public/admin/config.yml', label: 'site_url', re: /^site_url: .*$/m, to: 'site_url: ' + domain },
  { file: 'public/admin/config.yml', label: 'display_url', re: /^display_url: .*$/m, to: 'display_url: ' + domain },
  { file: 'public/admin/config.yml', label: 'logo_url', re: /^logo_url: .*$/m, to: 'logo_url: ' + domain + '/icon-192.png' },
  { file: 'workers/oauth/wrangler.toml', label: 'ALLOWED_ORIGIN', re: /^ALLOWED_ORIGIN = .*$/m, to: 'ALLOWED_ORIGIN = "' + domain + '"' },
];

console.log('');
console.log('  把全站域名改成：' + domain);
console.log('  ----------------------------------------');

let changed = 0;
let skipped = 0;
const buffers = new Map();

for (const job of JOBS) {
  const abs = join(ROOT, job.file);
  if (!existsSync(abs)) { console.log('  - ' + job.file + ' 不存在，跳过'); skipped++; continue; }
  const before = buffers.has(job.file) ? buffers.get(job.file) : readFileSync(abs, 'utf8');
  const after = before.replace(job.re, job.to);
  if (after === before) {
    console.log('  ! ' + (job.file + ' → ' + job.label) + ' 没匹配到，跳过');
    skipped++;
    buffers.set(job.file, before);
    continue;
  }
  buffers.set(job.file, after);
  changed++;
  console.log('  ✓ ' + (job.file + ' → ' + job.label).padEnd(48) + job.to);
}

for (const [file, content] of buffers) writeFileSync(join(ROOT, file), content, 'utf8');

console.log('  ----------------------------------------');
console.log('  改了 ' + changed + ' 处' + (skipped ? '，跳过 ' + skipped + ' 处' : ''));
console.log('');
console.log('  下一步：');
console.log('    pnpm run build  然后  pnpm run audit   确认三处一致');
console.log('    git add -A && git commit -m "chore: 域名改为 ' + domain + '"');
console.log('');
