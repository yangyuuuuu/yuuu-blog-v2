---
title: 用 Astro 重构一个博客：从手写静态站到零 JS
date: 2024-09-16
category: 技术
tags: [Astro, 前端, 性能]
summary: 记录一次彻底的重构：为什么放弃手写方案、Astro 的岛屿架构到底省掉了什么、以及怎么把首屏 JS 压到 10KB 以内。
cover: pillow
coverStyle: grid
coverHue: 202
---

## 起因

上一版博客是我自己手写的一套静态生成器：一个 `build.mjs` 把 Markdown 编译成 JSON，前端再渲染。

一开始很爽，直到文章多起来：

- 表格里嵌套代码块会渲染错；  
- 想加个脚注、数学公式，得自己写扩展；  
- 导航栏改一个字，要在 7 个 HTML 文件里搜索替换。

> 自己写 Markdown 解析器，就是在给自己挖一个无底洞。

## Astro 解决了什么

### 1. 内容是内容，不是代码

```ts
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});
```

字段写错，构建直接报错，而不是等到页面上出现一个 `undefined`。

### 2. 默认零 JavaScript

Astro 会把组件在构建时渲染成 HTML，**不往浏览器发一行 JS**。  
需要交互的地方（主题切换、搜索、阅读进度）我自己写内联脚本，加起来不到 3KB。

### 3. 组件化

导航栏、页脚、卡片都是 `.astro` 文件。改一处，全站生效。

## 首屏 JS 是怎么算的

| 项目 | 体积 |  
| --- | --- |  
| 主题切换 + 首屏防闪白 | ~0.4 KB |  
| 滚动淡入 IntersectionObserver | ~0.4 KB |  
| 移动端菜单 | ~0.2 KB |  
| 搜索（聚焦后才加载 Pagefind） | 0 KB（首屏） |  
| **合计** | **约 1 KB** |

搜索的索引和模块都等用户点进输入框才加载，完全不占首屏。

## 动画只用两个属性

浏览器合成动画只认 `transform` 和 `opacity`。动 `filter`、`box-shadow`、`width` 都会触发重排或重绘，掉帧是必然的。

阅读进度条以前我是改 `width`，现在改成：

```js
bar.style.transform = 'scaleX(' + ratio + ')';
```

配合 `transform-origin: 0 50%`，效果一样，但全程在合成层里，不碰布局。

## 页面切换

没有引任何动画库，直接用了浏览器原生的 View Transitions：

```css
@view-transition { navigation: auto; }
::view-transition-new(root) { animation: yuuu-ripple-in 0.34s ease both; }
```

多页应用也能有丝滑的过渡，零 JavaScript。

## 小结

如果只是一篇两篇文章，手写完全够用。但只要打算长期写，**把内容层交给成熟的框架，把时间留给写作本身**，才是划算的。
