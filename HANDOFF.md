# 交接说明

> 给下一段对话（或未来的自己）用。读完这份就能直接开工，不需要重新问一遍背景。

---

## 一句话背景

**Furina 主题的个人博客**，从零重构（PRD 要求 Astro + Tailwind + Pagefind，
部署 Cloudflare Pages）。站点 `https://yuuu.love`，仓库
`github.com/yangyuuuuu/yuuu-blog-v2`。

用户全程在 **Windows 11 + cmd.exe / PowerShell** 下操作。

---

## 常用命令

```cmd
npm run serve     构建 + 产物验收 + 起预览服务（最常用，http://localhost:4321）
npm run dev       开发服务器（热更新，但搜索不可用）
npm run verify    源码自检（组件编译 / frontmatter / import / 首屏 JS 预算）
npm run audit     产物验收（对 dist/ 量 PRD 红线）
npm run icons     重新生成 favicon 与表情包素材
npm run domain    换域名（一次改 6 处）
npm run og        重新生成 OG 图
```

---

## 当前状态

- 工作区**干净**，全部已提交
- `npm run verify` → 全部通过（3 条提示）
- `npm run audit` → **产物验收全部通过**（1 条提示）
- ⚠️ **唯一未达标**：首屏 JS **总计 12.50 KB** > PRD 的 10 KB 红线
  （行内 7.88 KB 已达标，超的是 SearchBox 那 3.26 KB）

---

## 已完成的需求（累计）

| 需求 | 状态 |
| --- | --- |
| 从零重构（Astro 7 + Tailwind 4 + Pagefind） | ✅ |
| 部署 Cloudflare Pages / 自定义域名 yuuu.love | ✅ |
| favicon / 表情包素材（`tools/make-icons.mjs` 抠图） | ✅ |
| 搜索：`/` 与 Ctrl+K、↑↓ 选择、Enter 打开、命中居中 | ✅ |
| 搜索查询语法（`in:` `tag:` `category:` `date:` `words:` `min:`、`< > <= >=`） | ✅ |
| 搜索语法文档页 `/search-guide/`（例子可点击） | ✅ |
| 中文搜索排序（短语优先 + 客户端重排） | ✅ |
| 搜索聚焦聚光（整页模糊变暗） | ✅ |
| 搜索结果再次聚焦可恢复 | ✅ |
| 主页两屏：首屏极简 + 内容下沉模糊浮现 | ✅ |
| 首屏禁选 / 页脚图标署名禁选 | ✅ |
| 顶栏下滑隐藏、上滑归位、桌面三栏对称、手机单行 | ✅ |
| 主页列数可选（2~6） | ✅ |
| 正文宽度可拖拽（双击复位） | ✅ |
| 皮肤系统（枫丹 / 歌剧院 / 深海 × 深浅） | ✅ |
| 主题单按钮切换 + 太阳月亮旋转动画 | ✅ |
| 设置面板（配色 / 列数 / 四个显示开关 / 导入导出） | ✅ |
| 更新历史按版本折叠（短内容自动去掉展开按钮） | ✅ |
| 封面池 `src/lib/covers.ts` | ✅ |
| 文章卡片进出场动画 | ✅ |
| Cloudflare Access 加 /admin 门禁（文档已写，**用户尚未在控制台操作**） | 📄 |

---

## 未完成的需求

| 需求 | 前置条件 | 难度 |
| --- | --- | --- |
| **搜索引擎按需加载**（把首屏总计压到 10 KB 内） | 无 | 中，见下方「教训」 |
| 阅读位置记录 + 恢复提示（空格跳转、可自定义组合键） | 无 | 中 |
| 「造物主」命令面板（双击 Ctrl 唤出，输入 `search`/`setting` 跳转） | 无 | 中 |
| 「库」知识库（分类整理技术速查，如 GitHub 文件查找、ASCII 表） | **需用户先定分类体系** | 中 |
| 用户系统（注册 / 只读账号 / 云端日志） | 用户已选**方案 A（Cloudflare Access）**，但 Access 做不到「注册」和「只读角色」，真要做需自建 D1 后端 | 大 |
| 文章元数据整理 | 用户明确说**先不做** | — |

