# 更新历史

> 版本号语义化：主.次.修订。每次改动在这里加一节。

## 2.7.0 · 2026-09-18

### 新增

- **私人角落**（`/private/`）：口令在 **Worker 里校验**，口令不对连文章清单一根毛都拿不到
  （不是前端比对字符串那种一看源码就穿的形式）。通过后展示被隐藏的文章，
  支持全文搜索与三种排序；进入 / 离开都记日志（IP、设备、时间、停留秒数），
  `/admin/logs/` 可看、可导出 CSV、`?all=1` 翻全部历史。
  日志在 KV 里分两层：热数据 `log:<id>`（留 90 天）+ 永久归档 `day:YYYY-MM-DD`（不设 TTL），
  所以 90 天到期只影响按条查看，历史统计不会跟着消失。
  同一 IP 连错 5 次锁 15 分钟（`fail:<ip>` 计数）。
  > 说清楚边界：这是**防君子**。站点是纯静态的，文章本体没有加密，
  > 知道真实 URL 的人仍然看得到，写秘密请另想办法。MAC 地址浏览器根本不给，做不了。
- **排序下拉**（`src/components/SortSelect.astro`）：主页与私人角落共用。
  没用原生 `<select>`（它的展开列表由浏览器画，圆角 / hover 都改不了），
  按钮和列表自己画，真正的 `<select>` 留在 DOM 里只存值 —— 表单语义和可达性都保住，
  页面代码照旧 `getElementById + change` 就行。三种排序：最新发布 / 最早发布 / 最近修改。
- **卡片风格 × 皮肤**：卡片 4 种（玻璃 / 描边 / 纸质 / 浮起），皮肤 7 套
  （枫丹 / 歌剧院 / 深海 / 薄荷 / 琥珀 / 翡翠 / 靛蓝），设置面板里带缩略图。
- **置顶**：`pinned: true` 的文章排在最前并显示图钉与左侧金线。
- 日记类（`category: 日记`）默认隐藏，被隐藏的文章也能带着 `?from=search` 跳进私人角落。

### 修复

- **「最近修改」排序看起来没反应 —— 其实是真的没生效**。
  排序的下拉箭头、选项高亮、写回隐藏 `<select>`、派发 `change` 都由 SortSelect 组件负责，
  重排列表则由页面脚本负责，**两半之间的那根线在人手里**。私人角落只写了前一半：
  `change` 事件发出去没人接，于是选中项变了、列表纹丝不动。
  （上一轮只验证了「组件会派发 change」，没验证「页面接住了」—— 验证做了一半。）
  以及 `const again = ...` 那行被一次编辑压进了上一行的注释里，一直靠浏览器的
  「带 id 的元素自动成为全局变量」兜着，属于埋着的雷，一并修掉。
- **新增 `npm run check:sort`**（`tools/check-sort-link.mjs`）盯死这类断线：
  把产物里**真实的**两段脚本一起放进假 DOM，点每个选项并断言
  「值写回 → 列表确实重排 → 三种顺序两两不同」。
  已反向验证过：把 `change` 监听拆掉它立刻失败（exit 1），不是个只会点头的测试。
  已接进 `npm run check:all`。
- `npm run check:all` 不负责构建（它验的是已有的 `dist`），
  改完源码要单独跑 `npm run build` —— 这次差点被它骗过去（源码改好了、`dist` 还是旧的，
  于是测试「依然失败」，看着像修错了地方）。

---

## 2.6.0 · 2026-09-16

### 新增

- **隐藏文章**（日记不想被看见）。判定两条，满足其一即可：
  `category: 日记`（自动，日常用这个）或 `private: true`（手动，给非日记的文章）。
  生效范围：首页 / 归档 / 标签云 / 标签页 / 分类筛选 / Pagefind 搜索 / RSS /
  sitemap / 上一篇下一篇导航 / 搜索引擎收录 —— **全都不出现**；
  但**直接开链接仍然能看**（纯静态站没有登录，这是能做到的极限，写秘密请另想办法）。
  - 规则只有一处实现：`src/lib/hidden.ts`。渲染期和构建配置期共用它 ——
    后者不能 import `src/lib/posts.ts`（那会拖进 `astro:content` 这个渲染期才有的
    虚拟模块，构建配置阶段直接报 "Cannot find module 'astro:content'"）。
  - 分享卡片（og:description）对隐藏文章换成中性摘要，免得链接被贴出去时摘要外泄。
  - 后台加了「隐藏」开关，并说明「选日记分类会自动隐藏」。
  - `npm run audit` 新增第 8 节：逐项验收上述每个出口，泄漏即失败。

