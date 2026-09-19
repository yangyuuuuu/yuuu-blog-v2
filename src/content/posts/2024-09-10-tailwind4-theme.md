---
title: Tailwind 4 的 @theme inline 与运行时换主题
date: 2024-09-10
category: 技术
tags: [Tailwind, CSS, 主题]
summary: Tailwind 4 改成 CSS-first 配置后，怎么让工具类跟着 data-theme 实时变化？答案是 @theme inline 加上 CSS custom properties。
cover: sword
coverStyle: grid
coverHue: 190
---

## Tailwind 4 不再用 tailwind.config.js

v4 把配置搬进了 CSS：

```css
@import 'tailwindcss';

@theme {
  --color-brand: #7ec8e3;
  --radius-card: 18px;
}
```

这样 `bg-brand`、`rounded-card` 就都能用了。

## 问题：主题切换时不生效

我一开始这么写：

```css
@theme {
  --color-bg: #0d1b2a;
}
html[data-theme='light'] {
  --color-bg: #f5faff;
}
```

结果切到浅色，`bg-bg` 还是深蓝。

原因是 `@theme` 会在构建时把值**内联**进生成的工具类里：

```css
.bg-bg { background-color: #0d1b2a; }  /* 值被写死了 */
```

## 解法：@theme inline

```css
:root { --bg: #0d1b2a; }
html[data-theme='light'] { --bg: #f5faff; }

@theme inline {
  --color-bg: var(--bg);
}
```

加了 `inline` 之后，生成的工具类变成：

```css
.bg-bg { background-color: var(--bg); }
```

变量在运行时解析，`data-theme` 一改，全站跟着变。

## 过渡动画的坑

一开始我给所有元素加了过渡：

```css
html.theme-switching * { transition: background-color 0.4s ease !important; }
```

切换瞬间掉帧掉得厉害 —— 通配选择器让浏览器对**每一个**元素做样式重算。

后来改成只挂二十来个容器，并且在切换的 400ms 里临时关掉 `backdrop-filter`：

```css
html.theme-switching .t-backdrop {
  backdrop-filter: none !important;
}
```

毛玻璃元素的重绘是切换卡顿的大头，关掉之后立刻就顺了。

## 小结

| 想要的效果 | 写法 |  
| --- | --- |  
| 固定色值 | `@theme { --color-x: #fff }` |  
| 跟随主题 | `@theme inline { --color-x: var(--x) }` |
