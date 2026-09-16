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
npm run verify    源码自检（组件编译 / frontmatter / import / 首屏 JS 预算 / 按需模块）
npm run audit     产物验收（对 dist/ 量 PRD 红线）
npm run smoke     搜索运行时冒烟测试（跑真实按需 chunk，需要先 build）
npm run check:all 上面三项一起跑，提交前跑这个
npm run icons     重新生成 favicon 与表情包素材
npm run domain    换域名（一次改 6 处）
npm run og        重新生成 OG 图
```

---

## 当前状态

- 工作区**干净**，全部已提交（最近一次是「搜索引擎按需加载」）
- `npm run verify` → 全部通过（3 条提示）
- `npm run smoke` → 全部通过
- `npm run audit` → **产物验收全部通过**（0 条提示）
- ✅ **首屏 JS 达标**：行内 7.88 KB + 外链 gzip 2.11 KB = **9.99 KB**（< 10 KB 红线）
  —— 搜索引擎 7.80 KB（gzip 3.33 KB）已经切成按需 chunk，用户聚焦 / Ctrl+K 时才下载

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
| **搜索引擎按需加载**（首屏 JS 压到 10 KB 内） | ✅ |
| Cloudflare Access 加 /admin 门禁（文档已写，**用户尚未在控制台操作**） | 📄 |

---

## 未完成的需求

| 需求 | 前置条件 | 难度 |
| --- | --- | --- |
| 首页「加载更多」也拆成按需（`src/pages/index.astro` 还占 5.60 KB 行内，gzip 余量只剩 10 字节） | 无 | 小~中 |
| 阅读位置记录 + 恢复提示（空格跳转、可自定义组合键） | 无 | 中 |
| 「造物主」命令面板（双击 Ctrl 唤出，输入 `search`/`setting` 跳转） | 无 | 中 |
| 「库」知识库（分类整理技术速查，如 GitHub 文件查找、ASCII 表） | **需用户先定分类体系** | 中 |
| 用户系统（注册 / 只读账号 / 云端日志） | 用户已选**方案 A（Cloudflare Access）**，但 Access 做不到「注册」和「只读角色」，真要做需自建 D1 后端 | 大 |
| 文章元数据整理 | 用户明确说**先不做** | — |

---

## 踩过的坑（重要，别重复）

### 0. 首屏 JS 预算到底怎么算（这次的战场）

- 红线是 **10 KB**，但账要按**真实传输**算：`dist/index.html` 里的行内脚本
  **加上** `<script src>` 直接引的入口 chunk（gzip 后）。
  Astro 会把小组件脚本内联进 HTML，别以为写了 `<script>` 就一定是外链。
- `tools/audit-dist.mjs` 第 2 节是唯一裁判。它还会扫「引擎特征串」
  （`excerptLength` / `search-hit` / `pagefind.js`）确保引擎没溜回首屏。
- 现在是 **9.99 KB**，余量只有 10 字节。往首屏加任何 JS 之前先想清楚，
  或者顺手把「加载更多」也拆成按需。

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
**收尾括号丢了，构建报 `Expected }' but found EOF`，连修四轮没修好，最后回滚。**

正确做法：**原样包裹**，内部一个字符都不动 ——
`export function init() { <原body完整粘贴> }`，改完立刻用
`npx esbuild <file> --outfile=probe.js` 验证语法再提交。
（2.5.0 这次是这么做的：用脚本按行切片搬过去，再逐行比对确认
「去掉缩进后与原 body 完全一致」，然后 esbuild 过一遍。）

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

### 7. 懒加载模块的「初始化时机」陷阱（2.5.0 新踩）

拆成按需加载后，模块 `init()` **必然在用户还没输入时执行**，
所以任何 `if (input.value.trim()) { 补跑搜索 }` 都**永远不会成立** ——
写的时候觉得很合理，跑起来静默失效。
正确写法：**先无条件挂兜底**（`setTimeout(..., 240)`），
触发时再判断「有没有值 / 是不是已经有结果」。
`tools/smoke-search.mjs` 第 2 节就是专门盯这条的，别删。