### 修复（这一节里有两个「本地能跑、线上必炸」的坑）

- **幽灵依赖又咬了一次**：`astro.config.mjs` 里 `import 'yaml'` 借用了 astro 的传递依赖 ——
  npm 会把它提升到顶层所以本地构建正常，Cloudflare 用 pnpm 的隔离模式时
  直接报 `Cannot find module 'yaml'`、整个站点发不出去。
  现在构建配置里只用极小的正则取需要的两个键；
  `tools/verify.mjs` 里的同类借用改成把 `yaml` 显式写进 devDependencies。
- 同样是这一类：`astro.config.mjs` 一开始想直接 `import { getPosts } from 'src/lib/posts'`，
  而那个模块依赖 `astro:content`（渲染期的虚拟模块），构建配置阶段加载会失败 ——
  所以判定规则抽到了独立的 `src/lib/hidden.ts`，两边共用。
- 可选日期允许空值。网页后台清空「最后修改」时会写 `updated: ''`，
  `z.coerce.date()` 把它转成 Invalid Date 对象，Astro 报
  `InvalidContentEntryDataError`、整个站点构建失败。

- `tools/verify.mjs` 两处对齐：schema 同样处理空值；
  frontmatter 改用真正的 YAML 解析器（原来手写的那版只认 `tags: [a, b]`，
  遇到后台保存出来的多行列表就误报 schema 错）。
- `audit-dist.mjs` 的「加载更多」检查改为按公开文章总数判断 ——
  公开文章不足一页时本来就没有下一页，缺 `api/posts/*.json` 是正确的。

---

## 2.5.1 · 2026-09-16

### 新增

- **写作流程脚本化**，三条命令：
  - `npm run new` —— 逐条问（标题 / 日期 / 分类 / 标签 / 封面样式 / 摘要），
    直接回车用默认值；也支持 `npm run new -- "标题" 技术 "前端, 笔记"` 一条命令建好。
    生成的草稿带 `draft: true`，构建时会跳过，先写草稿是安全的。
  - `npm run posts` —— 在资源管理器里打开文章目录。
  - `npm run publish` —— **自检 → 构建 → 提交 → 推送**一条龙。
    构建不过就什么都不提交（不会把错误推上去让 Cloudflare 报错）；
    有草稿会列出来提醒；提交说明写进临时文件再 `git commit -F`，
    绕开 cmd.exe 下 `git commit -m "中文"` 乱码的问题。
- README 补「写文章」完整章节：三种写法、改文章、本地预览、什么才算发布，
  以及**为什么必须 push 才会更新线上**（线上是 Cloudflare 在构建 GitHub 仓库）。

### 修复

- **主题切换的太阳 / 月亮图标没有居中**。原来用的是 `☾` / `☀` 两个 Unicode 字符 ——
  它们的墨迹在字体 em 框里的位置随系统字体变，靠 CSS 居中在有些机器上会偏上或偏下。
  改成内联 SVG（`viewBox` 收紧到图形包围盒），居中由几何决定，不看字体脸色；
  旋转切换动画保持不变。已用 Edge 无头截图逐个核对深色 / 浅色两种状态。

---

## 2.5.0 · 2026-09-16

### 新增

- **`npm run smoke`**（`tools/smoke-search.mjs`）：搜索的**运行时**冒烟测试。
  `verify` / `audit` 只能证明「引擎没进首屏、chunk 切出来了」，
  证明不了「用户聚焦之后它真能跑」。这个脚本用一个极小的 DOM 假件
  把 `dist` 里真实的按需 chunk 跑一遍：init 幂等、补跑第一次输入、
  渲染结果、↑↓ / Enter / Esc / Ctrl+K /「/」/ 清空、索引缺失时的诊断分支。
  改搜索引擎之前先跑它。另加 `npm run check` = verify + smoke + audit。

### 性能

