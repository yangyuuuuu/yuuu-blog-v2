# 部署与验收

从零到上线。**先看第 1 节，再挑一条路走。**

---

## 0. 先弄清楚：要部署的是什么

**不是一个文件，是一个文件夹：`dist/`。**

`dist/` 由 `pnpm run build` 生成，是 81 个纯静态文件（约 1.7 MB），完全自包含：

```text
dist/
├── index.html           首页
├── 404.html
├── archive/ about/ changelog/ tags/ posts/    各个页面
├── admin/               CMS 后台（index.html + config.yml）
├── api/posts/2.json     「加载更多」的数据
├── pagefind/            搜索索引（25 个文件）
├── _astro/              打包后的 CSS / JS
├── _headers             Cloudflare 响应头
└── robots.txt  rss.xml  sitemap-index.xml  favicon.svg  og-default.png
```

里面**没有** `src/`、`node_modules/`、`posts/` 源码、`package.json` —— 这些都不上传。

---

## 1. 上线前的配置清单（必做）

漏了这步，canonical / sitemap / RSS 会全部指向 `yuuu.pages.dev`。

| 文件 | 改什么 | 不改的后果 |
| --- | --- | --- |
| `astro.config.mjs` | `SITE` 改成你的正式域名 | sitemap / RSS / canonical 全指错 |
| `public/robots.txt` | 里面的 `Sitemap:` 地址 | 搜索引擎拿到错的站点地图 |
| `public/admin/config.yml` | `repo`、`base_url`、`site_url`、`display_url` | CMS 登录失败 |
| `workers/oauth/wrangler.toml` | `ALLOWED_ORIGIN` | OAuth 被 CORS 拦 |

**一条命令改完上面全部**（含 OAuth Worker 的 `ALLOWED_ORIGIN`，共 6 处）：

```bash
pnpm run domain https://你的域名
pnpm run build
pnpm run audit
```

`audit` 会核对产物里的 canonical 和 robots 是否与配置一致，不一致会直接报错。

改完重新构建一次：`pnpm run build`。

> 还不知道最终域名？可以先不管，等第 4 节绑好域名再回来改，然后重新推一次。

---

## 2. 两条路，选一条

| | 方式 A：Git 连接（推荐） | 方式 B：直接上传 |
| --- | --- | --- |
| 你要做什么 | `git push` | 本地 `npm run deploy` |
| 谁来构建 | **Cloudflare 自己跑 `pnpm run build`** | 你本地先构建 |
| 上传的东西 | 整个仓库源码 | 只有 `dist/` |
| `/admin` 写文章 | ✅ 自动重建上线 | ❌ 用不了，每次要手动重传 |
| 适合 | 长期用 | 先快速看一眼线上效果 |

**PRD 要求的「发布后 60 秒自动更新」只有方式 A 能做到** —— 它需要 Cloudflare 监听 GitHub push。

---

## 方式 A：Git 连接（推荐）

### A1. 先选一个包管理器

仓库里**同时存在** `package-lock.json` 和 `pnpm-lock.yaml`。
Cloudflare Pages 靠 lockfile 判断用哪个包管理器，**两个都在可能判断错**，所以只留一个。

用 pnpm（推荐，`pnpm-workspace.yaml` 已配好 `allowBuilds`）：

```powershell
Remove-Item -Force package-lock.json
```

想用 npm 就反过来：

```powershell
Remove-Item -Force pnpm-lock.yaml, pnpm-workspace.yaml
```

### A2. 推到 GitHub

```bash
cd yuuu-blog-v2
git init
git add .
git commit -m "chore: init"
git branch -M main
git remote add origin https://github.com/你的用户名/yuuu-blog-v2.git
git push -u origin main
```

### A3. 在 Cloudflare 连接仓库

1. <https://dash.cloudflare.com/> → **Workers & Pages** → **Create** → **Pages**
2. 选 **Connect to Git**，授权 GitHub，选中刚推的仓库
3. 构建配置（照抄这一列）：

