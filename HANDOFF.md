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

### 9.35 ★★ 两条铁律（都是血换来的）

**铁律一：二进制内容绝不能用「文本」那条路搬。**

图库「换分类」时我用了 `ghGetFile`（UTF-8 解码）+`toBase64`（重新编码）。
一张 55965 字节的正常 JPEG 变成了 104912 字节的 UTF-8 替换字符（U+FFFD）：
每个非法字节变 3 字节，图完全打不开。站点上那个 URL **返回 200**，
所以从「文件在不在」这个角度看一切正常 —— 用户只会说「图丢了」。

规矩：**凡是图片/字体/压缩包这类二进制，全程走 base64，一步都不解码。**
worker 里已经分开两个函数：`ghGetFile`（文本/Markdown 用）和
`ghGetBlob`（二进制用，返回原始 base64）。加新功能时先问一句「这是文本还是二进制」。

**配套的测试教训**：假 GitHub 如果把 `content` 解码成文本再编码回去，
**它就永远测不出二进制损坏**。桩必须和真的行为一致（`content` 永远是 base64），
并且断言要**逐字节比对**，不能只比长度。

**铁律二：`dist/` 和 `public/` 下的每一个文件都是公开的。**

我把「后台搜索索引」（含全文、草稿、隐藏文章）生成到了 `dist/private/`，
于是 `https://yuuu.love/private/posts-index.json` 任何人都能下载。
「私人角落」的隐私**从来不是靠文件藏得深**，而是靠 Worker 的口令门槛 ——
`/private/posts.json` 之所以可以放，是因为它**只有元信息**（标题/日期/摘要）。
一旦某份文件里含正文，它就只能待在 **KV** 里（由 Worker 凭 ticket 提供）。

`npm run audit` 第 8.55 节现在会拦这个：公开目录里出现正文类文件即失败。

### 9.4 两个「表现离原因很远」的坑（都踩过）

**① 正则的 `^…$` 是整串匹配，不是后缀匹配**

列图库时我写了 `const IMAGE_EXT = /^(jpe?g|png|gif|webp|avif|svg|bmp)$/i`，
本意是「后缀必须是这些」。结果：

- 上传时传进来的是**裸后缀**（`'png'`）→ 碰巧为真，上传一切正常
- 列图片时传进来的是**完整路径**（`'表情包/a.png'`）→ 全部判为非法 → **列表永远是空的**

表现成「能上传、但列表没图」，很难往一个正则上想。要判后缀应该写
`/\.(jpe?g|png|…)$/i`。**教训：同一个正则被两处调用、而两处传的字符串形态不同时，
特别容易只测通一处。**

**② 用户报「结尾换行被吞」，先写断言再改代码**

用户说手机保存后结尾的换行没了。我没有直接去改，而是先在
`check-worker-admin.mjs` 里写了 6 种换行场景（结尾 3 个空行、结尾 1 个换行、
中间连续空行、行尾空格、CRLF、列表缩进），断言**正文逐字符等于提交内容**。
结果发现 Worker 侧本来就是对的 —— 唯一「不保留」的是 CRLF 原样留着（会和站点的 LF 混）。
于是正确的修法只有一行：`replace(/\r\n/g, '\n')`，其余一律不动（**不许 trim**）。
如果当时直接去「修」，很可能把好端端的保留逻辑改成裁剪。

顺带记一个测试自身的坑：比对落盘内容时我数偏移量取正文，**数错了三次**。
最后改成「在提交内容里找正文的第一行、从那里切」—— 别再数偏移。

### 9.45 ★ Cloudflare Pages 的构建会**卡住不动**，以及怎么救

2026-09-18 遇到：GitHub 上 `main` 已经到 `140c403`，但线上一直停在
`7226479` 那次构建，中间五个提交**一次构建都没触发**。用户那边看就是
"CF 一直卡在某个提交"。

排查顺序（都是本地能做的，不用登后台）：

1. `git ls-remote origin refs/heads/main` —— 先确认**远端真的是最新**（排除没推上去）
2. `npx wrangler pages project list` —— 看项目名（本站是 `yuuu-blog`）、Git 集成状态、
   "Last Modified"（有时间说明刚有动静）
3. `npx wrangler pages deployment list --project-name yuuu-blog` —— **关键**：
   看每个部署对应的提交、环境、时间。这里能看出「最新提交有没有部署」
4. 拿线上的标记文件跟各提交对比：
   `curl.exe -s -o NUL -w "%{size_download}" https://yuuu.love/admin/m/app.js`
   + `git cat-file -s <rev>:public/admin/m/app.js`
   （**要用字节数，别用 JS 的 `length`** —— 中文一个字符占 3 字节，我因此误判过一轮）

救法：`npx wrangler pages deploy dist --project-name yuuu-blog --branch main --commit-hash=<唯一值>`