- **搜索引擎改成按需加载**（`src/scripts/search-engine.ts`）。
  `SearchBox.astro` 里只留一个引导：**聚焦输入框 / Ctrl+K /「/」** 时才
  `import()` 引擎本体。首屏要下的 JS 从 **16.37 KB 降到 9.99 KB**（gzip 后
  实际传输），第一次达标 PRD 的 10 KB 红线 —— 其中行内 7.88 KB、外链 gzip 2.11 KB。
  引擎自己的 chunk 是 7.80 KB（gzip 3.33 KB），用户一动手才下载。
- 引导分两段：快捷键与「正在准备搜索…」占位现在就装好，
  保证 Ctrl+K /「/」**第一次按下**就有反应；引擎初始化要一点时间，
  那之前敲进去的字由引擎 `init()` 里的 240ms 补跑接住。
- 引擎 chunk 下载失败（离线 / 404）会在面板里明说，不会静默留个「正在准备搜索…」。

### 修复

- 补跑第一次输入的逻辑原来写成 `if (input.value.trim())`，而 `init()` 执行时
  输入框必然是空的 —— 这个分支**从来没生效过**。现在无条件挂 240ms 兜底，
  触发时再判断（已经有结果或已清空就跳过）。冒烟测试专门盯这条。
- `tools/verify.mjs` 增加「按需模块」检查：搜索引擎 / 设置面板只允许被
  `import()` 引用，一旦有人改回静态 import 会立刻报错。
- `tools/audit-dist.mjs` 增加产物层回归：首屏脚本里出现
  `excerptLength` / `search-hit` / `pagefind.js` 等引擎特征串即判失败，
  并核对引导里的 `import()` 确实指向那个按需 chunk。

---

## 2.4.0 · 2026-09-16

### 新增

- **搜索查询语法**。支持 `in:title,tag`、`tag:前端`、`category:技术`、
  `date:2024-01..2024-12`、`words:500..2000`、`min:1..5`，以及 `"精确短语"`。
  文章页的 `sr-only` 区块里补齐了 `data-pagefind-filter` / `data-pagefind-meta`，
  筛选走 Pagefind 原生筛选器，区间比较在客户端做。搜索时面板顶部会显示生效的条件。
  > 注：需求里提到的 `size:1024..4089` 是文件管理器的语义，博客文章没有「文件大小」，
  > 已改用语义等价的 `words:`（字数）与 `min:`（阅读分钟）。
- **皮肤系统**。`theme.css` 改成「主色只存 RGB 分量 `--a` / `--g`，其余全部派生」，
  皮肤只需覆盖这两行，线条 / 悬停 / 渐变 / 极光背景一起跟随。
  三套皮肤：枫丹（水蓝）、歌剧院（玫瑰）、深海（幽紫），深浅各一份压暗版。
  主题面板可同时切模式与皮肤。
- `--accent-solid` / `--gold-solid` 用 `@property` 注册成 `<color>`，
  这样**渐变里的色标也能平滑过渡**，而不是硬切。

### 修复 / 调整

- **搜索聚焦聚光**：整页模糊变暗，搜索框高亮，导航淡出。
  遮罩是 `pointer-events: none`（PRD 硬性要求，旧版漏了会导致全站点不动）。
- **搜索结果只展示一次**：点别处关掉后会连结果一起清空，再次聚焦不会又冒出来。
- **首屏禁止选中**（`.no-select`），正文不受影响。
- **顶部导航精简**为 首页 / 关于 / 更新，归档与标签交给页脚（页脚本来就有）。
- 搜索框光标与输入内容**始终居中**。

---

## 2.3.1 · 2026-09-16

### 新增

- **封面池**（`src/lib/covers.ts`）。文章 frontmatter 的 `cover` 现在支持三种写法：

  | 写法 | 含义 |
  | --- | --- |
  | `cover: stand` | 用封面池里的（推荐） |
  | `cover: /covers/my.jpg` | 用你自己的图（`public` 下的绝对路径） |
  | `cover: https://…` | 外链 |

  不写则按 slug 从池子里**稳定**挑一张 —— 同一篇文章每次构建拿到的封面一致，
  不会刷一次换一张。12 篇示例文章已全部改成池子 id。

### 调整

