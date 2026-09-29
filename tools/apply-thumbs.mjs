#!/usr/bin/env node
/**
 * 构建后处理：把正文里的图改成「默认缩略图 + 点击看原图」。
 *
 * 为什么放在构建之后，而不是用 markdown 的 rehype 插件：
 * Astro 7 换了默认 Markdown 处理器，`markdown.rehypePlugins` 需要额外安装
 * `@astrojs/markdown-remark` —— 而这个仓库用 pnpm + CF 侧 --frozen-lockfile 安装，
 * 加依赖必须同步改 pnpm-lock.yaml，弄不好**线上构建直接失败**（刚修好构建，不冒这险）。
 * 直接改生成的 HTML 一样能达到目的，而且零依赖、一眼看得懂。
 *
 * 改写规则（只动 /uploads/ 下、且存在缩略图的那些）：
 *   <img src="/uploads/图.jpg" alt="…">
 * → <img src="/uploads/thumbs/图.jpg" data-full="/uploads/图.jpg" alt="…" loading="lazy" decoding="async">
 * cover 图不走这里（封面另有尺寸控制）。
 *
 * 跑法：node tools/apply-thumbs.mjs   （build 脚本里已经串上了）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const THUMB_DIR = 'dist/uploads/thumbs';

let pages = 0;
let imgs = 0;
let skipped = 0;

const walkDirs = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walkDirs(p); continue; }
    if (e.name !== 'index.html') continue;
    rewrite(p);
  }
};

function rewrite(file) {
  const html = readFileSync(file, 'utf8');
  if (html.indexOf('/uploads/') < 0) return;
  let touched = 0;
  /* 一次匹配一个 <img …> 标签，只在标签内部替换，避免碰到正文文字 */
  const out = html.replace(/<img\b[^>]*>/g, (tag) => {
    const m = /\ssrc="(\/uploads\/([^"\/]+))"/.exec(tag);
    if (!m) return tag;
    const full = m[1];
    const name = decodeURIComponent(m[2]);
    const base = name.replace(/\.[^.]+$/, '.jpg');
    if (!existsSync(join(THUMB_DIR, base))) { skipped++; return tag; }
    touched++;
    let next = tag.replace(m[0], ' src="/uploads/thumbs/' + encodeURIComponent(base) + '"');
    /* data-full 给文章里的灯箱用 */
    if (!/\sdata-full=/.test(next)) next = next.replace(/<img\b/, '<img data-full="' + full + '"');
    if (!/\sloading=/.test(next)) next = next.replace(/<img\b/, '<img loading="lazy"');
    if (!/\sdecoding=/.test(next)) next = next.replace(/<img\b/, '<img decoding="async"');
    return next;
  });
  if (touched) {
    writeFileSync(file, out, 'utf8');
    pages++;
    imgs += touched;
  }
}

if (!existsSync(THUMB_DIR)) {
  console.log('  没有 thumbs 目录（还没生成缩略图？跑 node tools/make-thumbs.mjs）—— 跳过');
  process.exit(0);
}
walkDirs(DIST);
console.log('  正文图片改写：' + pages + ' 个页面、' + imgs + ' 张图用上缩略图' +
  (skipped ? '（' + skipped + ' 张没有缩略图，保持原图）' : ''));
