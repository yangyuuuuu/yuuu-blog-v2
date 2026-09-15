---
title: 零 JavaScript 的页面切换动画
date: 2024-09-05
category: 技术
tags: [CSS, 动画, View Transitions]
summary: 不引入任何动画库，用浏览器原生的 View Transitions API，多页应用也能有丝滑的转场。三行 CSS 搞定。
coverStyle: aurora
coverHue: 250
---

## 以前是怎么做的

单页应用里做转场很简单，路由变了播个动画就行。多页应用（MPA）就麻烦了 —— 页面是真的在跳，中间必然白一下。

以前的方案是「拦截点击 → 播放退场动画 → 再跳转」，也就是所谓的 PJAX。要写一堆 JS 来回倒腾，还容易出 bug：

> 上一版博客就踩过坑：点击拦截后设了个 `busy` 标志，结果有一次跳转被打断，`busy` 永远是 true，之后所有链接都点不动了。

## 现在：三行 CSS

```css
@view-transition {
  navigation: auto;
}

::view-transition-old(root) {
  animation: yuuu-ripple-out 0.26s ease both;
}

::view-transition-new(root) {
  animation: yuuu-ripple-in 0.34s cubic-bezier(0.2, 0.8, 0.3, 1) both;
}
```

就这样。浏览器会自动截图旧页面、渲染新页面，然后把两张图交给你做动画。

**零 JavaScript。**

## 只动 transform 和 opacity

```css
@keyframes yuuu-ripple-out {
  to { opacity: 0; transform: scale(0.994); }
}
@keyframes yuuu-ripple-in {
  from { opacity: 0; transform: scale(1.006); }
}
```

这两个属性由合成器处理，不触发重排重绘，60fps 稳的。

千万别在这里动 `filter: blur()` —— 那是逐帧重新栅格化，低端机直接卡成幻灯片。

## 兼容性

| 浏览器 | 支持 |
| --- | --- |
| Chrome / Edge 126+ | ✅ 完整支持 |
| Safari 18+ | ✅ |
| Firefox | 🚧 开发中 |
| 其他 | 降级为普通跳转，不影响功能 |

不支持就是没有动画而已，页面照常工作 —— 这正是渐进增强该有的样子。

## 配合预取

Astro 自带 prefetch，鼠标悬停到链接上就开始预取目标页面：

```js
prefetch: { prefetchAll: true, defaultStrategy: 'hover' }
```

预取 + 原生转场，点链接的感觉几乎是瞬时的。

## 记住一件事

动画只用 `transform` 和 `opacity`。违背这条，再漂亮的动画都是负优化。