| Dashboard 字段 | 填什么 | 说明 |
| --- | --- | --- |
| Project name | `yuuu-blog-v2` | 决定 `*.pages.dev` 子域名 |
| Production branch | `main` | |
| Framework preset | `Astro` | 只是帮你自动填字段，选错也能手改下面两行 |
| **Build command** | `pnpm run build` | ⚠️ 别填成 `build:only`，那样不会生成搜索索引 |
| **Build output directory** | `dist` | |
| Root directory | 留空 | |

4. **环境变量**（在页面下半部分的 Environment variables 区域）：`NODE_VERSION` = `22`

   > ⚠️ **最容易漏、后果最严重的一步。** Astro 7 要求 Node >= 22.12.0，
   > Cloudflare 默认版本偏低，不改就是构建直接失败。
   > 项目里已经放了 `.nvmrc`（内容 `22`），Cloudflare 会自动读它 —— 两处都配上最稳。

5. 点 **Save and Deploy**

构建约 1 分钟。以后每次 `git push` 都会自动重新构建。

### A4. 绑定自定义域名

Pages 项目 → **Custom domains** → **Set up a custom domain** → 输入域名。

- 域名已在 Cloudflare 托管：DNS 记录和 HTTPS 证书全自动
- 域名在别处：按提示把 CNAME 指到 `<项目>.pages.dev`

绑完回**第 1 节**把域名填进配置。一条命令改完 6 处：

```bash
pnpm run domain https://你的域名
pnpm run build
pnpm run audit
```

### A5. 关于统计脚本

**Cloudflare Pages 会默认给站点注入 Web Analytics**
（`static.cloudflareinsights.com/beacon.min.js`）。这是 PRD 里唯一允许的第三方脚本例外。

只要**不在** `src/lib/site.ts` 里填 `CF_BEACON_TOKEN`，就不会重复加载 —— 保持留空即可。

想做到字面上的「0 个第三方脚本」：Dashboard → **Web Analytics** → 关掉这个站点。

---

## 如果你误进了 Workers 流程

Cloudflare 控制台有两个入口，长得很像：

- **Workers & Pages → Create → Pages → Connect to Git** ← **选这个**
- **Workers & Pages → Create → Import a repository**（"Create an app" 页面）← 选错了

后者是 Workers 流程，它的 Deploy command 默认是 `npx wrangler deploy`，
对我们这个纯静态站会报 `Missing entry-point to Worker script or to assets directory`。

**退回上一页，切到 Pages 标签重来即可。** 项目名可以复用。

> 仓库里**不要**放 `wrangler.toml` —— 那是 Workers 专用语法，
> Pages 的构建配置全部在 Dashboard 上填（见 A3 的表格）。

---

## 方式 B：直接上传（最快，5 分钟看到线上）

不需要 GitHub。

```cmd
cd /d D:\DS\yuuu-blog-v2
npm run deploy
```

这条命令 = `astro build` + `pagefind` + `wrangler pages deploy dist`。

第一次会：

1. 提示登录 —— 打开浏览器用 Cloudflare 账号授权
2. 问要不要创建新项目 —— 输 `y`，项目名随便起（比如 `yuuu-blog-v2`）
3. 传完给你一个 `https://yuuu-blog-v2.pages.dev` 地址

之后更新就再跑一次 `npm run deploy`。

> 想从方式 B 转成方式 A：照上面的 A1~A3 走一遍，Cloudflare 会接管构建。

### 方式 B 失败时（比如 Cloudflare API 返回 502）

`wrangler` 依赖 Cloudflare API。如果它报 `GET /accounts -> 502 Bad Gateway`
（带 Ray ID），那是 Cloudflare 自己的接口临时故障，不是你的问题。三个应对：

**1. 直接重试**（登录状态已存在本地，不会重新授权）

```cmd
npm run deploy
```

**2. 指定 Account ID，跳过那次出错的 `/accounts` 查询**

登录后去 <https://dash.cloudflare.com/> 右侧栏找 **Account ID**：