- **主页首屏占满一屏**（`calc(100svh - 68px)`），默认看不到文章列表。
- 首屏只留徽记 + `FONTAINE · FURINA` + `yuuu` + 一行统计，砍掉了原来的长句和大标题。
- 徽记放大到 `clamp(148px, 22vw, 244px)`，站名放大到 `clamp(54px, 12vw, 124px)`。
- **下滑时首屏整体缩小 20% 并淡出**（只动 transform / opacity），文章版块顺势接上来。
- **更新历史里内容本来就装得下的版本，不再显示「展开」按钮** —— 点了没新内容很迷惑。
  改成按 `scrollHeight` 实测判断。

### 移除

- **海浪背景**。它原本对齐首屏底边，首屏改成满屏后会横在正文中间，
  滚动时又赖着不走。已连同 `Background` 的 `waves` 属性和 CSS 一起删除。

### 修复

- **搜索框光标默认停在中央**（`:placeholder-shown` 时 `text-align: center`），
  一开始打字就回到左对齐，避免边打边跳。

---

## 2.3.0 · 2026-09-16

### 新增

- **真的 favicon**。用 `tools/make-icons.mjs` 处理参考图：从四条边泛洪填充抠背景
  （不是「白色变透明」—— 角色头发也是白的，那样会打出窟窿），裁边，
  输出 `favicon.ico`（16/32/48 三尺寸）、`icon-192/512.png`、`apple-touch-icon.png`
  和一份 `site.webmanifest`。
- **7 张表情包**处理成透明背景的 WebP，放在 `public/mascot/`，用作文章封面与空状态插画。
- **主页重构成两屏**：首屏只有徽记、站名、一句话和统计；文章列表整体下沉 +
  模糊，滚进视口后一次性浮现。下滑提示带轻微浮动动画。
- **搜索快捷键 `/`**（`Ctrl/Cmd+K` 保留）。↑↓ 在结果间移动，Enter 打开选中项。
- **从搜索结果点进文章会定位**：链接带上 `?q=`，文章页找到正文第一处匹配，
  包上 `<mark>` 并 `scrollIntoView({ block: 'center' })` 滚到屏幕中央，
  配一个只动 opacity/transform 的脉冲圈。
- **更新历史按版本折叠**：默认只展开最新一版，其余收成 170px 并底部渐隐，
  每段有「展开/收起」，顶部有「全部展开」。
- `tools/set-domain.mjs` + `pnpm run domain`：一条命令改全站 6 处域名。

### 修复

- **首页分类筛选点任何分类都是 0 篇**。`index.astro` 读 `el.dataset.category`，
  但 `PostCard.astro` 从来没输出过 `data-category`，永远是 `undefined`，
  所有卡片都被 `hidden`。已补上属性。
- **搜索框光标被 placeholder 遮住**。快捷键提示原本写在 placeholder 里，
  聚焦后文字紧贴光标。现在提示做成独立的 `<kbd>` 徽标，聚焦后淡出，
  placeholder 在聚焦时也变透明。
- **卡片 hover 生硬**。原来 300ms 线性位移 + 阴影重绘。现在统一用
  `cubic-bezier(0.22, 1, 0.36, 1)` 长缓动，阴影改由伪元素淡入
  （不逐帧重绘 `box-shadow`），封面缓慢放大，标题变色。
- `sharp` 之前是幽灵依赖（和 `zod` 一样的坑），已显式声明。

### 与 PRD 的偏离

- **PRD 9.5 禁止用 `filter: blur()` 做动画**，但需求明确要求「文章下沉模糊」。
  采取折中：模糊只在进入视口时过渡一次，`transitionend` 后加 `.is-done`
  把 `filter` 摘掉，不留长期合成层。
  `tools/verify.mjs` 的对应规则也拆成两条：`@keyframes` 里动 blur 一律禁止；
  `transition` 里含 filter 则要求必须配 `.is-done` 摘除。

---

## 2.1.2 · 2026-09-16

### 修复（搜索质量）