同类问题：键盘唤起（`/`、Ctrl+K）是**引导脚本先聚焦、再下载模块**，
用户敲进去的字一定落后于 `init()`，所以引导脚本本身要么接住第一下，
要么保证引擎里有兜底 —— 两者至少要有一个。

### 8. `astro check` 的存量噪音（别被吓到，也别背锅）

`npm run check` 是 **astro check**，跟这次的改动无关，它现在报 **76 个 error**，
全部是老代码（`index.astro` 30 / `PostLayout` 17 / `changelog` 13 /
`search-guide` 6 / `SettingsPanel` 4），都是内联脚本里的 `implicitly has an 'any' type`。
	extbf{`search-engine.ts` 与 `SearchBox.astro` 现在是 0 error}，改完这两个文件可以拿
`npx astro check 2>&1 | Select-String 'search-engine|SearchBox'` 单独看。
**它不参与 `npm run build`**，所以不影响部署；`npm run check:all` 跑的才是三项自检。

### 9. 沙箱限制（本环境特有）

- 早先 `astro build` 在本沙箱跑不起来（spawn EPERM / Vite 内部报错），
  所以才有 `tools/verify.mjs`（源码层）和 `tools/audit-dist.mjs`（产物层）。
  **2.5.0 这次 `npm run build` 能正常跑通了**（约 1.3 s），先试构建，失败再退回自检。
- 本环境**没有浏览器**，所以搜索的运行时验证靠
  `tools/smoke-search.mjs`：极简 DOM 假件 + 假 Pagefind，
  把 `dist` 里真实的按需 chunk import 进来跑。
- 系统 PowerShell 里 `node -e "..."` 的嵌套引号极其容易炸，
  写超过一行的脚本请落到 `tools/_probe.mjs` 再 `node` 跑，别跟引号搏斗。

---

## 关键文件地图

| 文件 | 作用 |
| --- | --- |
| `astro.config.mjs` | `SITE` 决定 canonical / sitemap / RSS 的绝对地址 |
| `src/lib/covers.ts` | 封面池，加图改这里 |
| `src/lib/posts.ts` | 文章查询与派生字段 |
| `src/scripts/search-engine.ts` | **搜索引擎本体（按需）**，导出 `init()` |
| `src/scripts/settings-panel.ts` | 设置面板逻辑（按需） |
| `src/components/SearchBox.astro` | 搜索 UI + 引导脚本（只负责「什么时候拉引擎」） |
| `src/layouts/BaseLayout.astro` | SEO / 防闪白内联脚本 / reveal / 滑动模糊 |
| `src/styles/theme.css` | 配色令牌（`--a`/`--g` 分量派生）+ 皮肤 |
| `src/styles/global.css` | 全部组件样式（单文件，约 1000 行） |
| `tools/verify.mjs` | 源码自检（含按需模块必须只被 `import()` 引用） |
| `tools/audit-dist.mjs` | 产物验收（PRD 红线的唯一裁判，含「引擎没回首屏」回归） |
| `tools/smoke-search.mjs` | 搜索运行时冒烟测试（改搜索前后都跑） |
| `DEPLOY.md` | 部署 / Cloudflare Access / Lighthouse / 排查表 |
| `CHANGELOG.md` | 版本历史 |

---

## 下一段对话建议的第一句话

> 读一下 `D:\DS\yuuu-blog-v2\HANDOFF.md`，然后继续做「阅读位置记录 + 恢复提示」。

（备选：把首页「加载更多」也拆成按需，给首屏 10 KB 红线留点余量 ——
`src/pages/index.astro` 现在还是 5.60 KB 行内，其中一半是加载更多与分类筛选。）
