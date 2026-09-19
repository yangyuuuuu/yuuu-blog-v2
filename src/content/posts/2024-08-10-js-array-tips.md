---
title: 10 个我常用的 JavaScript 数组技巧
date: 2024-08-10
category: 技术
tags: [JavaScript, 前端, 技巧]
summary: 写业务代码的时候数组操作占了三分之一。整理一份日常最常用的写法，附一张「会不会改变原数组」的速查表。
cover: snack
coverStyle: wave
coverHue: 150
---

## 1. 用 Set 去重

```js
const nums = [1, 2, 2, 3, 3, 4];
const unique = [...new Set(nums)]; // [1, 2, 3, 4]
```

## 2. 筛选之后映射

```js
const users = [
  { name: 'Furina', age: 500, role: 'archon' },
  { name: 'Navia', age: 24, role: 'captain' },
];

const names = users.filter((u) => u.age < 100).map((u) => u.name);
// ['Navia']
```

## 3. 用 reduce 分组

```js
const byRole = users.reduce((acc, u) => {
  (acc[u.role] ||= []).push(u.name);
  return acc;
}, {});
// { archon: ['Furina'], captain: ['Navia'] }
```

## 4. 求和与最大值

```js
const nums = [3, 1, 4, 1, 5];
const sum = nums.reduce((a, b) => a + b, 0); // 14
const max = Math.max(...nums);               // 5
```

> 数组特别大时别用展开运算符，会爆栈，用 `reduce` 更稳。

## 5. 数组转对象

```js
const list = ['a', 'b', 'c'];
const map = Object.fromEntries(list.map((x) => [x, x.toUpperCase()]));
// { a: 'A', b: 'B', c: 'C' }
```

## 6. 生成定长数组

```js
const range = Array.from({ length: 5 }, (_, i) => i); // [0,1,2,3,4]
```

## 7. 扁平化

```js
const nested = [1, [2, [3, [4]]]];
nested.flat(Infinity); // [1, 2, 3, 4]
```

## 8. 排序的两个坑

`sort` 会**原地修改**数组，而且默认按字符串排：

```js
const nums = [10, 2, 33, 4];
nums.sort();                     // [10, 2, 33, 4] ← 错的
[...nums].sort((a, b) => a - b); // [2, 4, 10, 33]
```

## 9. findIndex + splice 删除

```js
const arr = [1, 2, 3, 4];
const i = arr.findIndex((n) => n === 3);
if (i > -1) arr.splice(i, 1); // [1, 2, 4]
```

## 10. 按条件统计

```js
const posts = [{ tags: ['a'] }, { tags: ['a', 'b'] }];
const count = posts.flatMap((p) => p.tags)
  .reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
// { a: 2, b: 1 }
```

## 速查表

| 方法 | 用途 | 改变原数组 |  
| --- | --- | --- |  
| map | 一对一映射 | 否 |  
| filter | 条件筛选 | 否 |  
| reduce | 归纳成一个值 | 否 |  
| flat / flatMap | 扁平化 | 否 |  
| sort | 排序 | **是** |  
| splice | 增删改 | **是** |  
| slice | 截取 | 否 |

记住最后一列，能省掉很多「为什么我的数据莫名其妙变了」的调试时间。