- **搜索结果被标签页污染**。构建时 Pagefind 会提示
  `Did not find a data-pagefind-body element on the site. ↳ Indexing all <body> elements`
  —— 意思是它把**整页**都索引了，包括导航栏、页脚和所有标签页。

  实测后果（用 `pagefind.js` 在 Node 里跑真实查询）：

  | 查询 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 芙宁娜 | 1 条，是标签页 `/tags/芙宁娜/` | 3 条，全是文章 |
  | 玻璃 | 6 条，第 1 条是 `/tags/设计/` | 1 条，正是那篇文章 |
  | 雨天 | 6 条（夹着无关标签页） | 1 条 |
  | Astro | **34 条**噪音 | 4 条，全是文章 |

  修法：给 `PostLayout.astro` 的 `<article>` 加 `data-pagefind-body`，
  给底部按钮行加 `data-pagefind-ignore`，只索引正文。
  索引页数从 43 降到 12（只剩文章），这才是博客搜索该有的样子。

- **搜索结果能显示日期了**。给日期元素加 `data-pagefind-meta="date"`，
  SearchBox 里的 `meta.date` 从 `undefined` 变成了 `2024 年 5 月 20 日`。

### 增强

- `npm run audit` 新增两项检查：文章是否都标了 `data-pagefind-body`、
  是否都带 `data-pagefind-meta="date"`。这类问题不看产物是发现不了的。

---

## 2.1.1 · 2026-09-16

### 修复

- **幽灵依赖**。`tools/verify.mjs` 用了 `zod` 与 `@astrojs/compiler`，但没在 package.json 里声明。
  npm 的扁平化把它们提升到顶层所以能跑；**pnpm 的隔离式 node_modules 会正确拒绝**，
  报 `ERR_MODULE_NOT_FOUND`。现已显式声明为 devDependencies，
  并把 verify.mjs 的导入改成动态 import —— 缺依赖时给一句人话而不是甩堆栈。

### 新增

- **`npm run audit`（`tools/audit-dist.mjs`）**：对**真实构建产物**做验收，
  而不是像 verify 那样只看源码。检查首屏 JS 实测字节、首页卡片数、
  加载更多的静态 JSON、Pagefind 索引完整性、RSS/Sitemap、
  以及 `[hidden]` 兜底和 `pointer-events` 保护有没有出现在产物 CSS 里。
- 首屏内联 JS 的构成明细（会打印每段脚本的体积与用途），让性能预算可执行。

### 补充说明

- `build` 是 `astro build && pagefind --site dist`。**astro build 若以非 0 退出码结束，
  pagefind 不会执行，搜索索引会静默缺失**。构建后请跑 `npm run audit` 确认。
- ⚠️ **Windows 的 cmd.exe 里不要把 `#` 注释写在命令同一行**。`#` 在 bash 是注释、
  在 cmd 里不是，整行复制会让后面的命令收到多余参数
  （例如 `npm run build # 说明` 会让 pagefind 报 `unexpected argument '#' found`）。
  仓库里所有代码块都已去掉行内注释，可以整段复制。

### 实测数据（`npm run audit`，Astro 7.3.2 构建产物）

| 项目 | 结果 |
| --- | --- |
| 页面 | 44 个 HTML（12 篇正文 + 25 个标签页 + 归档/关于/更新/标签云/404） |
| 首屏 JS | **8.70 KB**（行内 7.61 KB + 外部包 gzip 1.09 KB），红线 10 KB |
| 第三方脚本 | 公开页面 0 个 |
| 首页首屏 | 正好 10 张卡片，追加走 `api/posts/2.json` |
| Pagefind | 43 页 / 1694 词 / 57 文件 / 643 KB |
| RSS | 12 篇 |
| Sitemap | 42 个 URL |

---

## 2.1.0 · 2026-09-15

### 变更

- **Astro 5.18.2 → 7.3.2**。这是与 PRD「锁死 Astro 5.x」的一处**有意偏离**：
  `npm audit` 对 Astro ≤ 7.2.7 报出 1 critical / 1 high / 1 low，
  逐条核对后确认相关代码路径本项目都没用到，但修复成本只有一行，且已实测兼容。
  **源码一行未改**，`tools/verify.mjs` 在 5 和 7 上都是全绿。
- 包管理器配置补齐：`pnpm-workspace.yaml` 放行 `esbuild` / `sharp` 的构建脚本。
  pnpm 10+ 默认拦截构建脚本并以 exit 1 结束，会导致 Cloudflare Pages 安装步骤失败。
  注意 pnpm 11 已不再读取 `package.json` 里的 `pnpm` 字段，配置必须放这里。
