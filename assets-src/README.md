# assets-src —— 素材的「原件」，**不参与构建、不会被上线**

这个目录里放的是**做素材用的源图**（比如 `make-icons.mjs` 抠图用的立绘）。
它和 `public/` 的区别很关键：

| | 会进 dist/ 吗 | 说明 |
| --- | --- | --- |
| `public/` | **会** | 里面的东西全都公开可下载（见 HANDOFF 铁律二） |
| `assets-src/` | 不会 | 只存在于仓库里，网站上看不到 |

所以：**体积大、只为了留档的原图放这里**；真要显示给读者的图放 `public/uploads/`。

---

## 若娜瓦-低眉（2026-09-29 从那场「大图被抹成 0 字节」的事故里恢复）

事情经过见 CHANGELOG 2.18.1 与 HANDOFF 9.36：站主把一张 14.8MB 的图改名，
仓库里那张图被写成了 **0 字节**（GitHub Contents API 对 >1MB 的文件不返回内容）。
图已经从 git 历史里救回来，并且在这里双份留档：

| 文件 | 大小 | 是什么 |
| --- | --- | --- |
| `ruonawa-lowbrow-original.png` | 14.8 MB | **站主上传的那一份，逐字节原样**（sha256 `4c20bc9a…`）。注：当年它叫 `.jpg`，其实内容是真 PNG |
| `ruonawa-lowbrow-full.jpg` | 3.9 MB | 同一张图转成 JPEG（q92、10228×5748，尺寸一点没缩）—— 想看图/想发人用这份 |

网站上真正加载的是 `public/uploads/若娜瓦-低眉.jpg`（1600×899、约 140 KB，
按图库上传时的压缩规则做的）和它的缩略图 `public/uploads/thumbs/若娜瓦-低眉.jpg`。

### 要重新生成网站用的那张（web 版）

原图在任何时候都能重做，不用求人：

```cmd
node -e "const s=require('sharp');s('assets-src/ruonawa-lowbrow-full.jpg').resize({width:1600,height:1600,fit:'inside'}).jpeg({quality:85}).toFile('public/uploads/若娜瓦-低眉.jpg')"
npm run thumbs -- --force
```

（`npm run thumbs` 会照 `tools/make-thumbs.mjs` 的参数补出 720px 缩略图；
这条命令用到的 `sharp` 已经是 devDependency，不用新装东西。）