⚠️ **最容易踩的坑**：`--commit-hash` 如果跟已有的部署相同，CF 会认为"同一个提交"
而**复用那个旧部署**，wrangler 会报 `Uploaded 0 files (117 already uploaded)`、
部署 ID 一直不变 —— 表现就是"部署成功但线上没变"。
用当前时间戳当 hash（比如 `20260918233000`）就能强制新建部署。
另外别忘了 **`dist` 必须是刚构建的** —— 我第一次就是拿旧 dist 传上去的，
线上自然没变（源码 `public/admin/m/app.js` 4974 字节，而 `dist` 里还是 4299）。

### 9.5 手机后台这件事的最终结论：**别改别人的桌面 UI，另做一个**

Decap 后台在手机上只能"缩放显示"（800px 布局塞进 390px 屏幕，字小到看不清、
说明文字被压成每行 1–3 个字的竖条）。我先后试了两版 CSS 覆盖：

| 做法 | 结果 |
| --- | --- |
| 拆掉 `min-width:800px` | 界面按 390px 排，但 Decap 内部按 800px 假设算尺寸 → 乱 |
| 再加 `SplitPane{display:block}` + `.Pane{height:calc(100dvh-66px)}` | 栏位高度被钉死 → 进文章**只剩白板** |

最后全部撤掉（见 9.95 的规矩），改为**另做一个手机专用页 `/admin/m/`**：
纯 HTML/CSS/JS、零依赖、逻辑与 UI 都在自己手里，就不存在"覆盖别人布局"的问题。
分工是：规则在 `public/admin/m/app.js`（可被 node 直接测）、界面在 `ui.js` / `ui.css`、
写仓库在 Worker（**token 只在服务端**，浏览器只拿 ticket）。

这条值得推广成一条通则：**给第三方桌面 UI 做移动端适配，成本远高于重做一个窄场景页面。**

### 9.51 往仓库写文件的代码，必须验「它实际提交了什么」

`/admin/m/` 的保存是**往用户 GitHub 仓库写文件**，光看代码觉得对不算数。
`tools/check-worker-admin.mjs` 的做法可以直接抄：把 worker 的 fetch 处理函数拿来直接调、
把全局 `fetch` 换成假的来拦截 `api.github.com`，于是能在本地完整跑「新建 / 保存 / 校验 / 删除」，
并断言提交内容。它逮到过两个真 bug：

- 新建文章（`rel` 为空）被文件名校验正则误拦 —— 空串永远不匹配，一律 400；
- 正文长度规则和 `tools/verify.mjs` 不一致（我多写了"去掉标点再数"），
  会导致手机说能存、构建时被 verify 拦下。

顺带一条：**给手机页做端到端测试时，CDP 的 `Fetch.enable` 拦截在这个环境里不生效**
（请求直接 `Failed to fetch`）。可靠的替代是在页面里用
`Object.defineProperty(window, 'fetch', {...})` 换成假实现 —— 探针在 ui.js 之后加载，
但真正的请求都是用户操作触发的，所以在时间上完全来得及。

### 9.52 用模块脚本的页面，测试必须等它就绪

`type="module"` 的脚本是**延迟执行**的。探针一开始在 1.6 秒时就派发 `submit` 事件，
那时 `ui.js` 还没执行、监听器还没挂上 —— 事件发给了空气，表现为"点了没反应"，
而且页面上不报任何错，很容易误判成业务逻辑坏了。
现在 `ui.js` 末尾写了一个 `window.__READY = true`，探针先等它再操作。

### 9.55 用「数据」排序的功能，验收必须拿**真实数据**跑

「最近修改」这个排序栽过两次，两次都不是代码错，而是**数据**让它退化成和别的排序一样：

1. 第一版：清单里根本没有 `updated` 字段 → 「最近修改」等于「最新发布」。
2. 第二版：兜底用 `git log -1 --format=%cs`，**只精确到天**。同一天改过好几篇时
   日期全一样 → 又退化成一样。用户第二次报「三种切换没区别」。

教训：**排序这种东西，光看代码对没用，要拿真实数据算出三种结果、逐字比。**
第一次我只用「日期互不相同」的假数据验过，所以洞一直留着。
现在已经写进 `npm run audit` 第 8.5 节：拿 `dist/private/posts.json` 真实清单
跑三种排序，只要有两种结果相同就判失败。改排序相关的代码**先跑 audit**。

另外两个附带结论：
- 兜底用 git 日期时，`%cs`（天）不够，要 `%cI`（秒）。
- 别用「文件修改时间」当兜底 —— 构建环境 clone 下来所有文件 mtime 是同一时刻。
- 还需要一个**不依赖 git** 的次要依据：清单里存 `touches`（改过该文件的提交数）。
  同一批提交碰过的文件，连 ISO 时刻都会完全相同。

### 9.56 排序规则不要留在 .astro 的 is:inline 脚本里

