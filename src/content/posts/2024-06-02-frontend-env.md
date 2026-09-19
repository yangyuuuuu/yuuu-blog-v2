---
title: 重新整理一次前端开发环境
date: 2024-06-02
category: 技术
tags: [工具链, Node, 前端]
summary: 换电脑之后重新搭了一遍开发环境，把用到的东西和踩过的坑记下来，方便下次直接抄。
cover: sword
coverStyle: grid
coverHue: 215
---

## 基础三件套

| 工具 | 用途 | 备注 |  
| --- | --- | --- |  
| Node.js | 运行时 | 用 LTS，别追最新 |  
| pnpm | 包管理 | 磁盘占用小，装得快 |  
| Git | 版本控制 | 顺手配好 SSH key |

## 装 Node

用版本管理器，别装到系统里：

```bash
# macOS / Linux
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts

# Windows 用 fnm 或 nvm-windows
winget install Schniz.fnm
```

## pnpm

```bash
corepack enable pnpm
pnpm -v
```

## 编辑器

VS Code 只装必要的：

- ESLint —— 保存时自动修  
- Prettier —— 统一格式  
- EditorConfig —— 统一缩进换行

`.editorconfig`：

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

## 踩过的坑

1. **换行符** —— Windows 上必须设好，不然 diff 全是红的：

   ```bash
   git config --global core.autocrlf input
   ```

2. **npm 缓存目录** —— 如果工作目录在别的盘，缓存还在 C 盘，装包可能因为权限失败。把缓存也挪过去：

   ```bash
   npm config set cache D:\dev\.npm-cache
   ```

3. **全局包** —— 能不装就不装，用 `npx` 更干净。

## 小结

> 环境这种东西，配好一次能用很久，但每次踩的坑都不太一样。记下来，下次直接抄。
