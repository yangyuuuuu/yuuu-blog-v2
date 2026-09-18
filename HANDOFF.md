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
npm run new       新建一篇文章（逐条问；也可 npm run new -- "标题" 分类 "标签,标签"）
npm run posts     在资源管理器里打开文章目录
npm run publish   发布上线（自检 → 构建 → 提交 → 推送，Cloudflare 自动重建）
npm run verify    源码自检（组件编译 / frontmatter / import / 首屏 JS 预算 / 按需模块）
npm run audit     产物验收（对 dist/ 量 PRD 红线）
npm run smoke     搜索运行时冒烟测试（跑真实按需 chunk，需要先 build）
npm run check:all 上面三项一起跑，提交前跑这个
npm run icons     重新生成 favicon 与表情包素材
npm run domain    换域名（一次改 6 处）
npm run og        重新生成 OG 图
```

> 没有 pnpm 也能跑：仓库里两份 lockfile 都在，`npm` / `pnpm` 都试过。
> README 里写的是 pnpm，实际上用的是 **npm**。

---

## 当前状态

- 工作区分两步看：用户可能会自己改文章，所以**别假设它是干净的**
- `npm run verify` → 全部通过（4 条提示，其中 1 条是用户的草稿标题不是中文开头）
- `npm run smoke` → 全部通过
- `npm run audit` → **产物验收全部通过**（0 条提示）
- ✅ **首屏 JS 达标**：行内 7.88 KB + 外链 gzip 2.11 KB = **9.99 KB**（< 10 KB 红线）
  —— 搜索引擎 7.80 KB（gzip 3.33 KB）已经切成按需 chunk，用户聚焦 / Ctrl+K 时才下载
- ⚠️ **本地领先远端若干提交**：线上是 Cloudflare Pages 构建 GitHub 仓库，
  **不 push 就不上线**。用户以前是手动 push 的，现在有 `npm run publish` 了

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
| **主题图标改成内联 SVG 并严格居中** | ✅ |
| 设置面板（配色 / 列数 / 四个显示开关 / 导入导出） | ✅ |
| 更新历史按版本折叠（短内容自动去掉展开按钮） | ✅ |
| 封面池 `src/lib/covers.ts` | ✅ |
| 文章卡片进出场动画 | ✅ |
| **搜索引擎按需加载**（首屏 JS 压到 10 KB 内） | ✅ |
| **写作流程脚本化**（`new` / `posts` / `publish`） | ✅ |
| Cloudflare Access 加 /admin 门禁（文档已写，**用户尚未在控制台操作**） | 📄 |
| /admin 的 OAuth Worker（`workers/oauth`，**用户尚未部署**） | 📄 |

---

## 未完成的需求

| 需求 | 前置条件 | 难度 |
| --- | --- | --- |
| 首页「加载更多」也拆成按需（`src/pages/index.astro` 占 5.60 KB 行内，gzip 余量只剩 10 字节） | 无 | 小~中 |
| 阅读位置记录 + 恢复提示（空格跳转、可自定义组合键） | 无 | 中 |
| 「造物主」命令面板（双击 Ctrl 唤出，输入 `search`/`setting` 跳转） | 无 | 中 |
| 「库」知识库（分类整理技术速查，如 GitHub 文件查找、ASCII 表） | **需用户先定分类体系** | 中 |
| 用户系统（注册 / 只读账号 / 云端日志） | 用户已选**方案 A（Cloudflare Access）**，但 Access 做不到「注册」和「只读角色」，真要做需自建 D1 后端 | 大 |
| 文章元数据整理 | 用户明确说**先不做** | — |

---

## 踩过的坑（重要，别重复）

### 0. 首屏 JS 预算到底怎么算

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

### 1.5 中文进 git 的两个坑

- `git commit -m "中文说明"` 在 **cmd.exe** 下会因为代码页变成乱码
  （PowerShell 里通常没事）。`tools/publish.mjs` 用的是
  「写进 `.git/DSh-publish-msg.txt` 再 `git commit -F`」，绕开了这个问题。
- **PowerShell 的管道喂给 `node` 的 stdin，Node readline 只能读到第一行**
  （`"a","b" | node x.mjs` 只会拿到 a）。想在命令行驱动交互式脚本，
  要么用参数（`tools/new-post.mjs` 两种都支持），要么用
  `child_process.spawn` 自己喂 stdin。别为这个怀疑脚本写错了。

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
（2.5.0 这次是这么做的：按行切片搬过去，再逐行比对「去掉缩进后与原 body 一致」。）

教训：**不要用正则改有嵌套结构的代码**；写完必须有独立的语法校验。

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

### 7. 懒加载模块的「初始化时机」陷阱

拆成按需加载后，模块 `init()` **必然在用户还没输入时执行**，
所以任何 `if (input.value.trim()) { 补跑搜索 }` 都**永远不会成立** ——
写的时候觉得很合理，跑起来静默失效。
正确写法：**先无条件挂兜底**（`setTimeout(..., 240)`），触发时再判断。
`tools/smoke-search.mjs` 第 2 节就是专门盯这条的，别删。

### 8. 用字符当图标会「看起来没居中」

主题切换原来用的是 `☾` / `☀` 这两个 Unicode 字符。
**字符的墨迹在字体 em 框里的位置随系统字体变**，CSS 怎么调都可能在别人的机器上偏。
现在换成内联 SVG（`viewBox` 收紧到图形包围盒），居中由几何决定。
改完用 Edge 无头截图核对过（见坑 10）。

### 9. `astro check` 的存量噪音（别被吓到，也别背锅）

`npm run check` 是 **astro check**，现在报 **76 个 error**，全部是老代码
（`index.astro` 30 / `PostLayout` 17 / `changelog` 13 / `search-guide` 6 /
`SettingsPanel` 4），都是内联脚本里的 `implicitly has an 'any' type`。
	extbf{`search-engine.ts` 与 `SearchBox.astro` 是 0 error}，改完这两个文件可以拿
`npx astro check 2>&1 | Select-String 'search-engine|SearchBox'` 单独看。
**它不参与 `npm run build`**，所以不影响部署。

### 9.5 「正文太短」只卡要发布的文章

`verify.mjs` 的 20 字下限**不卡草稿**。踩过的坑：用户 `npm run new` 建了草稿、
正文还是占位的那一句，一跑 `npm run publish` 就被第 2 步拦下，
而旧版 publish 在第 2 步失败时只打一句「自检没过」，**真正的错误行被上一步的输出淹了**，
用户以为是自己构建失败。现在第 2 步也原样打印 verify 的输出。

### 9.6 一个功能拆在「组件」和「页面」两半，中间那根线要单独验

排序下拉就是这个结构：SortSelect 组件负责画下拉、写回隐藏 `<select>`、派发 `change`；
页面脚本负责接住 `change` 重排列表。私人角落只实现了前一半，
于是**选项高亮会变、列表纹丝不动** —— 看着像 CSS 坏了，实际是事件没人接。

教训具体到做法上：**「组件派发了事件」和「页面接住了事件」是两件事，要各测一次。**
上一轮只测了前者就宣布修好，返工一轮。

对应资产：`npm run check:sort`（`tools/check-sort-link.mjs`）。
它把产物里真实的两段脚本塞进同一个假 DOM，断言全链路
「点选项 → `select.value` 变 → `change` → 列表重排」，
并检查三种排序结果两两不同。**写这类测试务必反向验一次**：
把监听拆掉、重建、确认它真的红，否则等于养了个只会点头的测试（这次验过，会 exit 1）。

写假 DOM 时踩到的三件事，下次直接抄结论：
- Node 里 `globalThis.navigator` / `window` **是只读或干脆没有**。
  `window = globalThis` 这种别名会让 `window.addEventListener` 找 Node 全局要，必炸 ——
  给一个真的带 `addEventListener` 的对象。
- 选择器匹配要通用（`tagName === sel.toUpperCase()`），别只硬编码 `li` / `button`，
  否则 `querySelector('select')` 静默返回 `null`，组件直接 `return`，看着像没绑上。
- 浏览器里**带 id 的元素会自动变成全局变量**，源码里裸写 `again` 在浏览器能跑、在假 DOM 里报
  undefined。这既是测试要补的 shim，也是源码里该修掉的坏味道。

### 9.7 `check:all` 不构建，改完源码必须单独 `npm run build`

`npm run check:all` = verify + smoke + audit + check:sort，**四步验的都是已经存在的 `dist`**。
只改 `src/` 不重建就跑去 `check:all`，会拿着旧产物得出「修复无效」的结论 ——
这次真的这么骗过去一次（源码是对的，`dist` 落后 6 分钟，白查一轮）。
判断依据很简单：`dist/xxx` 的 mtime 比 `src/xxx` 旧就是没构建。
改完源码的顺序永远是 **`npm run build` → `npm run check:all`**。

### 10. 本环境能做的真实验证（比想象的强）

- `npm run build` **能跑通**（约 1.3 s），早先「沙箱跑不了 astro build」的记录已经过时
- **没有浏览器，但有 Edge**：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
  可以无头截图，验证视觉改动。要点：
  - 用 `file:///D:/...` 这种正斜杠 URL；只写 `D:\...` 会被当成搜索词
  - **必须加 `--virtual-time-budget=3000`**，否则截出来是错误页
  - 加 `--user-data-dir=<临时目录>`，否则多个实例会抢 profile 锁
  - **绝对路径在 `file://` 下全废**（CSS / 图片 404）。
    要看真实页面就 `npx serve dist -l 4400` 起个临时静态服务，
    截完记得把那个后台任务 kill 掉，**不要留着**（用户在 3080 用 DSH Web）
  - 截完删掉临时的 `.edge-profile` 目录和探针 html

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
| `src/components/ThemeToggle.astro` | 深浅切换（内联 SVG 图标） |
| `src/layouts/BaseLayout.astro` | SEO / 防闪白内联脚本 / reveal / 滑动模糊 |
| `src/styles/theme.css` | 配色令牌（`--a`/`--g` 分量派生）+ 皮肤 |
| `src/styles/global.css` | 全部组件样式（单文件，约 1000 行） |
| `tools/verify.mjs` | 源码自检（含按需模块必须只被 `import()` 引用） |
| `tools/audit-dist.mjs` | 产物验收（PRD 红线的唯一裁判，含「引擎没回首屏」回归） |
| `tools/smoke-search.mjs` | 搜索运行时冒烟测试（改搜索前后都跑） |
| `tools/new-post.mjs` | 新建文章（`npm run new`） |
| `tools/publish.mjs` | 自检 → 构建 → 提交 → 推送（`npm run publish`） |
| `DEPLOY.md` | 部署 / OAuth Worker / Cloudflare Access / Lighthouse / 排查表 |
| `README.md` | 日常命令与写作流程（用户最先看这个） |
| `CHANGELOG.md` | 版本历史 |

---

## 下一段对话建议的第一句话

> 读一下 `D:\DS\yuuu-blog-v2\HANDOFF.md`，然后继续做「阅读位置记录 + 恢复提示」。

（备选：把首页「加载更多」也拆成按需，给首屏 10 KB 红线留点余量。）
