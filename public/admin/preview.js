/**
 * 后台「预览」面板 —— 让它长得像线上文章页，而不是 Decap 默认的裸样式。
 *
 * 两个问题：
 *   1. Decap 默认预览只是把 Markdown 直接倒出来，没有标题排版、没有封面、
 *      没有日期/标签那一行，和线上差异大到没法定版式。
 *   2. 真正「一模一样」只能靠构建后的页面，但草稿还没构建，做不到。
 *
 * 所以这里：按 PostLayout.astro 的结构重画一遍（标题 / 元信息 / 标签 / 封面 /
 * 正文排版），样式走 preview.css（手抄主题令牌，不引构建产物，避免哈希文件名过期）。
 * 用 decoupled: true 把它放进 iframe —— 后台界面完全不会被这些样式碰到。
 *
 * 想改版式：preview.css 调样式，本文件的 render() 调结构。
 * 改完硬刷新 /admin/ 就能看到（文件没走构建，直接就是源码）。
 */
(function () {
  'use strict';

  var h = window.h;
  var createClass = window.createClass;

  /* 封面池：与 src/lib/covers.ts 对应。加图时两处一起加。 */
  var COVER_POOL = {
    stand: '/mascot/stand.webp', sword: '/mascot/sword.webp', shy: '/mascot/shy.webp',
    cake: '/mascot/cake.webp', pillow: '/mascot/pillow.webp', snack: '/mascot/snack.webp',
    cry: '/mascot/cry.webp',
  };

  var SITE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'https://yuuu.love'
    : location.origin;

  /* ---------- 极简 Markdown → React 节点 ---------- */
  function inline(text, key) {
    var out = [];
    var i = 0;
    var re = /^(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
    while (i < text.length) {
      var rest = text.slice(i);
      var m = rest.match(re);
      if (m) {
        var tok = m[0];
        if (tok.slice(0, 2) === '**') out.push(h('strong', { key: key + '-' + i }, tok.slice(2, -2)));
        else if (tok[0] === '*') out.push(h('em', { key: key + '-' + i }, tok.slice(1, -1)));
        else if (tok[0] === '`') out.push(h('code', { key: key + '-' + i }, tok.slice(1, -1)));
        else {
          var bits = tok.slice(1, -1).split('](');
          out.push(h('a', { key: key + '-' + i, href: bits[1] }, bits[0]));
        }
        i += tok.length;
      } else {
        /* 没有可以解析的记号，就原样吃一个字符（这一步漏了会静默吞字） */
        out.push(rest[0]);
        i += 1;
      }
    }
    return out;
  }

  function markdown(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var nodes = [];
    var i = 0;
    var k = 0;

    function flushPara(buf) {
      if (!buf.length) return;
      nodes.push(h('p', { key: 'p' + (k++) }, inline(buf.join(' '), 'p' + k)));
      buf.length = 0;
    }

    var para = [];
    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { flushPara(para); i++; continue; }

      /* 代码块 */ 
      if (/^```/.test(line)) {
        flushPara(para);
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        nodes.push(h('pre', { key: 'pre' + (k++) }, h('code', null, code.join('\n'))));
        continue;
      }

      /* 标题 */
      var hm = line.match(/^(#{1,4})\s+(.*)$/);
      if (hm) {
        flushPara(para);
        nodes.push(h('h' + hm[1].length, { key: 'h' + (k++) }, inline(hm[2], 'h' + k)));
        i++;
        continue;
      }

      /* 引用 */
      if (/^\s*>\s?/.test(line)) {
        flushPara(para);
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        nodes.push(h('blockquote', { key: 'q' + (k++) }, inline(q.join(' '), 'q' + k)));
        continue;
      }

      /* 分隔线 */
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(para); nodes.push(h('hr', { key: 'hr' + (k++) })); i++; continue; }

      /* 列表 */
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        flushPara(para);
        var ordered = /^\s*\d+\./.test(line);
        var items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items.push(h('li', { key: 'li' + (k++) }, inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''), 'li' + k)));
          i++;
        }
        nodes.push(h(ordered ? 'ol' : 'ul', { key: 'l' + (k++) }, items));
        continue;
      }

      para.push(line);
      i++;
    }
    flushPara(para);
    return nodes;
  }

  /* ---------- 词数 / 阅读时长 ---------- */
  function stats(body) {
    var text = String(body || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#*>`\-\[\]()]/g, ' ');
    var chars = text.replace(/\s+/g, '').length;
    var en = (text.match(/[A-Za-z0-9]+/g) || []).length;
    return { words: chars + en * 2, minutes: Math.max(1, Math.round((chars / 400) * 10) / 10) };
  }

  function coverOf(data) {
    var raw = String(data.get('cover') || '').trim();
    if (raw) return COVER_POOL[raw] || raw;
    return '';
  }

  /* ---------- 预览模板 ---------- */
  var Preview = createClass({
    render: function () {
      var entry = this.props.entry;
      var data = entry.get('data');
      var title = data.get('title') || '（还没写标题）';
      var date = data.get('date');
      var updated = data.get('updated');
      var category = data.get('category') || '';
      var tags = data.get('tags');
      var body = data.get('body') || '';
      var st = stats(body);
      var cover = coverOf(data);
      var letter = (title.trim()[0] || 'y');

      var dateText = date ? String(date).slice(0, 10) : '';
      var upText = updated ? String(updated).slice(0, 10) : '';
      var meta = [dateText, upText && upText !== dateText ? '改于 ' + upText : '', category,
                  st.words + ' 字', '约 ' + st.minutes + ' 分钟'].filter(Boolean);

      /*
       * 封面。
       * 三种情况都要给得出「看得见的东西」，否则用户看到的就是一块莫名其妙的空白：
       *   1. 选了封面池里的 id 或自定义图片 → 出图（加载失败自动退回渐变，不留破图）
       *   2. 没选封面 → 按「封面色相」画渐变（和线上 PostLayout 同一套规则），中间放首字
       *   3. 渐变的色相也空着 → 用站点默认的 202（水蓝）
       */
      var hue = Number(data.get('coverHue'));
      if (!isFinite(hue) || hue < 0 || hue > 359) hue = 202;
      var grad = 'linear-gradient(135deg, hsl(' + hue + ' 62% 54%), hsl(' + ((hue + 46) % 360) + ' 58% 42%))';
      var coverNode = h('div', { className: 'pv-cover pv-cover-wrap', style: { background: grad } },
        /* 首字垫在底下：图加载出来了自然被盖住；加载失败就露出渐变+首字，不会是破图或空白 */
        h('span', { className: 'pv-cover-letter', key: 'l' }, letter),
        cover
          ? h('img', {
              key: 'img',
              src: cover,
              alt: title,
              style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
              onError: function (e) { e.currentTarget.style.display = 'none'; },
            })
          : null,
        h('span', { className: 'pv-cover-meta', key: 'm' },
          cover ? '封面：' + cover : '没选封面 · 按封面色相画渐变（hue ' + hue + '）'),
      );

      var tagNodes = (Array.isArray(tags) ? tags : []).map(function (t, n) {
        return h('span', { className: 'pv-tag', key: 't' + n }, '#' + t);
      });

      return h('div', null,
        h('div', { className: 'pv-hint' },
          '这是按文章页排版做的预览，草稿也能看。真正上线后的效果以构建为准（约 1 分钟）。'),
        h('article', { className: 'pv-article' },
          h('h1', { className: 'pv-title' }, title),
          h('div', { className: 'pv-meta' }, meta.map(function (t, n) { return h('span', { key: 'm' + n }, t); })),
          tagNodes.length ? h('div', { className: 'pv-tags' }, tagNodes) : null,
          coverNode,
          h('div', { className: 'pv-body' }, markdown(body))
        )
      );
    },
  });

  window.CMS.registerPreviewStyle('preview.css');
  window.CMS.registerPreviewTemplate('posts', Preview);
})();
