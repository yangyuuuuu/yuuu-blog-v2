/**
 * 站内搜索引擎（Pagefind 封装）。
 *
 * 体积不小，所以不随首屏下载：SearchBox.astro 里只留一个几十字节的引导，
 * 用户「聚焦输入框 / 按 Ctrl+K / 按 /」时才动态 import 这个模块并调 init()。
 * 详见 HANDOFF.md「首屏 JS 预算」。
 *
 * 职责：
 *   · 查询语法解析（in: / tag: / category: / date: / words: / min: / "短语"）
 *   · Pagefind 索引懒加载 + 失败诊断
 *   · 中文重排（短语命中优先）
 *   · 结果面板渲染、键盘上下选择、回车打开、聚光
 */

/* 引擎只装一次：引导脚本可能从多个入口调 init()，重复装监听会双开结果面板 */
var started = false;

export function init() {
  if (started) return;
  started = true;

  // Pagefind 的运行时是构建后才生成的，交给浏览器在运行时动态加载
  var PF_URL = '/pagefind/pagefind.js';
  var root = document.getElementById('searchRoot');
  var input = document.getElementById('yuuuSearch') as HTMLInputElement | null;
  var panel = document.getElementById('yuuuSearchPanel');
  var out = document.getElementById('yuuuSearchResults');
  var clearBtn = document.getElementById('yuuuSearchClear') as HTMLButtonElement | null;
  if (!root || !input || !panel || !out || !clearBtn) return;

  /* 拿掉 null 之后固定成非空类型：下面的闭包里到处在用，每次判空反而更吵 */
  var box: HTMLElement = panel;
  var results: HTMLElement = out;
  var field: HTMLInputElement = input;
  var button: HTMLButtonElement = clearBtn;
  var scope: HTMLElement = root;

  var mod: any = null, loading = false, timer: any = null, seq = 0, lastError = '';
  var hits: HTMLAnchorElement[] = [];   // 当前面板里的结果链接
  var active = -1;        // 键盘选中的下标，-1 表示没选
  var pendingOpen = false; // 结果还没出来时就按了回车 → 出来立刻打开第一条

  function esc(s: any): string {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function load() {
    if (mod) return Promise.resolve(mod);
    if (loading) return Promise.resolve(null);
    loading = true;
    return import(/* @vite-ignore */ PF_URL)
      .then(function (m) {
        mod = m;
        return m.options({ excerptLength: 26 })
          .then(function () { return m.init(); })
          .then(function () { return m; });
      })
      .catch(function (err) {
        mod = null;
        lastError = err && err.message ? err.message : String(err);
        return null;
      })
      .then(function (m) { loading = false; return m; });
  }

  /**
   * 索引加载失败时先探一下 /pagefind/ 到底在不在，再给准确的建议。
   * 最常见的坑：跑 npm run dev 时 Astro 只服务源码，不提供 dist/，
   * 这时候「先 build」是没用的，必须改用 npm run preview。
   */
  function explain() {
    show('<p class="search-empty">搜索索引没能加载，正在诊断…</p>');
    fetch('/pagefind/pagefind-entry.json', { cache: 'no-store' })
      .then(function (res) {
        if (res.ok) {
          show('<p class="search-empty">索引文件是存在的，但运行时报错了。<br>错误：' +
            esc(lastError || '未知') + '</p>');
        } else {
          show('<p class="search-empty">服务器上没有 <code>/pagefind/</code> 目录（HTTP ' + res.status + '）。<br>' +
            '如果正在跑 <code>npm run dev</code>：Astro 开发服务器只服务源码，不提供构建产物。<br>' +
            '正确顺序是先 <code>npm run build</code>，再用 <code>npm run preview</code> 打开。</p>');
        }
      })
      .catch(function () {
        show('<p class="search-empty">访问不到 <code>/pagefind/</code>。<br>' +
          '请先 <code>npm run build</code>，再用 <code>npm run preview</code> 打开。</p>');
      });
  }

  function show(html: string): void {
    results.innerHTML = html;
    box.hidden = false;
    box.classList.add('is-interactive');
  }
  /** 只收起面板，保留结果 —— 再次聚焦时还要用 */
  function hide(): void {
    box.hidden = true;
    box.classList.remove('is-interactive');
    hits = [];
    active = -1;
    pendingOpen = false;
  }

  /** 重新展开上次的结果（点回输入框时用） */
  function resume(): void {
    if (!field.value.trim() || !results.innerHTML) return;
    box.hidden = false;
    box.classList.add('is-interactive');
    hits = [].slice.call(results.querySelectorAll('.search-hit'));
    active = -1;
  }

  /* 键盘选择：上下键在结果间移动，并把选中项滚进可视区 */
  function paint(): void {
    hits.forEach(function (a, i) { a.classList.toggle('is-active', i === active); });
    if (active < 0 || !hits[active]) return;
    var r = hits[active].getBoundingClientRect();
    var p = box.getBoundingClientRect();
    if (r.top < p.top || r.bottom > p.bottom) hits[active].scrollIntoView({ block: 'nearest' });
  }
  function move(delta: number): void {
    if (!hits.length) return;
    active = active < 0
      ? (delta > 0 ? 0 : hits.length - 1)
      : (active + delta + hits.length) % hits.length;
    paint();
  }
  function openCurrent(): boolean {
    var a = hits[active >= 0 ? active : 0];
    if (!a) return false;
    location.href = a.href;
    return true;
  }

  /* ---------------------------------------------------------------
     查询语法
       in:title,tag        只在指定字段里找（title / tag / category）
       tag:前端            限定标签（走 Pagefind 原生筛选器）
       category:技术       限定分类
       date:2024-01..2024-12
       words:500..2000     字数区间
       min:1..5            阅读分钟区间
       "精确短语"           引号包起来当一个整体
       其余的词            走全文检索
     --------------------------------------------------------------- */
  /**
   * 区间值支持三种写法：
   *   words:500..2000   闭区间
   *   words:<2000       小于
   *   words:>=800       大于等于
   */
  function parseRange(v: string): any {
    var m = /^(<=|>=|<|>)?(-?\d[\d-]*)(?:\.\.(-?\d[\d-]*))?$/.exec(v);
    if (!m) return null;
    if (m[1]) return { raw: v, op: m[1], n: m[2] };
    return { raw: v, lo: m[2], hi: m[3] === undefined ? m[2] : m[3] };
  }

  /** numeric=true 按数字比，false 按字符串比（ISO 日期字符串直接比就对） */
  function inRange(r: any, value: any, numeric: boolean): boolean {
    if (!r) return true;
    if (r.op) {
      var t = numeric ? Number(r.n) : r.n;
      var x = numeric ? Number(value) : String(value);
      if (r.op === '<') return x < t;
      if (r.op === '>') return x > t;
      if (r.op === '<=') return x <= t;
      return x >= t;
    }
    if (numeric) {
      var n = Number(value);
      return n >= Number(r.lo) && n <= Number(r.hi);
    }
    var s = String(value);
    return s >= r.lo && s <= r.hi;
  }

  function parseQuery(raw: string): any {
    var q: any = { text: [], in: [], tag: '', cat: '', ranges: {} };
    var re = /"([^"]*)"|(\S+)/g;
    var m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      if (m[1] !== undefined) {
        if (m[1].trim()) q.text.push(m[1].trim());
        continue;
      }
      var tok = m[2];
      var i = tok.indexOf(':');
      if (i <= 0) { q.text.push(tok); continue; }
      var key = tok.slice(0, i).toLowerCase();
      var val = tok.slice(i + 1);
      if (!val) { q.text.push(tok); continue; }

      if (key === 'in') {
        val.split(',').forEach(function (f: string) {
          f = f.trim().toLowerCase();
          if (f) q.in.push(f);
        });
      } else if (key === 'tag' || key === 'tags') q.tag = val;
      else if (key === 'category' || key === 'cat') q.cat = val;
      else if (key === 'date') q.ranges.date = parseRange(val);
      else if (key === 'words' || key === 'word') q.ranges.words = parseRange(val);
      else if (key === 'min' || key === 'minutes') q.ranges.min = parseRange(val);
      else q.text.push(tok);   // 不认识的 key 当普通词处理
    }
    return q;
  }

  var IN_FIELDS: Record<string, (m: any) => string> = {
    title: function (m: any) { return m.title || ''; },
    tag: function (m: any) { return m.tags || ''; },
    tags: function (m: any) { return m.tags || ''; },
    category: function (m: any) { return m.category || ''; },
  };

  /** 客户端侧筛选：Pagefind 只能做全文和筛选器，区间比较得自己来 */
  function matchMeta(q: any, meta: any): boolean {
    meta = meta || {};
    if (q.in.length && q.text.length) {
      var hay = q.in.map(function (f: string) {
        return IN_FIELDS[f] ? IN_FIELDS[f](meta) : '';
      }).join(' ').toLowerCase();
      if (!q.text.some(function (w: string) { return hay.indexOf(w.toLowerCase()) >= 0; })) return false;
    }
    if (q.tag && String(meta.tags || '').toLowerCase().indexOf(q.tag.toLowerCase()) < 0) return false;
    if (q.cat && String(meta.category || '') !== q.cat) return false;
    var r = q.ranges;
    if (r.date && !inRange(r.date, meta.date || '', false)) return false;
    if (r.words && !inRange(r.words, meta.words || 0, true)) return false;
    if (r.min && !inRange(r.min, meta.minutes || 0, true)) return false;
    return true;
  }

  /** 把当前生效的条件写成人话，显示在结果上方 */
  function describeQuery(q: any): string[] {
    var bits = [];
    if (q.in.length) bits.push('in:' + q.in.join(','));
    if (q.tag) bits.push('tag:' + q.tag);
    if (q.cat) bits.push('category:' + q.cat);
    ['date', 'words', 'min'].forEach(function (k) {
      if (q.ranges[k]) bits.push(k + ':' + q.ranges[k].raw);
    });
    return bits;
  }

  /**
   * 相关度打分。
   * Pagefind 对中文没有分词，会把「不喜欢」拆成单字匹配，
   * 于是只含「不」的文章也可能排在前面。这里补一层排序：
   * 完整命中标题 > 完整命中摘要 > 命中比例高 > Pagefind 原始顺序。
   */
  function score(d: any, needle: string): number {
    var n = String(needle || '').toLowerCase();
    if (!n) return 0;
    var title = String((d.meta && d.meta.title) || '').toLowerCase();
    var text = String(d.excerpt || '').replace(/<[^>]+>/g, '').toLowerCase();
    var s = 0;
    if (title.indexOf(n) >= 0) s += 1000;      // 整串出现在标题里
    if (text.indexOf(n) >= 0) s += 400;        // 整串出现在摘要里
    var hit = 0;
    for (var i = 0; i < n.length; i++) if (text.indexOf(n[i]) >= 0) hit++;
    s += (hit / n.length) * 30;                // 命中比例
    return s;
  }

  function rank(list: any[], needle: string): any[] {
    return list
      .map(function (d, i) { return { d: d, s: score(d, needle), i: i }; })
      .sort(function (a, b) { return b.s - a.s || a.i - b.i; })  // 同分保持原序
      .map(function (x) { return x.d; });
  }

  function render(list: any[], raw: string, q: any): void {
    var chips = describeQuery(q);
    var head = chips.length
      ? '<p class="search-chips">' + chips.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') + '</p>'
      : '';

    if (!list.length) {
      hits = []; active = -1; pendingOpen = false;
      show(head + '<div class="search-empty search-empty-art">' +
        '<img src="/mascot/pillow.webp" alt="" width="469" height="400" loading="lazy" decoding="async">' +
        '<p>没有找到「' + esc(raw) + '」相关的文章</p>' +
        '<p class="search-tip">' +
        '<code>in:title 关键词</code> · <code>tag:前端</code> · <code>category:技术</code><br>' +
        '<code>date:2024-01..2024-12</code> · <code>words:500..2000</code> · <code>min:1..5</code>' +
        '</p></div>');
      return;
    }

    show(head + list.map(function (r) {
      var meta = r.meta || {};
      var title = meta.title || r.url;
      var date = meta.dateText || meta.date || '';
      // ?q= 只带自由文本，文章页拿它去正文里找第一处匹配
      var href = r.url + '?q=' + encodeURIComponent(q.text.join(' ') || raw);
      return '<a class="search-hit" href="' + esc(href) + '">' +
        '<span class="search-hit-top"><b>' + esc(title) + '</b>' +
        (date ? '<i>' + esc(date) + '</i>' : '') + '</span>' +
        '<span class="search-hit-excerpt">' + (r.excerpt || '') + '</span>' +
        '</a>';
    }).join('') +
      '<div class="search-foot">' +
      '<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>' +
      '<span><kbd>Enter</kbd> 打开</span>' +
      '<span><kbd>Esc</kbd> 关闭</span></div>');
    hits = [].slice.call(results.querySelectorAll('.search-hit'));
    active = -1;
    // 用户已经按过回车了，结果一到就直接打开第一条
    if (pendingOpen) { pendingOpen = false; openCurrent(); }
  }

  function run(raw: string): void {
    raw = (raw || '').trim();
    if (!raw) { hide(); return; }

    /* 彩蛋：输 hide 直接去私人角落（口令校验在 Worker 上，见 src/pages/private.astro） */
    if (/^hide$/i.test(raw)) {
      location.href = '/private/?from=search';
      return;
    }

    var q = parseQuery(raw);
    var plain = q.text.join(' ').trim();
    /* 短语检索：把词用引号包起来，逼 Pagefind 只匹配连续出现的整串。
       中文没分词，不加引号时「不喜欢」会被拆成单字，含「不」的文章也能中。 */
    var phrase = q.text.map(function (w: string) {
      return /\s/.test(w) ? '"' + w + '"' : w.length > 1 ? '"' + w + '"' : w;
    }).join(' ').trim();

    var filters: Record<string, string> = {};
    if (q.tag) filters.tag = q.tag;
    if (q.cat) filters.category = q.cat;
    var hasFilter = Object.keys(filters).length > 0;

    // 光有筛选条件没关键词也行；两样都没有就没什么可搜的
    if (!plain && !hasFilter) { hide(); return; }

    var mine = ++seq;
    hits = [];
    active = -1;
    show('<p class="search-empty">搜索中…</p>');

    var opts = hasFilter ? { filters: filters } : {};

    function grab(pf: any, term?: string): Promise<any[]> {
      return pf.search(term || null, opts).then(function (res: any) {
        // 多取一些：后面还要做区间筛选和重排，取太少会不够一屏
        return Promise.all(res.results.slice(0, 40).map(function (r: any) { return r.data(); }));
      });
    }

    load().then(function (pf: any) {
      if (mine !== seq) return;
      if (!pf) { explain(); return; }

      return grab(pf, phrase).then(function (list: any[]) {
        // 严格短语一个都没中，再放宽成普通检索，免得直接「无结果」
        if (list.length || !plain || phrase === plain) return list;
        return grab(pf, plain);
      }).then(function (list: any[]) {
        if (mine !== seq) return;
        var kept = list.filter(function (d: any) { return matchMeta(q, d.meta); });
        // 排序用的关键词：优先拿自由文本，纯筛选查询就按原标题顺序
        render(rank(kept, plain).slice(0, 12), raw, q);
      });
    }).catch(function () {
      if (mine === seq) show('<p class="search-empty">搜索出错了，稍后重试</p>');
    });
  }

  /* 聚光效果：聚焦开、失焦关。和面板显隐是两件事，分开控制 */
  function setSpotlight(on: boolean): void {
    var veil = document.getElementById('searchVeil');
    if (veil) veil.classList.toggle('is-on', on);
    document.documentElement.classList.toggle('is-searching', on);
  }

  /* 点面板里的结果时不要先失焦，否则聚光会闪一下 */
  box.addEventListener('mousedown', function (e) { e.preventDefault(); });

  /* 聚焦：预加载 + 聚光，并把上次的结果重新摊开 */
  field.addEventListener('focus', function () {
    load();
    setSpotlight(true);
    resume();
  });
  field.addEventListener('blur', function () { setSpotlight(false); });
  field.addEventListener('input', function () {
    button.hidden = !field.value;
    clearTimeout(timer);
    timer = setTimeout(function () { run(field.value); }, 140);
  });
  button.addEventListener('click', function () {
    field.value = ''; button.hidden = true; hide(); field.focus();
  });
  document.addEventListener('click', function (e) {
    if (!scope.contains(e.target as Node)) hide();
  });
  field.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 结果还没渲染出来就先立刻搜一次并记为「待打开」，别让回车看起来没反应
      if (!hits.length) {
        if (!field.value.trim()) return;
        clearTimeout(timer);
        pendingOpen = true;
        run(field.value);
        return;
      }
      openCurrent();
    }
  });

  /* 判断焦点是不是在可输入元素里 —— 在输入框里打「/」不该抢焦点 */
  function isTyping(el: any): boolean {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable === true;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hide(); field.blur(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      field.focus();
      field.select();
      return;
    }
    // 「/」也能唤起搜索（不带修饰键、且当前没在别处打字）
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
      e.preventDefault();
      field.focus();
      field.select();
    }
  });

  /*
   * 补跑第一次输入（键盘唤起时的兜底）。
   *
   * 按「/」或 Ctrl+K 是引导脚本先聚焦、再下载模块，敲进去的字一定落后于 init()，
   * 常走的输入路径不靠这里。真正要兜的是「用户比模块快」的情况：
   * 点进搜索框直接开打，或者搜索指南页塞完值才轮到引擎 ——
   * 那一瞬间的 input 事件没人接，补一次免得看起来像键盘坏了。
   *
   * 无条件挂 240ms 是故意的：init() 执行时输入框几乎必然是空的，
   * 写成 if (input.value.trim()) 永远不会成立（这个坑踩过，冒烟测试专门盯着它）。
   * 已经有结果或已被清空就跳过，免得覆盖用户后来的操作。
   */
  clearTimeout(timer);
  timer = setTimeout(function () {
    if (!field.value.trim() || results.innerHTML) return;
    run(field.value);
  }, 240);
}