```cmd
set CLOUDFLARE_ACCOUNT_ID=你的AccountID
npm run deploy
```

**3. 改用域名后台拖拽上传（完全绕开 wrangler 和 API）**

1. <https://dash.cloudflare.com/> → **Workers & Pages** → **Create** → **Pages**
2. 选 **Upload assets**（不是 Connect to Git）
3. 项目名填 `yuuu-blog-v2`
4. 把 `dist` 文件夹整个拖进去
5. Deploy

这条路不经过任何 API 调用，最稳。缺点和方式 B 一样：
以后改文章要手动重传，`/admin` 用不了。

---

## 3. 配 OAuth Worker（要让 `/admin` 能登录才需要）

详见 [`workers/oauth/README.md`](workers/oauth/README.md)。

```bash
cd workers/oauth
npm i -g wrangler
wrangler login
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler deploy
```

GitHub OAuth App 的回调地址填 `https://oauth.你的域名/callback`。

部署完把 Worker 绑到 `oauth.你的域名`，再回填 `public/admin/config.yml` 的 `base_url`。

---

## 3.5 给 /admin 加门禁（Cloudflare Access）

**访客照常浏览，只是进不了 `/admin`。** 这层是加在 Sveltia CMS 的 GitHub 登录**之前**的。

> 顺带说明：CMS 本身已经要求 GitHub OAuth，只有拥有你仓库权限的账号能进。
> 再加 Access 的好处是**多一层且不依赖 GitHub** —— 在没登录 GitHub 的设备上也能用邮箱验证码进后台。

### 步骤

1. <https://one.dash.cloudflare.com/> → **Access** → **Applications** → **Add an application**
2. 选 **Self-hosted**
3. 填：

   | 字段 | 填什么 |
   | --- | --- |
   | Application name | `yuuu 博客后台` |
   | Session Duration | `24 hours`（自己定） |
   | Application domain | 选 `yuuu.love`，**Path 填 `admin`** |

   > Path 只填 `admin` 就够了（不要带斜杠），这样只有 `/admin` 及其子路径被保护，
   > 其余页面照常公开。

4. **Add a policy**：

   | 字段 | 填什么 |
   | --- | --- |
   | Policy name | `管理员` |
   | Action | `Allow` |
   | Include | `Emails` → 填你自己的邮箱 |

5. **Identity providers**：勾 **One-time PIN**（内置的，不用配任何东西，
   登录时给你邮箱发 6 位验证码）

6. 保存

### 效果

| 谁 | 能做什么 |
| --- | --- |
| 访客 | 正常浏览全站，`/admin` 会跳转到邮箱验证页 |
| 你（白名单邮箱） | 收到验证码 → 进入 `/admin` → 再走 GitHub 登录 → 正常编辑发布 |
| 其他邮箱 | 即使收到验证码也进不去（不在策略里） |

**日志**：<https://one.dash.cloudflare.com/> → **Logs** → **Access**，
能看到「谁、什么时候、从哪个 IP 尝试访问」。

免费额度：50 个用户以内不收费。

### 这层做不到什么

- ❌ **公开注册**：没有「用户自行注册」的入口，只能你往白名单里加邮箱
- ❌ **只读账号**：Access 是按应用授权的，进去了就是全权限，没有角色区分

如果以后确实需要「任何人都能注册、但只能是只读」，那要自建用户系统（D1 + Functions），
是另一个量级的工程，需要时再单独开一轮。

---

## 4. 跑 Lighthouse

### 方式一：Chrome DevTools（推荐，不用装东西）

```cmd
pnpm run serve
```

Chrome 打开 <http://localhost:4321> → <kbd>F12</kbd> → **Lighthouse** 标签 →
勾 **Performance** → Device 选 **Desktop** → **Analyze page load**。

### 方式二：命令行

```cmd
npx lighthouse http://localhost:4321 --view --preset=desktop
```

会临时下载 Lighthouse，不写进项目依赖。手机端跑就去掉 `--preset=desktop`。

### ⚠️ 本地分数一定比线上低，这是正常的

