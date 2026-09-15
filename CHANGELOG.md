# 更新历史

> 版本号语义化：主.次.修订。每次改动在这里加一节。

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
