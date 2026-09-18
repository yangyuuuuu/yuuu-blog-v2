# yuuu

芙宁娜蓝色系的个人博客。Astro 从零重构，**流畅度是唯一最高优先级**。

- 写作后台：`/admin`（Sveltia CMS + GitHub 登录）
- 订阅：`/rss.xml`　站点地图：`/sitemap-index.xml`

---

## 技术栈（锁死）

| 层 | 选型 | 实际版本 |
| --- | --- | --- |
| 框架 | Astro | 7.3.2 |
| 内容 | Astro Content Collections | 内置 |
| 样式 | Tailwind CSS 4 | 4.3.3 |
| 动画 | View Transitions API + 原生 CSS | 内置 |
| 搜索 | Pagefind | 1.5.2 |
| RSS | @astrojs/rss | 4.0.19 |
| Sitemap | @astrojs/sitemap | 3.7.4 |
| 部署 | Cloudflare Pages | — |
| 写作 | Sveltia CMS + GitHub OAuth Worker | — |
| 统计 | Cloudflare Web Analytics | 按需开启 |

**不做**：评论、音乐播放器、空闲提醒、拼音搜索、阅读次数（需要后端）。

---

## 包管理器

npm 和 pnpm 都可以，仓库里两份配置都准备好了。**只保留一个 lockfile**，否则 Cloudflare Pages 可能判断错包管理器。

### 用 pnpm（推荐）

pnpm 10 起出于安全默认**不执行依赖的构建脚本**，而 esbuild 与 sharp 需要它。
不放行的话 `pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` **退出码 1** 结束，
在 Cloudflare Pages 上会直接导致安装步骤失败、部署中断。

仓库里的 `pnpm-workspace.yaml` 已经放行：

```yaml
allowBuilds:
  esbuild: true
  sharp: true
```

> ⚠️ pnpm 11 已经**不再读取 `package.json` 里的 `pnpm` 字段**（`onlyBuiltDependencies` 会被忽略并告警），
> 配置统一放在 `pnpm-workspace.yaml`。这一点我实测确认过。

**Windows（cmd）**

```cmd
rmdir /s /q node_modules
del /q package-lock.json
pnpm install
pnpm run verify
```

**Windows（PowerShell）**

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
pnpm install
pnpm run verify
```

**macOS / Linux**

```bash
rm -rf node_modules package-lock.json
pnpm install
```

### 用 npm

**Windows（cmd）**

```cmd
rmdir /s /q node_modules
del /q pnpm-lock.yaml pnpm-workspace.yaml
npm install
```

**Windows（PowerShell）**

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force pnpm-lock.yaml, pnpm-workspace.yaml
npm install
```

**macOS / Linux**

```bash
rm -rf node_modules pnpm-lock.yaml pnpm-workspace.yaml
npm install
```

（`pnpm-workspace.yaml` 留着也无害，npm 会忽略它。）

### Windows 用户注意

**先确认自己在哪个 shell**：提示符是 `D:\DS\yuuu-blog-v2>` 就是 **cmd.exe**；
是 `PS D:\DS\yuuu-blog-v2>` 才是 **PowerShell**。命令不通用。

| 问题 | 说明 / 解决 |
| --- | --- |
| `'Remove-Item' 不是内部或外部命令` | 你在 **cmd.exe** 里跑了 PowerShell 命令。改用 `rmdir /s /q node_modules` / `del /q package-lock.json`，或先敲 `powershell` 切换过去 |
| `rm -rf` 报「找不到参数 rf」 | 你在 **PowerShell** 里跑了 Linux 写法。PowerShell 的 `rm` 只是 `Remove-Item` 的别名，**不支持合并短参数**，要写成 `Remove-Item -Recurse -Force 路径` |
| `pnpm.ps1 无法加载，因为在此系统上禁止运行脚本` | PowerShell 执行策略拦截了 pnpm 的 shim。执行一次 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 即可 |
| 路径过长报 `ENAMETOOLONG` / `EPERM` | pnpm 的 `.pnpm` 目录嵌套较深。本项目路径很短（`D:\DS\yuuu-blog-v2`），一般不会遇到；万一遇到，把项目挪到更浅的目录，或在「设置 → 系统 → 开发者选项」里启用长路径支持 |

---

## 关于 Astro 版本

PRD 原本要求锁死 Astro 5.x，但 `npm audit` 会对 Astro ≤ 7.2.7 报出
**1 critical / 1 high / 1 low** 共 3 条告警。