- 同时提供 `package-lock.json` 与 `pnpm-lock.yaml`，**二选一保留**。

### ⚠️ 破坏性要求

| 项目 | 旧 | 新 |
| --- | --- | --- |
| Node | >= 18 | **>= 22.12.0** |
| npm | — | >= 9.6.5 |
| pnpm | — | >= 7.1.0 |

**Cloudflare Pages 的 `NODE_VERSION` 必须从 20 改成 22**，否则构建直接失败。

---

## 2.0.0 · 2026-09-15

用 Astro 从零重构。**这是一次推倒重来**，不是迭代。

### 技术栈（全部锁死）

| 层 | 选型 |
| --- | --- |
| 框架 | Astro（静态输出，默认零 JS） |
| 内容 | Astro Content Collections（frontmatter 强校验） |
| 样式 | Tailwind CSS 4（主题变量走 CSS custom properties） |
| 动画 | View Transitions API + 原生 CSS |
| 搜索 | Pagefind（构建时生成静态索引） |
| RSS / Sitemap | @astrojs/rss / @astrojs/sitemap |
| 部署 | Cloudflare Pages |
| 写作 | Sveltia CMS + GitHub OAuth Worker |

### 新增

- **组件化**：Header / Footer / PostCard / TagCloud / SearchBox / ThemeToggle / Background / CoverStyle，改一处全站生效。
- **内容层交给框架**：不再手写 Markdown 解析器，表格、引用、代码块、任务列表全部由 Astro 处理，frontmatter 有 schema 校验。
- **文件路由**：首页、`/posts/[slug]`、`/archive`、`/tags/[tag]`、`/about`、`/changelog`、`/rss.xml`、`/404`。
- **Pagefind 全文搜索**：索引分片、按需加载，聚焦输入框才开始下载，不占首屏。
- **原生 View Transitions**：水波淡入，零 JavaScript。
- **深色 / 浅色双调色板**：460ms 整体联动过渡。
- **9 种封面样式**：潮汐 / 星云 / 王冠 / 歌剧院 / 极光 / 星海 / 气泡 / 方格 / 自定义图片，全部是 CSS 渐变，零图片请求。
- **首页分页**：首屏只渲染 10 篇，其余由构建时生成的静态 JSON 按需追加。
- **Sveltia CMS**：`/admin` 登录 GitHub 直接写文章，push 后 Cloudflare Pages 自动重建。
- **OAuth Worker**：`workers/oauth`，处理 GitHub 授权的 `/auth` 与 `/callback`。

### 砍掉

- ❌ 音乐播放器（与流畅度冲突）
- ❌ 空闲提醒（鸡肋）
- ❌ 6 种页面切换动画 → 只留 1 种「水波淡入」
- ❌ 装饰性水母 SVG
- ❌ 阅读次数 / 上次阅读时间（需要后端，第一版砍掉）
- ❌ 拼音搜索（Pagefind 中文分词够用）
- ❌ 评论系统（以后再说）

### 性能约定（硬红线）

- 首屏 JS < 10KB —— 实测约 1KB（Astro 默认零 JS，交互脚本全部内联）
- 只动 `transform` 和 `opacity`，不碰 `filter` / `box-shadow` / `width`
- 第三方脚本默认 0 个（统计脚本需手动填 token 才加载）
- 任何功能如果让首屏 JS 超标，砍掉重做

### 从旧版踩坑里继承的禁令

- 禁止用 `display` 覆盖 `[hidden]` 的默认行为（全局已加 `[hidden] { display: none !important; }`）
- 禁止给全屏固定层不加 `pointer-events: none`
- 禁止手写 Markdown 解析器
- 禁止全量加载所有文章到一个 JS 文件
- 禁止用 `filter: blur()` 做动画
- 禁止用 `localStorage` 存文章正文

---

## 1.4.1 · 2024-09-15（旧版）

- 修复全站按钮点不动：空闲遮罩用 `display` 覆盖了 `[hidden]`。

## 1.0.0 · 2024-09-12（旧版）

- 手写静态站点首次上线。
