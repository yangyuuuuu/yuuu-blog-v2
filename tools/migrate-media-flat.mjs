#!/usr/bin/env node
/**
 * 一次性迁移：把 public/uploads/<分类>/xxx.jpg 挪到 public/uploads/xxx.jpg，
 * 并把分类写进 public/uploads/categories.json。
 *
 * 为什么要迁：Decap 的媒体库只列 media_folder 根目录的文件（depth=1，
 * 且过滤掉路径含 '/' 的条目）—— 图放在分类子目录里，用户在那边永远看不到。
 * 新的方案是「文件平铺 + 分类存索引」，参见 workers/oauth/src/index.ts 里 MEDIA_META 的注释。
 *
 * 用 git mv（保留历史），文件名冲突时加时间戳。
 * 跑法：node tools/migrate-media-flat.mjs [--dry]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';

const dry = process.argv.includes('--dry');
const DIR = 'public/uploads';
const META = DIR + '/categories.json';
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/* 现有的索引（如果有就增量合并，不覆盖用户已有的分类） */
let meta = {};
if (existsSync(META)) {
  try { meta = JSON.parse((await import('node:fs')).readFileSync(META, 'utf8')); } catch { meta = {}; }
}

const dirs = readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
if (!dirs.length) { console.log('没有子目录，无需迁移。'); process.exit(0); }
console.log('发现 ' + dirs.length + ' 个分类目录: ' + dirs.join('、'));

let moved = 0;
for (const dir of dirs) {
  for (const name of readdirSync(DIR + '/' + dir)) {
    const from = DIR + '/' + dir + '/' + name;
    if (!statSync(from).isFile()) continue;
    let to = DIR + '/' + name;
    if (existsSync(to)) {
      /* 根目录已有同名：加时间戳，别覆盖 */
      to = DIR + '/' + name.replace(/(\.\w+)$/, '-' + Date.now().toString(36) + '$1');
    }
    console.log((dry ? '[dry] ' : '') + '  ' + from + '  →  ' + to);
    if (!dry) git(['mv', from, to]);
    meta[to.split('/').pop()] = dir;
    moved++;
  }
}

if (dry) { console.log('\n--dry：没有真的动。'); process.exit(0); }

/* 写索引（键排序，稳定 diff） */
const sorted = {};
for (const k of Object.keys(meta).sort()) sorted[k] = meta[k];
writeFileSync(META, JSON.stringify(sorted, null, 2) + '\n', 'utf8');

/* 清掉空的分类目录 */
for (const dir of dirs) {
  const p = DIR + '/' + dir;
  try { if (readdirSync(p).length === 0) { git(['rm', '-r', '--cached', '-q', p]); } } catch { /* 忽略 */ }
}
console.log('\n迁移了 ' + moved + ' 张图，分类索引写入 ' + META);
console.log(JSON.stringify(sorted, null, 2));