我逐条核对后确认，这些告警涉及的代码路径本项目**全都没有用到**：

| 告警 | 本项目情况 |
| --- | --- |
| `define:vars` XSS | 未使用 |
| Server island 参数重放 | 纯静态输出，没有 server island |
| spread props 属性名 XSS | 没有使用展开属性 |
| `transition:*` 指令 XSS | 没有 hydrated island；用的是 CSS 版 `@view-transition` |
| 未转义 slot name XSS | 没有动态 slot 名 |
| 预渲染错误页 Host 头 SSRF | 纯静态，没有服务端 |
| AVIF 图片优化 RCE | 没有任何本地图片需要优化 |
| base 路径段校验绕过 | 没有 middleware / 鉴权 |
| esbuild dev server 任意文件读 | 只影响本地开发服务器 |
| sharp / libvips CVE | 构建期不处理任何图片 |

也就是说，**告警对本项目的实际风险接近于零**。不过修复成本只有一行，而且已经实测兼容，
所以**现已升级到 `astro@^7.3.2`**，让 `npm audit` 保持干净。

> 这是与 PRD 的一处**有意偏离**：不是换框架，是同一框架内的大版本升级。
> 代码在两个大版本上都通过了 `tools/verify.mjs`，源码一行都没改。

### ⚠️ 升级带来的硬性要求

| 项目 | Astro 5 | Astro 7 |
| --- | --- | --- |
| Node | >= 18 | **>= 22.12.0** |
| npm | — | >= 9.6.5 |
| pnpm | — | >= 7.1.0 |

**Cloudflare Pages 记得把 `NODE_VERSION` 设成 `22`**，否则构建会直接失败。

### 想回到 Astro 5

```bash
pnpm add astro@^5.18.2
pnpm run verify
```

---

## 日常怎么用

| 我想…… | 运行什么 | 打开 |
| --- | --- | --- |
| **新建一篇文章** | `npm run new` | — |
| **看看有哪些文章** | `npm run posts` | 资源管理器 |
| **本地看完整效果**（含搜索） | `npm run serve` | <http://localhost:4321> |
| **改样式 / 组件**（热更新） | `npm run dev` | <http://localhost:4321> |
| **提交前自检** | `npm run check:all` | — |
| **发布上线** | `npm run publish` | Cloudflare 自动构建 |
| **写文章**（网页后台，可选） | 什么都不用跑 | `https://你的域名/admin` |

### 写文章