---

## 踩过的坑（重要，别重复）

### 1. Windows 命令（连续犯过三次）

| 写法 | 出错环境 | 正确写法 |
| --- | --- | --- |
| `rm -rf` | PowerShell | `Remove-Item -Recurse -Force` |
| `Remove-Item` | cmd.exe | `rmdir /s /q` |
| `npm run build # 注释` | cmd.exe | `#` 不是注释符，会被当参数传给命令 |

**在聊天里给命令时绝对不要带行内注释**，用户会整行复制。

### 2. 幽灵依赖

`zod` / `@astrojs/compiler` / `sharp` 都曾被当成「已经装好了」直接用 ——
npm 的扁平化会掩盖，**pnpm 的隔离模式会正确报错**。发现一个就补进
`devDependencies`。

### 3. 用正则改脚本结构 → 把大括号弄丢

拆 `SearchBox.astro` 的脚本到独立模块时，用正则做了
`(function () {` → `export function init() {` 和 `})();` → `}`。
**收尾括号丢了，构建报 `Expected }` but found EOF`，连修四轮没修好，最后回滚。**

正确做法：**原样包裹**，内部一个字符都不动 ——
`export function init() { <原body完整粘贴> }`，改完立刻用
`npx esbuild <file> --outfile=probe.js` 验证语法再提交。

教训：**不要用正则改有嵌套结构的代码**；写完必须有独立的语法校验，
不能只靠自己的括号计数器（它会被正则字面量里的引号带偏）。

### 4. PowerShell 重定向会写成 UTF-16

`git show xxx > file` 出来的文件 Node 按 utf8 读是乱码。
要用 `| Out-File -Encoding utf8`。

### 5. 全屏 fixed 层必须 pointer-events: none

旧版 v1 因为 `.idle-veil { display: grid }` 覆盖了 `[hidden]`，
全屏透明遮罩吞掉了所有点击，整站点不动。
现在有全局 `[hidden] { display: none !important }` 兜底，
`tools/audit-dist.mjs` 也会检查产物 CSS 里这两条兜底还在不在。

### 6. 初始隐藏态必须挂在 html.js 下

`.reveal` / `.sink` 的初始 opacity:0 都写成 `html.js .reveal { ... }`，
否则 JS 挂了内容会永远隐身。

### 7. 沙箱限制（本环境特有）

- `astro build` 在本沙箱**跑不起来**（spawn EPERM / Vite 内部报错），
  构建产物只能靠用户执行后贴日志
- 所以 `tools/verify.mjs`（源码层）和 `tools/audit-dist.mjs`（产物层）才存在

---

## 关键文件地图

| 文件 | 作用 |
| --- | --- |
| `astro.config.mjs` | `SITE` 决定 canonical / sitemap / RSS 的绝对地址 |
| `src/lib/covers.ts` | 封面池，加图改这里 |
| `src/lib/posts.ts` | 文章查询与派生字段 |
| `src/scripts/settings-panel.ts` | 设置面板逻辑（按需加载，已拆出） |
| `src/components/SearchBox.astro` | 搜索 UI + 引擎（**尚未拆出**） |
| `src/layouts/BaseLayout.astro` | SEO / 防闪白内联脚本 / reveal / 滑动模糊 |
| `src/styles/theme.css` | 配色令牌（`--a`/`--g` 分量派生）+ 皮肤 |
| `src/styles/global.css` | 全部组件样式（单文件，约 1000 行） |
| `tools/verify.mjs` | 源码自检 |
| `tools/audit-dist.mjs` | 产物验收（PRD 红线的唯一裁判） |
| `DEPLOY.md` | 部署 / Cloudflare Access / Lighthouse / 排查表 |
| `CHANGELOG.md` | 版本历史 |

---

## 下一段对话建议的第一句话

> 读一下 `D:\DS\yuuu-blog-v2\HANDOFF.md`，然后继续做「搜索引擎按需加载」，
> 目标是首屏 JS 总计降到 10 KB 以下。