逻辑写在 `private.astro` 的 `is:inline` 脚本里，node 侧的检查就只能**照抄一份**，
抄完两边开始漂移，出问题时讨论的根本不是同一段代码。
现在规则在 `src/lib/sort-posts.ts`，审计 import 它跑真实数据；
页面里因为 `is:inline` 不能 import，仍有一份等价实现 —— 文件里注明要一起改，
审计兜住不一致。

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

### 9.8 后台（Decap）的问题：别靠读源码猜，用无头 Edge + CDP 真跑一遍

**做出这个能力的钥匙**：Decap 的 GitHub 后端可以「假登录」——
`localStorage['decap-cms-user']` 写一个带 **`backendName: 'github'`** 的假 user
（这一步漏了就一直停在登录页，害我卡了很久），再把 `window.fetch` 里
`api.github.com` 的请求拦下来喂合成数据（`/user`、`/repos/...`、
`/git/trees/<branch>:<dir>`、`/contents/<path>`、`/graphql`），
就能在本地进**真实编辑器**、量真实几何、截图。注意：

- **探针的 backend 里不能带 `base_url`** —— 带了会走 OAuth 跳转（点登录按钮也没用），
  不带才走本地 token 直连。
- `/repos/...` 的响应必须有 `owner.login`，否则 `hasWriteAccess()` 抛
  `Problem fetching repo data from GitHub`（这个错只出现在 console 里，很隐蔽）。
- 列表页在假数据下可能不渲染，但**编辑器路由可以直接开**：
  `#/collections/posts/entries/<slug>`（slug = 文件名去掉 .md）。
- 想拿几何/样式就用 `Emulation.setDeviceMetricsOverride`（`mobile: true`）+
  `Page.captureScreenshot`；配 `visualViewport` 一起看才知道有没有横向溢出。

**为什么值得**：后台的毛病几乎全是「桌面写死、手机没管」，
翻压缩过的 bundle 只能猜到大概，量一次就全清楚了。这次量出来的实据：
390×844 的视口里 `innerWidth` 被撑到 800（`min-width:800px` 硬编码在
`AppMainContainer`/`ToolbarContainer`/`EditorContainer` 上），
编辑器在 760px 以上是左右分栏（各 400px），`body` 只有 56px 高而底色画在 `body` 上
（`html` 透明 → 露出来的是浏览器画布的白色 = 底部那条白条）。

### 9.9 手机后台那两条毛病的因果（改之前先看这里）

- **底部白条**：`html` 背景是透明的、底色只画在 `body` 上，`body` 又只有几十像素高。
  地址栏收放 / 键盘弹起时露出的那圈就是浏览器画布自己的颜色。修法是 `html` 一起刷同色。
- **点输入框整页上移、看不到打什么**：界面高度原来靠 `height:100%` + 写死的
  `padding-top:66px` 凑，手机键盘弹起 / 地址栏收放都会错位；再加上
  `EditorContainer` 是 `overflow:hidden`，浏览器的「把聚焦输入框滚进可视区」
  滚动链被截断，于是整页被推走。
  修法：窄屏用 `100dvh`、把 `overflow` 放开成可滚、
  给滚动容器加 `scroll-padding-bottom: 45dvh`（`scroll-margin-bottom` 同理）。
  这类问题**光看代码很难判对**，改完一定要在真手机上看（本环境没有软键盘）。

### 9.95 别人的组件库，不要替它算布局（后台白板事故）

Decap 的后台在手机上被我用 CSS「修」成了一片白板，PC 端却正常。加的东西是：

```css
[class*="SplitPane"] { display: block !important; }
[class*="Pane"] { height: calc(100dvh - 66px) !important; }
```

**为什么必错**：Decap 的编辑器是 SplitPane，`flexDirection: column` +
绝对定位 + **百分比高度**，高度靠 `100%` 从 `html/body` 一层层算下来。
把栏位高度钉成视口高、又把 flex 容器改成 `block`，分栏就塌了 —— 内容区高度归零。

**规矩**：面对第三方 UI 组件，只改「约束」和「皮肤」，**不要碰它的布局与高度**：

| 可以改 | 不要改 |
| --- | --- |
| `min-width` 这类硬编码的桌面下限 | `display` / `flex-direction` |
| 颜色、字体、圆角、阴影 | `height` / `max-height`（百分比体系里尤其危险） |
| `scroll-padding` / `scroll-margin`（不参与布局） | `overflow`（会截断滚动链，键盘行为更糟） |
| `env(safe-area-inset-*)` 内缩 | `position` |

顺带：上一版我还改了 `overflow`，本意是「让滚动链通、输入框能滚进可视区」，
结果更乱。**键盘相关的问题，先用 `scroll-padding-bottom` 解决**，别动 overflow。

还有个过程教训：我改完只验了「`innerWidth` 不再溢出」这一个数值就宣布修好，
没验「编辑器还能不能正常显示字段」。**验收要盯用户看得见的结果，不是中间指标。**

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
