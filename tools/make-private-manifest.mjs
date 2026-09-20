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
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHiddenData } from '../src/lib/hidden.ts';
import { slugify } from '../src/lib/slug.ts';

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

/**
 * 文章最后一次被改动的日期。
 * frontmatter 里有 updated 就用它（后台保存时会自动写）；
 * 没有就用 **git 提交日期** 兜底 —— 这样老文章也有真实的「最近修改」，
 * 「最近修改」排序才不会和「最新发布」完全一样。
 */
function gitDate(file) {
  try {
    /*
     * 取【精确到秒】的提交时刻，而不是只到「天」的 %cs。
     *
     * 为什么：%cs 只到天，同一天改过好几篇时它们的日期全一样，
     * 「最近修改」排出来就和「最新发布」一模一样 —— 用户报的「三种切换没区别」正是这个。
     * 带上时间后，同一天的不同提交时刻也能分开。
     * 带 %ct（时间戳）是为了拿到明确时刻，不受运行环境时区影响。
     */
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || '';
  } catch {
    return '';
  }
}

/**
 * 改过这个文件的提交数 —— 只用来给「同一天被改过」的文章分先后。
 *
 * 为什么需要：git 日期只到「天」。一天里改过好几篇时，它们的 updated 会全一样，
 * 于是「最近修改」排出来和「最新发布」一模一样（用户报的就是这个：三种切换看不出区别）。
 * 提交数一定是个具体的整数、且各篇基本不同，拿来当同天时的排序依据最省事，
 * 也不用去猜 git 的提交时刻（Cloudflare 的浅克隆未必给得准）。
 */
function gitTouches(file) {
  try {
    const out = execFileSync('git', ['log', '--format=%h', '--', file], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? out.split('\n').length : 0;
  } catch {
    return 0;
  }
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
    /*
     * ⚠️ slug 必须和 **Astro 实际生成的路径** 一致，不能直接拿文件名。
     * Astro 会小写、把非字母数字换成 -、并合并连续 - ：
     *   文件 2026-09-18-SEP.-26.md  →  页面 /posts/2026-09-18-sep-26/
     * 之前这里直接用文件名，于是清单里的链接是 /posts/2026-09-18-SEP.-26/（404）。
     * 私人角落和手机写作页点开都会打不开 —— 这种错很隐蔽，因为页面本身是好的。
     * 改这里时请一起看 tools/check-mobile-app.mjs 里那条「清单 URL 与产物目录对得上」。
     */
    slug: slugify(file.replace(/\.md$/, '')),
    private: one('private') === 'true',
    draft: one('draft') === 'true',
    category: one('category'),
    title: one('title') || file,
    date: one('date') || '',
    /* 后台保存时自动写；「最近修改」排序要用它，缺了就只能退回按发布日期排 */
    updated: one('updated') || '',
    summary: one('summary') || '',
    pinned: one('pinned') === 'true',
    tags,
    /* 全文：私人角落的搜索要用它。只留前 2000 字，够搜就行 */
    text: plainText(body).slice(0, 2000),
  };
}

const all = readdirSync(POSTS).filter((f) => f.endsWith('.md')).map(readKeys);

/* 没有 updated 的，用 git 提交日期兜底（注意要比 date 新，否则没有意义） */
for (const p of all) {
  const file = 'src/content/posts/' + p.slug + '.md';
  p.touches = gitTouches(file);
  if (!p.updated) {
    const g = gitDate(file);
    /* 比对只取日期部分：g 是带时区的 ISO（2026-09-16T13:48:29+08:00） */
    if (g && g.slice(0, 10) > p.date) p.updated = g;
  }
}
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
        /*
         * ⚠️ slug 和 url 两个都要给。
         * 之前这里只有 url，而 posts-all.json 只有 slug —— 日记页读的是 slug，
         * 于是它拼出 /posts/undefined/ 全 404（站主报的「点击显示不存在」）。
         * 两个清单字段保持一致，谁读哪个都不会再踩。
         */
        slug: p.slug,
        url: '/posts/' + p.slug + '/',
        date: p.date,
        /* 可能是 ISO 时刻（来自 git）或纯日期（来自 frontmatter）；页面显示与排序都吃得下 */
        updated: p.updated || p.date,
        /* 同一天被改过时用来分先后的次要依据（见 gitTouches 注释） */
        touches: p.touches || 0,
        category: p.category,
        summary: p.summary,
        tags: p.tags,
        /*
         * 这里**不放正文**。曾经为了「私人角落的全文搜索」放了一段（截断的）正文，
         * 但 /private/posts.json 是**公开可访问**的静态文件 ——
         * 「私人」靠的是 Worker 的口令门槛，不是文件藏得深。
         * 私人角落现在按需点开一篇再取正文（见 private.astro）。
         */
      })),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log('  ✓ 隐藏文章清单：' + hidden.length + ' 篇 → dist/private/posts.json');
for (const p of hidden) console.log('      · ' + p.date + '  ' + p.title);

/* ------------------------------------------------------------------ 手机写作页的清单
 *
 * /admin/m/（手机用的简易编辑器）要列出**所有**文章，草稿也要 —— 否则草稿进去就找不到了。
 * 这里只放元信息，正文在点开某一篇时由 Worker 现取（那样也能拿到最新的正文）。
 * 和 private/posts.json 一样是公开文件，所以**不放正文**。
 */
const ALL_OUT = join(OUT_DIR, 'posts-all.json');
const sorted = all.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  ALL_OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: sorted.length,
      posts: sorted.map((p) => ({
        slug: p.slug,
        /* 同样两个都给 —— 见上面 hidden 那段注释 */
        url: '/posts/' + p.slug + '/',
        path: 'src/content/posts/' + p.slug + '.md',
        title: p.title,
        date: p.date,
        updated: p.updated || p.date,
        category: p.category || '',
        tags: p.tags,
        summary: p.summary || '',
        draft: !!p.draft,
        hidden: isHiddenData(p),
        pinned: p.pinned === true,
        words: p.text ? p.text.length : 0,
      })),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log('  ✓ 手机写作页清单：' + sorted.length + ' 篇（含草稿）→ dist/private/posts-all.json');