三条路都行，详见下方「[写文章](#写文章)」：`npm run new`（最快）/ `/admin` 网页后台 /
直接改 `src/content/posts/` 里的 `.md`。

### 本地看效果：`pnpm run serve`

这一条等于 **构建 → 产物验收 → 起预览服务**，然后打开 <http://localhost:4321>。

```bash
pnpm run serve
```

### 本地开发：`pnpm run dev`

改样式或组件时用它，有热更新。**但 `dev` 模式下搜索不可用** ——
Astro 开发服务器只服务源码，不提供 `dist/pagefind/` 索引，搜索框会提示你。

要试搜索就必须用 `pnpm run serve`（或者 `pnpm run build` 之后 `pnpm run preview`）。

> 两个命令的端口默认都是 **4321**，**不要同时开**。切换前先把旧的那个 Ctrl+C 掉。

### 发布

一条命令搞定：**构建自检 → 提交 → 推送**，Cloudflare 收到 push 后自己构建，约 60 秒上线。

```cmd
npm run publish
npm run publish -- "post: 换了封面"
npm run publish -- --dry-run
```

它会先跑 `verify` 和 `build`：**构建不过就什么都不提交**，
不会把错误推上去让 Cloudflare 那边报错。有草稿（`draft: true`）时会列出来提醒你。

> **为什么要 push 才会更新线上？**
> 线上是 Cloudflare Pages 在构建你的 GitHub 仓库，不是你的电脑。
> 它只认「仓库有新的 push」这一个信号 —— 所以 `git commit` 只是存在本地，
> **必须有 `git push`**（`npm run publish` 已经包含了）。
> 想完全不碰 git，就配好 `/admin`（见「写文章 · 方式一」），
> 网页上点发布，CMS 会替你 commit + push。

---

## 快速开始

> 需要 **Node >= 22.12.0**（Astro 7 的硬性要求）。Node 20 会在安装阶段就报 engines 错误。

下面的代码块**都可以整段复制**，里面没有注释。

```bash
pnpm install
pnpm run build
pnpm run audit
```

| 命令 | 作用 |
| --- | --- |
| `pnpm run dev` | 开发服务器 <http://localhost:4321> |
| `pnpm run build` | 构建 + 生成 Pagefind 索引 |
| `pnpm run build:only` | 只跑 `astro build`，不生成搜索索引 |
| `pnpm run audit` | 产物验收：对 `dist/` 量性能红线 |
| `pnpm run preview` | 预览构建产物 |
| `pnpm run verify` | 源码自检：组件编译 / frontmatter / import / JS 预算 |
| `pnpm run check` | `astro check` 类型检查 |
| `pnpm run og` | 重新生成 `public/og-default.png` |

> ⚠️ **Windows 的 cmd.exe 里不要把注释写在命令同一行。**
> `#` 在 bash 是注释，在 cmd 里**不是** —— 整行复制时 `#` 后面的字会被当成参数传给命令。
> 例如 `npm run build # 构建` 会让 pagefind 收到一个多余的参数然后报
> `unexpected argument '#' found`。
> PowerShell 也一样，注释符是 `#` 但同样不能跟在命令后面当参数用。
> 想加说明就单独起一行，或者干脆别加。

> `build` 与 `build:only` 的区别：`build` = `astro build && pagefind --site dist`，
> 两个命令用 `&&` 串联。**如果 `astro build` 以非 0 退出码结束，pagefind 就不会执行，
> 搜索索引会静默缺失**。构建完请跑一次 `pnpm run audit` 确认 pagefind 目录存在。

> ⚠️ **搜索只在构建后可用**。`pnpm run dev` 下 Pagefind 索引还不存在，搜索框会提示先构建。
> 想在本地试搜索就先 `pnpm run build`，再 `pnpm run preview`。

---

## 文件结构

```text
yuuu-blog-v2/
├── public/
│   ├── favicon.svg
│   ├── og-default.png          # 由 tools/make-og.mjs 生成
│   ├── robots.txt
│   ├── _headers                # Cloudflare Pages 响应头
│   └── admin/                  # Sveltia CMS
│       ├── index.html
│       └── config.yml
├── src/
│   ├── content.config.ts       # Content Collections schema
│   ├── content/posts/          # 文章（Markdown）
│   ├── components/             # 8 个组件
│   ├── layouts/                # BaseLayout / PostLayout
│   ├── pages/                  # 文件路由
│   ├── styles/                 # global.css / theme.css
│   └── lib/                    # posts.ts / format.ts / site.ts
├── workers/oauth/              # GitHub OAuth 代理（单独部署）
├── tools/                      # make-og.mjs / verify.mjs / audit-dist.mjs
├── astro.config.mjs
├── CHANGELOG.md
└── package.json
```

### 与 PRD 的两处结构差异

1. **`src/content.config.ts`** 而不是 `src/content/config.ts` —— 前者是 Astro 5 的规范位置，后者是兼容保留的旧路径。
2. **没有 `tailwind.config.mjs`** —— Tailwind 4 改成了 CSS-first 配置，主题令牌写在 `src/styles/global.css` 的 `@theme inline` 里。

另外多出几个 PRD 没列但必要的文件：`src/lib/site.ts`、`src/pages/tags/index.astro`（标签云页）、`src/pages/api/posts/[page].json.ts`（加载更多的静态 JSON）、`tools/`。

---

## 写文章

文章就是 `src/content/posts/` 下的一个 Markdown 文件，**文件名即网址**：
`2026-09-17-my-post.md` → `/posts/2026-09-17-my-post/`。

### 方式一：本地新建（推荐，立刻可用）

```cmd
npm run new
```

会依次问你标题 / 日期 / 分类 / 标签 / 封面样式 / 摘要，**直接回车就用方括号里的默认值**。
生成的文件长这样：

```markdown
---
title: 我的新文章
date: 2026-09-17
category: 随笔
tags: [随手记]
draft: true
---

正文写在这里。
```

也支持一条命令建好（不用回答问题）：

```cmd
npm run new -- "我的新文章" 技术 "前端, 笔记" --cover=wave --summary="一句话摘要"
```

> Windows 下 `npm run new -- "中文标题"` 没问题 —— Node 拿到的是宽的 argv，不走代码页。
> 但**别用 `git commit -m "中文"`**：cmd.exe 会按本地代码页编码，提交说明会变成乱码
> （`npm run publish` 已经帮你绕开了这个坑）。

### 方式二：网页后台（配好之后最省事）

1. 打开 `https://你的域名/admin`；
2. 用 GitHub 登录（需要先部署 OAuth Worker，见 [DEPLOY.md](DEPLOY.md) 第 3 节）；
3. 新建文章、填字段、写正文、发布；
4. CMS 自己 commit + push，Cloudflare 检测到后重建，**约 60 秒内上线**。

**这条路完全不用碰 git**，代价是要先花一次时间配 OAuth Worker + 关闭「公开注册」。

#### 后台里怎么写、怎么预览

- 左边是**正文编辑器**（Markdown），右边是**预览**。
- 顶上工具栏的**眼睛图标**（「打开/关闭预览」）可以随时把预览收起来 ——
  **手机上默认不收**，因为窄屏放不下两栏，写作区要占满整行。
- 预览面板**按文章页的排版渲染**：衬线标题、日期 / 分类 / 字数 / 阅读时长、
  标签、封面（选封面池的 id 会显示真实封面图；没选就按「封面色相」画渐变）、
  正文的小标题 / 引用 / 代码块 / 列表 / 表格。**草稿也能预览。**
- ⚠️ 它**不是线上页面的镜像**。预览是在浏览器里按同样的结构重画的，
  样式和线上保持一致，但**刚保存的文章要等 Cloudflare 构建（约 1 分钟）才会真的上线**。
  想看真实的线上页面，点编辑器右上角的**「查看发布」**跳到那篇文章。
- 编辑器里改的东西要**点保存**才会提交到 GitHub（也就才会触发重新构建）。
  保存时「最后修改」会自动写成当天，不用手填。

> 手机上如果觉得界面怪，先确认浏览器没有把页面缩放到「适应宽度」；
> 后台针对窄屏做过适配（拆掉 Decap 硬编码的 800px 最小宽度、只留写作栏、
> 输入框聚焦时会自动滚到键盘之上）。

### 手机怎么改（推荐：/admin/m/）

浏览器打开 **`https://yuuu.love/admin/m/`**，输入和「私人角落」同一个口令，就能：

- 看到**全部**文章（含草稿），可以搜索、按「已发布 / 草稿 / 隐藏」筛选
- 点一篇直接改标题和正文（更多设置里能改摘要、标签、创建时间、草稿/隐藏开关）
- 右下角「＋」写新文章；有改动时右下角会浮出**保存**按钮
- 「⋯」里可以查看文章页、删除这一篇

保存后由 Worker 直接提交到 GitHub，**约 1 分钟** Cloudflare 重建完就上线。
「最后修改」由服务器自动写成当天，不用管。

> 这一页是**专门为手机做的**，和 `/admin/`（Decap 后台）是两套东西：
> 手机上用 `/admin/m/`，电脑上想用完整字段编辑就用 `/admin/`。
>
> 第一次部署需要给 Worker 加一个写仓库的 token，见下一节。

### 方式三：直接改文件

在 `src/content/posts/` 里新建或编辑 `.md`，然后 `npm run publish`。

### 改一篇文章

改正文就改正文；改了标题/日期想改网址，**改文件名**（文件名就是 slug）。
改完 `npm run publish`。

「最后修改时间」不会自动更新 —— 想显示就在 frontmatter 加一行
`updated: 2026-09-20`（不写就不显示）。

### 写完怎么看效果

```cmd
npm run serve
```

打开 <http://localhost:4321> 就能看到，**搜索也能用**。

**草稿（`draft: true`）不会出现在页面上** —— 那是故意的。想看到它就临时改成
`draft: false`，看完再改回去（`draft` 只在构建时生效）。

> `npm run verify` 只卡**要发布的文章**的正文长度（至少 20 字）；
> 草稿不受限制，所以刚 `npm run new` 建出来、正文还只有一行占位的草稿
> 也能正常提交、正常发布 —— 它只是不会出现在线上而已。

### 不想被人看见的文章（日记等）

**纯静态站没有登录**，所以「只有我能看」做不到。能做的极限是：

> **从首页 / 归档 / 标签 / 分类 / 搜索 / RSS / sitemap 里彻底消失，但知道链接的人仍能直接打开。**

判定两条，满足其一即可：

| 怎么写 | 什么时候用 |
| --- | --- |
| `category: 日记` | 日常推荐 —— 在后台把分类选成「日记」就自动隐藏，不用记着加开关 |
| `private: true` | 给非日记的文章手动隐藏（后台里是「隐藏」那个开关） |

生效范围：

| 出口 | 结果 |
| --- | --- |
| 首页 / 归档 / 分类筛选 / 标签云 / 标签页 | 不出现 |
| Pagefind 全文搜索 | **搜不到**（文章页不加 `data-pagefind-body`） |
| RSS / sitemap.xml | 不收录 |
| 上一篇 / 下一篇 | 只在公开文章之间串 |
| 搜索引擎 | 页面带 `noindex`，不会被收录 |
| 分享卡片 | 摘要换成中性的「yuuu 的一篇私人记录」 |
| 直接开 `/posts/<文件名>/` | **能看** |

> ⚠️ 隐私强度说白：网址里带着标题和日期（如 `/posts/2024-07-21-rainy-day/`），**猜得到**。
> 适合「不想被搜到、不想被刷到」，**不适合写真正的秘密**。
> 判定规则只有一处实现：`src/lib/hidden.ts`。
> `npm run audit` 每次构建都会逐项验收这些出口，改动碰到它就会报错。

### 怎么算「发布」

两件事，缺一不可：

1. 把 `draft: true` 删掉（或改成 `false`）—— 否则构建时会被跳过；
2. `npm run publish` —— 提交并推送到 GitHub，Cloudflare 才会重建线上。

### frontmatter 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✅ | 标题 |
| `date` | ✅ | 创建时间 `2024-09-01` |
| `updated` | — | 最后修改时间 |
| `category` | — | `日记` / `技术` / `随笔`，默认随笔 |
| `tags` | — | 标签数组 |
| `summary` | — | 摘要，留空自动截取正文 |
| `cover` | — | 封面图路径，留空用 CSS 渐变封面 |
| `coverStyle` | — | 9 种封面之一，留空按分类自动挑 |
| `coverHue` | — | 封面色相 0-359 |
| `pinned` | — | 置顶 |
| `draft` | — | 草稿，构建时不输出 |

字段写错**构建就会报错**，不会静默产出 `undefined`。

### 封面池

所有封面集中在 **`src/lib/covers.ts`**，改一处就能全站换风格。

**加一张新图：**

1. 把图片丢进 `public/covers/`（或 `public/mascot/`）
2. 在 `COVER_POOL` 里加一行：

   ```ts
   { id: 'spring', src: '/covers/spring.jpg', label: '春日' },
   ```

3. 文章里写 `cover: spring` 即可

**三种写法：**

| frontmatter | 含义 |
| --- | --- |
| `cover: stand` | 用池子里的 |
| `cover: /covers/my.jpg` | 直接用这个路径（自定义图片） |
| `cover: https://…` | 外链 |
| 不写 | 按 slug 从池子里**稳定**挑一张，同一篇每次构建都一样 |

> 图片建议用竖版或方版，展示时会**居中留白**（不是裁切），
> 所以长宽比差异大也不会被切掉半个身子。

### 封面样式

`wave` 潮汐 · `nebula` 星云 · `crown` 王冠 · `opera` 歌剧院 · `aurora` 极光 ·
`starry` 星海 · `bubble` 气泡 · `grid` 方格 · `image` 自定义图片

全部是纯 CSS 渐变，**零图片请求**。

---

## 部署到 Cloudflare Pages

> 📖 **完整的分步指南（含 Lighthouse 与上线前配置清单）见 [DEPLOY.md](DEPLOY.md)。**
> 下面是最短路径。

### 1. 连接仓库

Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，选这个仓库。

| 配置项 | 值 |
| --- | --- |
| Framework preset | Astro |
| Build command | `pnpm run build`（用 npm 则 `npm run build`） |
| Build output directory | `dist` |
| Node version | 环境变量 `NODE_VERSION=22`（**Astro 7 硬性要求 >= 22.12.0**） |

环境变量：**第一版不需要任何变量**。

### 2. 绑定域名

Pages → Custom domains → 添加你的域名，Cloudflare 自动签发 HTTPS。

### 3. 开统计（可选）

Cloudflare Dashboard → Web Analytics → 添加站点，把 token 填进 `src/lib/site.ts` 的
`CF_BEACON_TOKEN`。留空时**一个第三方脚本都不会加载**。

---

## OAuth Worker 部署

Sveltia CMS 需要它换取 GitHub token。详见 [`workers/oauth/README.md`](workers/oauth/README.md)。

简要三步：

```bash
# 1. 建 GitHub OAuth App
#    Homepage URL               -> https://你的域名
#    Authorization callback URL -> https://oauth.你的域名/callback

# 2. 部署 Worker
cd workers/oauth
npm i -g wrangler
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy

# 3. 把 Custom Domain 指到 oauth.你的域名，并同步改 public/admin/config.yml 的 base_url
```

---

## 手机写作页要配的一次性设置

`/admin/m/` 保存文章时是 **Worker 替你提交**（浏览器里没有、也不该有 token）。
所以需要给 Worker 一个对仓库有写权限的 token：

```cmd
cd workers\oauth
wrangler secret put GITHUB_TOKEN
```

粘贴一个 **classic PAT**（GitHub → Settings → Developer settings → Personal access tokens →
Tokens (classic) → 勾 `repo`）。然后重新部署 Worker：

```cmd
wrangler deploy
```

没配的话，打开 `/admin/m/` 保存会直接告诉你缺 `GITHUB_TOKEN`（不会静默失败）。

## 性能约定（硬红线）

下面是从**真实构建产物**（`dist/`）量出来的，不是源码估算：

| 指标 | 上限 | 实测 |
| --- | --- | --- |
| 首屏 JS | < 10KB | **7.14 KB**（行内 4.08 KB + 外部包 gzip 1.97 + 1.09 KB） |
| 第三方脚本 | 0 个 | 公开页面 **0 个**（`/admin` 的 Sveltia CMS 只在后台加载） |
| 首页首屏卡片 | 10 篇 | **正好 10 张**，其余走 `api/posts/2.json` |
| Pagefind 索引 | 不阻塞首屏 | 57 个文件 / 642 KB，聚焦输入框后才加载 |
| RSS | 最近 20 篇 | 12 篇 |
| Sitemap | 收录全部页面 | 42 个 URL（正确排除 404 与 `/admin`） |
| `[hidden]` 兜底 | 必须在产物里 | 在 |
| 固定层 `pointer-events` | 必须在产物里 | 在 |

首屏那 7.61 KB 行内 JS 的构成（`pnpm run audit` 会打印）：

| 体积 | 内容 |
| --- | --- |
| 1.85 KB | 首页「加载更多」（内联） |
| 1.69 KB | 主题切换 + 滚动淡入（内联） |
| 0.53 KB | 主题防闪白 + 移动端菜单（内联） |
| 1.97 KB | 站内搜索，gzip 后（独立文件，全站共用并缓存） |
| 1.09 KB | 首页卡片模块，gzip 后 |

> 想再省就把 `astro.config.mjs` 里的 `prefetch` 关掉，
> 代价是跳转不再瞬时预加载。

`npm run verify` 会逐条检查：

- 用官方 `@astrojs/compiler` 编译全部 `.astro`
- 用 zod 校验全部文章 frontmatter
- 解析所有相对 import
- 扫描 PRD 第 9 节的禁止事项（`[hidden]` 兜底、固定层 `pointer-events`、手写 Markdown 解析器、`filter: blur()` 动画……）

---

## 自检与验收

两个脚本，分工不同：

| 命令 | 检查对象 | 查什么 |
| --- | --- | --- |
| `pnpm run verify` | **源码**（`src/`） | 用官方 `@astrojs/compiler` 编译全部 `.astro`；用 zod 校验 frontmatter；解析相对 import；统计首屏 JS；扫描 PRD 第 9 节禁止项 |
| `pnpm run audit` | **产物**（`dist/`） | 量真实的首屏 JS 字节；首页卡片数是否为 10；加载更多的 JSON 是否存在；Pagefind 索引是否完整；RSS / Sitemap；`[hidden]` 与 `pointer-events` 保护有没有进产物 CSS |

**改完样式或组件跑 `verify`，构建完跑 `audit`。**

`verify` 存在的理由：某些受限环境（比如 CI 容器、加固过的沙箱）不允许创建管道式子进程，
Astro/Vite 的构建链会直接 `spawn EPERM` 失败。这时候 `verify` 仍然能在进程内把能查的都查掉。

`audit` 存在的理由：源码里看着 2 KB 的脚本，构建后可能被内联成 7 KB。
预算必须量产物，不能量源码。

---

## 已知限制

- **搜索需要构建产物**：`npm run dev` 下 Pagefind 索引不存在。
- **CMS 依赖 CDN**：`public/admin/index.html` 从 unpkg 加载 Sveltia CMS，想自托管见该文件注释。
- **没跑过 Lighthouse**：需要你在本地 `npm run preview` 后自行测量。
- **OAuth Worker 未部署验证**：代码按 Cloudflare Workers 规范写好，但需要你自己的 GitHub OAuth App 凭据才能跑通。

---

> 个人学习与非商业用途。「原神」「芙宁娜 / Furina」相关权利归 miHoYo / HoYoverse 所有。
