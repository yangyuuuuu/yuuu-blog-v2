---
title: 用 CSS 做一块「枫丹玻璃」
date: 2024-07-05
category: 技术
tags: [CSS, 前端, 设计]
summary: 玻璃拟态的三个关键属性：半透明背景、背景模糊、细高光边框。附一份可以直接抄的代码，以及一个性能警告。
cover: cake
coverStyle: nebula
coverHue: 205
---

## 三个关键属性

```css
.glass {
  background: rgb(23 48 74 / 0.55);
  backdrop-filter: blur(14px) saturate(150%);
  border: 1px solid rgb(126 200 227 / 0.16);
  border-radius: 18px;
}
```

就这三样：半透明底、背景模糊、一圈细边框。

## 让它有厚度

单靠背景模糊会很平，加一层顶部高光：

```css
.glass::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(145deg, rgb(255 255 255 / 0.16), transparent 42%);
}
```

## 悬停时的一点光

```css
.glass {
  transition: transform 0.3s ease, border-color 0.3s ease;
}
.glass:hover {
  transform: translateY(-6px);
  border-color: rgb(126 200 227 / 0.36);
}
```

注意这里只动 `transform` 和 `border-color`。

## ⚠️ 一个性能警告

`backdrop-filter` 很贵。它要求浏览器把元素背后的内容重新栅格化。

**一页里放十几个毛玻璃卡片，滚动就开始掉帧。**

我的处理：

1. 卡片只用很轻的模糊（12px 左右），不要 30px；
2. 全屏固定层一律不加 backdrop-filter；
3. 主题切换的 400ms 里临时关掉它：

```css
html.theme-switching .glass {
  backdrop-filter: none !important;
}
```

第 3 条的效果最明显 —— 切换瞬间从掉帧变成顺滑。

## 可读性

深色玻璃上的文字别用纯灰，对比度不够。用带一点蓝的浅色：

```css
--ink-2: #b3cde3;  /* 而不是 #999 */
```

> 玻璃的意义不是「透明」，而是让你看见它后面的东西 —— 但前提是字还得看得清。
