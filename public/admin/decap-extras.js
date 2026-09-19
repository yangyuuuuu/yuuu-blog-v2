/**
 * Decap 后台的两个小增强：**看图库原图** 和 **重命名图片**。
 *
 * ⚠️ 为什么是「注入」而不是「正经扩展」：
 * Decap 的媒体库没有给插件留钩子 ——
 *   · 它的界面文案里只有 上传 / 删除 / 下载 / 复制路径 / 搜索 / 选择，**没有重命名**；
 *   · DOM 里几乎没有 data-testid（只有 card-file-icon），类名都是 styled-components 的哈希；
 *   · 想换成自定义媒体库要 CMS.registerMediaLibrary + React 组件，而这个页面没有构建步骤。
 * 所以只能在运行时观察 DOM，往媒体卡片上挂两个小按钮。
 *
 * 因此这里有两条自我约束：
 *   1. **失败必须无声**：找不到元素就什么都不做，绝不抛错打断 Decap。
 *   2. **只用「看得见的东西」定位**：靠 img 的 src 里有没有 /uploads/，
 *      不依赖任何哈希类名 —— 这样 Decap 小版本升级也不至于失效。
 *
 * 重命名走的是我们自己的 Worker（oauth.yuuu.love），需要私人角落的口令换 ticket。
 * 口令只在浏览器和 Worker 之间传递，GitHub token 始终在服务端。
 */