`astro preview` 是本地静态服务器，它：

- **不做 gzip / brotli 压缩** —— 43 KB 的 CSS 原样传输，线上会被压到 8 KB 左右
- **没有 CDN 缓存**
- 没有 Cloudflare 边缘节点

所以**本地 85 分、线上 97 分是常态**。
**PRD 要求的 ≥ 95 应该以线上地址为准**，本地跑主要用来发现可优化项。

### 期望分数

| 指标 | 期望 | 依据 |
| --- | --- | --- |
| Performance | ≥ 95（线上） | 首屏 JS 只有 7.14 KB，封面是 CSS 渐变无图 |
| Accessibility | ≥ 95 | 有 `aria-label`、`sr-only` 跳转链接、语义标签 |
| Best Practices | ≥ 95 | 无第三方脚本，`public/_headers` 里有安全头 |
| SEO | 100 | canonical、sitemap、robots、RSS、OG 齐全 |

### 没到 95 就按这个顺序砍

1. **`backdrop-filter`** —— 首页 10 张毛玻璃卡片，最可能的瓶颈。
   把 `src/styles/global.css` 里 `.card` 的 `backdrop-blur` 去掉，视觉损失不大。
2. **`.aurora` 的 `filter: blur(90px)`** —— 首屏要光栅化三个巨大的模糊圆。
   删掉 `src/components/Background.astro` 里 `aurora` 那段即可。

改完重新 `pnpm run build` + `pnpm run serve` 再测。

---

## 5. 上线后验收

逐条对一遍 PRD 的清单：

- [ ] 首页首屏正好 10 张卡片
- [ ] 点「加载更多」，追加出第 11、12 篇
- [ ] 搜「芙宁娜」，出 3 篇真实文章并带日期（不是标签页）
- [ ] 点右上角 ☾ 切主题，无掉帧
- [ ] 点进文章有水波淡入转场（Chrome / Edge 126+）
- [ ] `/rss.xml` 能打开
- [ ] `/sitemap-index.xml` 能打开
- [ ] `/admin` 能 GitHub 登录并发布
- [ ] 发布后 60 秒内线上更新
- [ ] 手机 / 平板 / 桌面三端布局正常
- [ ] Lighthouse Performance ≥ 95（以线上地址为准）

---

## 6. 日常维护

发布文章**不需要本地环境**：

1. 打开 `https://你的域名/admin`
2. GitHub 登录
3. 新建 / 编辑文章，点发布
4. Cloudflare 检测到 push，约 60 秒重新构建上线

改了样式或组件之后，本地跑一次 `pnpm run verify` 和 `pnpm run audit` 再推。

---

## 7. 构建失败排查

Cloudflare 构建日志里出现下面这些，对应关系是：

| 日志 | 原因 | 解决 |
| --- | --- | --- |
| `Unsupported engine ... Required: {"node":">=22.12.0"}` | Node 版本太低 | 加环境变量 `NODE_VERSION=22` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 拦了构建脚本 | 确认 `pnpm-workspace.yaml` 里的 `allowBuilds` 还在 |
| 包管理器判断异常 / 依赖装错 | 两个 lockfile 打架 | 只留一个（见 A1） |
| `Failed to resolve ... zod` | 幽灵依赖 | 已在 2.1.1 修复，确认 `devDependencies` 里有 `zod` |
| 页面正常但没有搜索 | `pagefind` 那步没跑到 | 构建命令必须是 `pnpm run build`，不是 `pnpm run build:only` |
| `GET /accounts -> 502 Bad Gateway`（带 Ray ID） | Cloudflare API 临时故障，与项目无关 | 重试；或设 `CLOUDFLARE_ACCOUNT_ID`；或改用后台拖拽上传（见方式 B 的兜底） |
| `wrangler` 提示 `Not authenticated` | 登录态过期 | `npx wrangler login` 重新授权 |
| 拖拽上传后 `/admin` 打不开 | 方式 B/C 没有 Git 监听，CMS 用不了 | 转方式 A（Git 连接） |
