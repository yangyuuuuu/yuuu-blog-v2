# 部署与验收

从零到上线，按顺序做即可。**第 0 步不做的话，canonical / sitemap / RSS 会指向错误的域名。**

---

## 0. 上线前的配置清单

| 文件 | 改什么 | 不改的后果 |
| --- | --- | --- |
| `astro.config.mjs` | `SITE` 改成你的正式域名 | sitemap / RSS / canonical 全是 `yuuu.pages.dev` |
| `public/robots.txt` | 里面的 `Sitemap:` 地址 | 搜索引擎拿到错的站点地图 |
| `public/admin/config.yml` | `repo`、`base_url`、`site_url`、`display_url` | CMS 登录失败 |
| `workers/oauth/wrangler.toml` | `ALLOWED_ORIGIN` | OAuth 被 CORS 拦 |

改完域名后重新构建一次：`pnpm run build`。

---

## 1. 先选一个包管理器

仓库里**同时存在** `package-lock.json` 和 `pnpm-lock.yaml`。
Cloudflare Pages 靠 lockfile 判断用哪个包管理器，**两个都在可能判断错**，所以只留一个。

### 用 pnpm（推荐）

```powershell
Remove-Item -Force package-lock.json
```

`pnpm-workspace.yaml` 已经配好了 `allowBuilds`，Cloudflare 上 `pnpm install` 不会因为
esbuild / sharp 的构建脚本被拦而失败。

### 用 npm

```powershell
Remove-Item -Force pnpm-lock.yaml, pnpm-workspace.yaml
```

---

## 2. 推到 GitHub

```bash
cd yuuu-blog-v2
git init
git add .
git commit -m "chore: init"
git branch -M main
git remote add origin https://github.com/你的用户名/yuuu-blog-v2.git
git push -u origin main
```

---

## 3. 连接 Cloudflare Pages

1. 打开 <https://dash.cloudflare.com/> → 左侧 **Workers & Pages** → **Create** → **Pages**
2. 选 **Connect to Git**，授权 GitHub，选中刚推的仓库
3. 构建配置：

| 字段 | 填什么 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `Astro` |
| Build command | `pnpm run build`（用 npm 就填 `npm run build`） |
| Build output directory | `dist` |
| Root directory | 留空（仓库根就是项目根） |

4. **环境变量**：`NODE_VERSION` = `22`

   > Astro 7 要求 Node >= 22.12.0。项目里已经放了 `.nvmrc`（内容 `22`），
   > Cloudflare Pages 会自动读它。**两处都配上最稳**，因为默认 Node 版本可能偏低。

5. 点 **Save and Deploy**。

构建大约 1 分钟。完成后会给你一个 `https://yuuu-blog-v2.pages.dev` 之类的地址。

---

## 4. 绑定自定义域名

Pages 项目 → **Custom domains** → **Set up a custom domain** → 输入你的域名。

- 域名已经在 Cloudflare 托管：会自动加好 DNS 记录，**HTTPS 证书自动签发**
- 域名在别处：按提示把 CNAME 指到 `<项目>.pages.dev`

绑定后回第 0 步，把域名填进配置再推一次。

---

## 5. 配 OAuth Worker（要让 `/admin` 能登录才需要）

详见 [`workers/oauth/README.md`](workers/oauth/README.md)。三步：

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

## 6. 跑 Lighthouse

### 方式一：Chrome DevTools（推荐，不用装东西）

1. 起预览服务

   ```cmd
   pnpm run serve
   ```

2. Chrome 打开 <http://localhost:4321>
3. 按 <kbd>F12</kbd> → 顶部标签选 **Lighthouse**
4. 勾选 **Performance**（想看全就全勾），Device 选 **Desktop**，Mode 选 **Navigation**
5. 点 **Analyze page load**

### 方式二：命令行

```cmd
npx lighthouse http://localhost:4321 --view --preset=desktop
```

（会临时下载 Lighthouse，不写进项目依赖。手机端跑就把 `--preset=desktop` 去掉。）

### ⚠️ 本地分数会比线上低，这是正常的

`astro preview` 是本地静态服务器，它：

- **不做 gzip / brotli 压缩** —— 43 KB 的 CSS 原样传输，线上会被压到 8 KB 左右
- **没有 CDN 缓存和 HTTP/2 推送**
- 没有 Cloudflare 的边缘节点

所以本地跑出 85 分、线上 97 分是常见情况。
**PRD 要求的 ≥ 95 应该以线上地址为准**，本地跑主要用来发现可优化项。

### 要看什么

| 指标 | 期望 | 说明 |
| --- | --- | --- |
| Performance | ≥ 95（线上） | 首屏 JS 只有 7.14 KB，主要是样式和动画 |
| Accessibility | ≥ 95 | 有 `aria-label`、`sr-only` 跳转链接、语义标签 |
| Best Practices | ≥ 95 | 无第三方脚本、有 `nosniff` 等安全头（见 `public/_headers`） |
| SEO | 100 | 有 canonical、sitemap、robots、RSS、OG 标签 |

如果 Performance 没到 95，最可能的两处：

1. **`backdrop-filter`** —— 首页有 10 张毛玻璃卡片。想再快就在
   `src/styles/global.css` 里把 `.card` 的 `backdrop-blur` 去掉，视觉损失不大。
2. **`.aurora` 的大面积 `filter: blur(90px)`** —— 首屏要光栅化三个巨大的模糊圆。
   想省掉就把 `src/components/Background.astro` 里的 `aurora` 那段删了。

改完重新 `pnpm run build` + `pnpm run serve` 再测。

---

## 7. 上线后验收

逐条对一遍 PRD 的清单：

- [ ] 打开线上首页，首屏正好 10 张卡片
- [ ] 点「加载更多」，追加出第 11、12 篇
- [ ] 搜「芙宁娜」，出 3 篇真实文章并带日期
- [ ] 点右上角 ☾ 切主题，无掉帧
- [ ] 点进文章，有水波淡入转场（Chrome / Edge 126+）
- [ ] `/rss.xml` 能打开
- [ ] `/sitemap-index.xml` 能打开
- [ ] `/admin` 能 GitHub 登录并发布
- [ ] 发布后 60 秒内线上更新
- [ ] 手机 / 平板 / 桌面三端布局正常
- [ ] Lighthouse Performance ≥ 95（以线上地址为准）

---

## 8. 日常维护

发布文章不需要本地环境：

1. 打开 `https://你的域名/admin`
2. GitHub 登录
3. 新建 / 编辑文章，点发布
4. Cloudflare 检测到 push，约 60 秒重新构建上线

改了样式或组件之后，本地跑一次 `pnpm run verify` 和 `pnpm run audit` 再推。
