# OAuth Worker

给 Sveltia CMS 换取 GitHub token 用的小代理。纯静态站拿不到 `client_secret`，所以必须有这么一个服务端。

## 1. 建 GitHub OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App

| 字段 | 值 |
| --- | --- |
| Application name | yuuu-blog CMS |
| Homepage URL | `https://你的博客域名` |
| Authorization callback URL | `https://oauth.你的域名/callback` |

记下 **Client ID** 和 **Client Secret**。

## 2. 部署

```bash
cd workers/oauth
npm i -g wrangler
wrangler login

wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# 先在 wrangler.toml 里把 ALLOWED_ORIGIN 改成你的博客域名
wrangler deploy
```

## 3. 绑定子域名

Cloudflare Dashboard → Workers & Pages → yuuu-oauth → Settings → Domains & Routes →
Add → Custom Domain → `oauth.你的域名`。

（或者在 `wrangler.toml` 里取消注释 `routes` 段后重新 deploy。）

## 4. 回填配置

改 `public/admin/config.yml`：

```yaml
backend:
  name: github
  repo: 你的用户名/仓库名
  branch: main
  base_url: https://oauth.你的域名
```

提交后重新部署博客。

## 接口

| 路径 | 作用 |
| --- | --- |
| `GET /` | 健康检查，返回 `{ ok: true }` |
| `GET /auth` | 302 跳转到 GitHub 授权页 |
| `GET /callback` | 用 code 换 token，回传握手消息给 CMS 窗口 |

## 安全说明

- `client_secret` 只存在于 Worker 的加密环境变量里，不会进仓库、不会发到浏览器。
- `ALLOWED_ORIGIN` 限制 CORS 来源，避免被别的站点拿去用。
- 作用域默认 `repo,user`，只够读写你自己有权限的仓库。
