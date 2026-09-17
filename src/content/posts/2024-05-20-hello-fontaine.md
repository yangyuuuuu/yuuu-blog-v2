---
title: 开博啦 · 在枫丹的第一页
date: 2024-05-20
category: 日记
tags:
  - 生活
  - 开始
summary: 终于把这个小站搭起来了。用 Astro 从零重构，主题依旧是芙宁娜，但这一次是「零 JS 优先」。
cover: /uploads/77089ca81cd0966f17e0fd8dd63e762b.jpg
coverStyle: nebula
coverHue: 268
pinned: true
draft: true
private: false
---

## 为什么是芙宁娜？

因为她的故事里有我最喜欢的两样东西：**一场永不落幕的演出**，和 **水面之下藏起来的孤独**。

第一次在枫丹见到她的时候，她站在歌剧院最高的地方，笑得像整个国家都在为她鼓掌。后来才知道，那场掌声她一个人听了五百年。

## 这次重构了什么

上一版是手写的静态站，能跑，但越写越累。这一版换成了 Astro：

| 以前 | 现在 |
| --- | --- |
| 手写 Markdown 解析器 | Astro Content Collections |
| 手写导航栏与卡片 | 组件化，改一处全站生效 |
| 手写路由与动画 | 文件路由 + View Transitions API |
| 打包一整个 JS 文件 | 默认零 JS，按需加载 |

## 一些小约定

1. 文章用 Markdown 写，放在 `src/content/posts/`；
2. frontmatter 有强校验，字段写错构建就会报错；
3. 首屏 JS 控制在 10KB 以内，超了就把功能砍掉。

> 审判已经结束。现在，请为我献上掌声。

如果这些话能被某个人看到，那就当作是我隔着水面向你举杯吧。🍰