(function () {
  'use strict';

  var WORKER = 'https://oauth.yuuu.love';
  var SESSION_KEY = 'yuuu-mobile-editor';   /* 与 /admin/m/、/admin/g/ 共用，登一次就能用 */
  var API_PREFIX = '/uploads/';

  /* ---------------------------------------------------------------- 基础工具 */

  function ticket() {
    try { return (JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') || {}).ticket || ''; }
    catch (e) { return ''; }
  }
  function saveTicket(t) {
    try {
      var cur = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') || {};
      cur.ticket = t;
      cur.at = Date.now();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(cur));
    } catch (e) { /* 忽略 */ }
  }

  /** 把图片的站点地址换成仓库路径：/uploads/x.jpg → public/uploads/x.jpg */
  function repoPathOf(src) {
    try {
      var p = new URL(src, location.origin).pathname;
      if (p.indexOf(API_PREFIX) !== 0) return '';
      return 'public' + decodeURIComponent(p);
    } catch (e) { return ''; }
  }

  /* 样式：全部用 dcx- 前缀，避免和 Decap 的类名撞 */
  var css = document.createElement('style');
  css.textContent = [
    '.dcx-tools{position:absolute;top:4px;right:4px;z-index:5;display:flex;gap:4px;}',
    '.dcx-btn{width:26px;height:26px;padding:0;border:0;border-radius:7px;background:rgba(20,24,32,.78);',
    'color:#fff;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
    '.dcx-btn:hover{background:rgba(20,24,32,.95);}',
    '.dcx-mask{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.9);display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:12px;padding:16px;}',
    '.dcx-mask img{max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;border-radius:8px;}',
    '.dcx-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;color:#cfd6e4;font-size:13px;}',
    '.dcx-bar button{padding:8px 14px;border-radius:9px;border:1px solid #3a4252;background:#1b2029;color:#e6ebf5;',
    'font-size:13px;cursor:pointer;}',
    '.dcx-bar button.p{background:#2f6fed;border-color:#2f6fed;}',
    '.dcx-box{background:#151a22;border:1px solid #2b3342;border-radius:14px;padding:18px;width:min(92vw,420px);',
    'color:#e6ebf5;font-size:14px;}',
    '.dcx-box h3{margin:0 0 8px;font-size:15px;}',
    '.dcx-box p{margin:0 0 10px;color:#98a3b5;font-size:12.5px;word-break:break-all;}',
    '.dcx-box input{width:100%;box-sizing:border-box;padding:11px 13px;border-radius:10px;border:1px solid #2b3342;',
    'background:#0f1319;color:#e6ebf5;font-size:16px;margin-bottom:10px;}',
    '.dcx-box .row{display:flex;gap:8px;}',
    '.dcx-box .row button{flex:1;padding:10px;border-radius:10px;border:1px solid #2b3342;background:#1b2029;',
    'color:#e6ebf5;font-size:14px;cursor:pointer;}',
    '.dcx-box .row button.p{background:#2f6fed;border-color:#2f6fed;}',
    '.dcx-msg{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:10000;background:#151a22;',
    'border:1px solid #2b3342;color:#e6ebf5;padding:10px 16px;border-radius:10px;font-size:13.5px;max-width:88vw;}',
  ].join('');
  document.head.appendChild(css);

  function toast(text, ms) {
    var d = document.createElement('div');
    d.className = 'dcx-msg';
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, ms || 3200);
  }

  /* ---------------------------------------------------------------- 弹层 */

  function closeMask(m) { if (m && m.parentNode) m.remove(); }

  function mask(children, onBackdrop) {
    var m = document.createElement('div');
    m.className = 'dcx-mask';
    children.forEach(function (c) { m.appendChild(c); });
    m.addEventListener('click', function (e) { if (e.target === m && onBackdrop) onBackdrop(); });
    document.body.appendChild(m);
    return m;
  }

  /** 看原图 */
  function showLarge(src, name) {
    var img = document.createElement('img');
    img.src = src;
    img.alt = name || '';
    var bar = document.createElement('div');
    bar.className = 'dcx-bar';
    var info = document.createElement('span');
    info.textContent = name || '';
    var raw = document.createElement('button');
    raw.textContent = '在新标签打开原图';
    raw.onclick = function () { window.open(src, '_blank', 'noopener'); };
    var close = document.createElement('button');
    close.className = 'p';
    close.textContent = '关闭';
    bar.appendChild(info); bar.appendChild(raw); bar.appendChild(close);
    var m = mask([img, bar], function () { closeMask(m); });
    close.onclick = function () { closeMask(m); };
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { closeMask(m); document.removeEventListener('keydown', esc); }
    });
  }

  /** 通用输入框弹层（重命名 / 输口令都用它） */
  function ask(title, hint, value, okLabel, onOk) {
    var box = document.createElement('div');
    box.className = 'dcx-box';
    var h = document.createElement('h3'); h.textContent = title;
    var p = document.createElement('p'); p.textContent = hint || '';
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    var row = document.createElement('div'); row.className = 'row';
    var cancel = document.createElement('button'); cancel.textContent = '取消';
    var ok = document.createElement('button'); ok.className = 'p'; ok.textContent = okLabel || '确定';
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(h); if (hint) box.appendChild(p); box.appendChild(input); box.appendChild(row);
    var m = mask([box], function () { closeMask(m); });
    cancel.onclick = function () { closeMask(m); };
    ok.onclick = function () { closeMask(m); onOk(input.value.trim()); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    setTimeout(function () { input.focus(); input.select(); }, 60);
  }

  /** 口令弹层：换 ticket */
  function askPassword(next) {
    var box = document.createElement('div');
    box.className = 'dcx-box';
    var h = document.createElement('h3'); h.textContent = '先输一次口令';
    var p = document.createElement('p');
    p.textContent = '重命名要走后台接口，需要私人角落的口令（和 /admin/g/ 用的是同一个）。';
    var input = document.createElement('input');
    input.type = 'password';
    input.placeholder = '口令';
    var row = document.createElement('div'); row.className = 'row';
    var cancel = document.createElement('button'); cancel.textContent = '取消';
    var ok = document.createElement('button'); ok.className = 'p'; ok.textContent = '确定';
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(h); box.appendChild(p); box.appendChild(input); box.appendChild(row);
    var m = mask([box], function () { closeMask(m); });
    cancel.onclick = function () { closeMask(m); };
    ok.onclick = async function () {
      var pw = input.value;
      if (!pw) return;
      ok.disabled = true;
      try {
        var r = await fetch(WORKER + '/hidden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, from: 'decap-extras', want: 'all', site: location.origin }),
        });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(d.message || '口令不对');
        saveTicket(d.ticket || '');
        closeMask(m);
        next();
      } catch (err) {
        toast('口令校验失败：' + err.message, 5000);
        ok.disabled = false;
      }
    };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    setTimeout(function () { input.focus(); }, 60);
  }

  /** 调后台接口（没有 ticket 就先问口令） */
  async function adminPost(path, payload, retry) {
    var t = ticket();
    if (!t) {
      if (retry) { toast('没有登录凭证，先去 /admin/g/ 登一次', 5000); return null; }
      askPassword(function () { adminPost(path, payload, true); });
      return null;
    }
    var r = await fetch(WORKER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, payload, { ticket: t })),
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      if (/过期|口令/.test(d.message || '') && !retry) {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
        askPassword(function () { adminPost(path, payload, true); });
        return null;
      }
      throw new Error(d.message || ('请求失败 HTTP ' + r.status));
    }
    return d;
  }

  /* ---------------------------------------------------------------- 重命名 */

  function renameFlow(src, onDone) {
    var path = repoPathOf(src);
    if (!path) { toast('这张图不在 /uploads/ 下，改不了名', 4000); return; }
    var name = decodeURIComponent(path.split('/').pop() || '');
    var stem = name.replace(/\.[a-z0-9]+$/i, '');
    ask('重命名图片', '当前：' + name + '（后缀保持不变；文章里的引用会一起改）', stem, '改名', async function (v) {
      if (!v) return;
      try {
        var res = await adminPost('/admin/image/rename', { path: path, name: v, updateRefs: true });
        if (!res) return;
        var extra = res.refsUpdated ? '，同时更新了 ' + res.refsUpdated + ' 篇文章的引用' : '';
        toast('已改名为 ' + res.name + extra + '。关闭并重新打开媒体库即可看到。', 6000);
        if (onDone) onDone();
      } catch (err) {
        toast('改名失败：' + err.message, 6000);
      }
    });
  }

  /* ---------------------------------------------------------------- 注入按钮 */

  var MARK = 'data-dcx';

  function enhance() {
    var imgs = document.querySelectorAll('img[src*="' + API_PREFIX + '"]');
    /*
     * ⚠️ 这里必须用 let，不能用 var。
     * var 在循环里是**同一个绑定**，两个按钮的 onclick 会一起指向最后一张图 ——
     * 表现成「点第一张的看原图，弹出的却是最后一张」。测试抓到过一次。
     */
    for (var i = 0; i < imgs.length; i++) {
      let img = imgs[i];
      var host = img.parentNode;
      if (!host || host.getAttribute(MARK)) continue;   /* 已经加过了 */
      /* Decap 的卡片不能保证是定位元素；加 relative 只是为了让按钮贴角，
         绝对定位的子元素不参与布局，不会把网格挤变形 */
      try {
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      } catch (e) { /* 忽略 */ }
      var tools = document.createElement('div');
      tools.className = 'dcx-tools';
      var bView = document.createElement('button');
      bView.className = 'dcx-btn';
      bView.title = '看原图';
      bView.textContent = '\u{1F50D}';
      bView.onclick = function (ev) { ev.stopPropagation(); ev.preventDefault(); showLarge(img.src, img.alt || ''); };
      var bRename = document.createElement('button');
      bRename.className = 'dcx-btn';
      bRename.title = '重命名';
      bRename.textContent = '\u270E';
      bRename.onclick = function (ev) { ev.stopPropagation(); ev.preventDefault(); renameFlow(img.src, enhance); };
      tools.appendChild(bView); tools.appendChild(bRename);
      host.appendChild(tools);
      host.setAttribute(MARK, '1');
    }
  }

  function start() {
    enhance();
    /* Decap 是 React 应用，媒体库是打开时才渲染的 —— 只能盯着 DOM 变化 */
    try {
      var mo = new MutationObserver(function () { enhance(); });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* 老浏览器就算了，打开时手动一次 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
