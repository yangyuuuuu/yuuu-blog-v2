---
title: 用 Pagefind 给静态博客加全文搜索
date: 2024-09-14
category: 技术
tags: [Pagefind, 搜索, 性能]
summary: 静态站点也能有实时全文搜索。Pagefind 在构建后扫描 dist 目录生成分片索引，用户聚焦搜索框时才下载，首屏一点 JS 都不占。
cover: /mascot/stand.webp
coverStyle: starry
coverHue: 210
---

## 为什么不用客户端搜索库

一开始我想过把文章标题和摘要塞进一个 JSON，前端自己过滤。问题是：

- 文章一多，那个 JSON 就有几百 KB，首屏白等；
- 只能搜标题和摘要，搜不到正文；
- 中文分词要自己搞。

## Pagefind 怎么做的

它在**构建之后**扫描 `dist/` 里的 HTML，生成一堆分片索引文件：

```bash
npm run build   # astro build && pagefind --site dist
```

产物长这样：

```text
dist/pagefind/
├─ pagefind.js          # 运行时模块
├─ pagefind-entry.json  # 索引清单
└─ fragment/*.pf        # 分片索引
```

浏览器只在需要时下载**命中的那几个分片**，不是整个索引。

## 关键：别让它进首屏

我把搜索做成了「懒到骨子里」：

```js
input.addEventListener('focus', function () { load(); });
```

用户点进输入框的那一刻，才开始 `import('/pagefind/pagefind.js')`。
在那之前，首屏 JS 里跟搜索有关的字节数是 **0**。

## 自己渲染结果

Pagefind 自带的 UI 组件有几十 KB，而且样式不好覆盖。它的 JS API 其实很短：

```js
const pf = await import('/pagefind/pagefind.js');
await pf.options({ excerptLength: 26 });
const search = await pf.search('芙宁娜');
const results = await Promise.all(
  search.results.slice(0, 8).map((r) => r.data())
);
// results[i] → { url, excerpt, meta: { title, date } }
```

`excerpt` 里已经带好了 `<mark>` 高亮标签，直接插进 DOM 就行。

## 踩到的坑

1. **本地开发搜不到东西** —— Pagefind 只认构建产物，`astro dev` 下没有索引。要先 `npm run build`。
2. **动态 import 会被打包器处理** —— 用 `is:inline` 的内联脚本，路径原样保留。
3. **高亮颜色** —— `<mark>` 默认是刺眼的黄色，记得用主题变量接管。

> 结论：静态站做搜索，Pagefind 基本是目前的最优解。
