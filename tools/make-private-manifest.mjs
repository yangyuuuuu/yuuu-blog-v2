#!/usr/bin/env node
/**
 * tools/make-private-manifest.mjs —— 生成「隐藏文章清单」
 *
 * 输出 dist/private/posts.json。里面**只有元信息**（标题 / 链接 / 日期 / 摘要），
 * 不放正文 —— 密码校验由 Worker 负责，清单本身不是机密。
 *
 * 为什么要这个文件：/private/ 页面在浏览器里跑，它没法知道仓库里有哪些隐藏文章；
 * 而 Worker 也不能直接读仓库。所以构建时把清单固化成一个静态 JSON，
 * 由 Worker 在密码校验通过后代为取出（并顺手记一条访问日志）。
 *
 * 用法：node tools/make-private-manifest.mjs   （已挂进 npm run build）
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHiddenData } from '../src/lib/hidden.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const POSTS = join(ROOT, 'src/content/posts');
const OUT_DIR = join(ROOT, 'dist/private');
const OUT = join(OUT_DIR, 'posts.json');

/** 只取需要的几个键，不引 YAML 解析器（它是 astro 的传递依赖，见 HANDOFF 的幽灵依赖一节） */
/** 把正文压成纯文本，供私人角落做全文搜索（去掉代码块、标记、链接语法） */
function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readKeys(file) {
  const raw = readFileSync(join(POSTS, file), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const yaml = (fm || [])[1] || '';
  const body = fm ? raw.slice(fm[0].length) : raw;
  const one = (key) => {
    const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(yaml);
    return m ? m[1].replace(/^["']|["']$/g, '') : undefined;
  };
  /* tags 有两种写法：行内 [a, b] 或 YAML 列表（后台保存出来是多行） */
  const tags = (() => {
    const inline = /^tags:\s*\[([^\]]*)\]\s*$/m.exec(yaml);
    if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const block = /^tags:\s*\n((?:\s+-\s*.+\n?)+)/m.exec(yaml);
    if (block) return block[1].split('\n').map((l) => l.replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    return [];
  })();
  return {
    slug: file.replace(/\.md$/, ''),
    private: one('private') === 'true',
    draft: one('draft') === 'true',
    category: one('category'),
    title: one('title') || file,
    date: one('date') || '',
    summary: one('summary') || '',
    tags,
    /* 全文：私人角落的搜索要用它。只留前 2000 字，够搜就行 */
    text: plainText(body).slice(0, 2000),
  };
}

const all = readdirSync(POSTS).filter((f) => f.endsWith('.md')).map(readKeys);
/* 草稿不算「隐藏文章」—— 草稿连构建都不输出，列出来点了会 404 */
const hidden = all
  .filter((p) => !p.draft && isHiddenData(p))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: hidden.length,
      posts: hidden.map((p) => ({
        title: p.title,
        url: '/posts/' + p.slug + '/',
        date: p.date,
        category: p.category,
        summary: p.summary,
        tags: p.tags,
        text: p.text,
      })),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log('  ✓ 隐藏文章清单：' + hidden.length + ' 篇 → dist/private/posts.json');
for (const p of hidden) console.log('      · ' + p.date + '  ' + p.title);
