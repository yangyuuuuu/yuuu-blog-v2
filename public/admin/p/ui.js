/**
 * 文章管理页的控制器（/admin/p/）。
 *
 * 为什么另做一页而不是给 Decap 加功能：
 *   · Decap 的 view_filters 只对**单个字段**做正则匹配，没法跨字段搜正文；
 *   · 它默认也看不到草稿（要切筛选），发文频繁时不好找。
 * 所以这里做一页「全部文章 + 真搜索 + 分类筛选 + 草稿」，点开就进手机写作页编辑。
 *
 * 和写作页、图库共用同一个 session key，登录一次三处通用。
 */
import { filtersOf, query, relativeDay, describe, initialOf, postUrl } from './posts.js';

const API = 'https://oauth.yuuu.love';
const SESSION_KEY = 'yuuu-mobile-editor';

const $ = (id) => document.getElementById(id);
const el = {
  screenLogin: $('screenLogin'), screenList: $('screenList'),
  loginForm: $('loginForm'), pwd: $('pwd'), loginBtn: $('loginBtn'), loginMsg: $('loginMsg'),
  search: $('search'), filters: $('filters'), list: $('list'), empty: $('empty'),
  count: $('count'), refreshBtn: $('refreshBtn'), newBtn: $('newBtn'), toast: $('toast'),
};

let ticket = '';
let posts = [];
let filterId = 'all';
let keyword = '';
let toastTimer = 0;

const say = (node, text, kind) => {
  node.textContent = text || '';
  node.classList.toggle('is-error', kind === 'error');
  node.classList.toggle('is-ok', kind === 'ok');
};
function toast(text, ms = 2400) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}
const show = (which) => {
  el.screenLogin.hidden = which !== 'login';
  el.screenList.hidden = which !== 'list';
  window.scrollTo(0, 0);
};
const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
const saveSession = () => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ticket, at: Date.now() })); } catch { /* 忽略 */ } };

/* ------------------------------------------------------------------ 登录 */

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = el.pwd.value;
  if (!password) { say(el.loginMsg, '先输口令', 'error'); return; }
  el.loginBtn.disabled = true;
  say(el.loginMsg, '正在校验…');
  try {
    const res = await fetch(API + '/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, from: 'posts-admin', want: 'all', site: location.origin }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(data.message || '试得太频繁了，等 15 分钟再来');
    if (!res.ok) throw new Error(data.message || '口令不对');
    ticket = data.ticket || '';
    saveSession();
    el.pwd.value = '';
    say(el.loginMsg, '');
    show('list');
    await load();
  } catch (err) {
    say(el.loginMsg, err.message || '校验失败', 'error');
    el.pwd.select();
  } finally {
    el.loginBtn.disabled = false;
  }
});

/* ------------------------------------------------------------------ 数据 */

async function post(path, payload) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(payload || {}), ticket }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (/过期/.test(data.message || '')) {
      ticket = '';
      show('login');
      say(el.loginMsg, data.message, 'error');
      throw new Error('need-login');
    }
    throw new Error(data.message || ('请求失败（HTTP ' + res.status + '）'));
  }
  return data;
}

async function load() {
  if (!ticket) { show('login'); return; }
  el.count.textContent = '加载中…';
  try {
    const data = await post('/admin/posts-index', {});
    if (data.needReindex) {
      /* 索引只在 KV 里（含全文，绝不能是公开文件），所以第一次用要现场建一次 */
      await reindex();
      return;
    }
    posts = data.posts || [];
    renderFilters();
    render();
  } catch (err) {
    if (err.message === 'need-login') return;
    el.count.textContent = '';
    toast(err.message, 4000);
  }
}

/** 从 GitHub 现场重建索引（Worker 读全部文章并抽 frontmatter，约几秒） */
async function reindex() {
  el.count.textContent = '正在建索引…';
  toast('第一次使用要建一次全文索引，稍等几秒…', 20000);
  try {
    const res = await post('/admin/reindex', {});
    toast('索引建好了：' + res.count + ' 篇');
    const data = await post('/admin/posts-index', {});
    posts = data.posts || [];
    renderFilters();
    render();
  } catch (err) {
    if (err.message === 'need-login') return;
    el.count.textContent = '';
    toast('建索引失败：' + err.message, 5000);
  }
}

/* ------------------------------------------------------------------ 渲染 */

function renderFilters() {
  const list = filtersOf(posts);
  if (!list.some((f) => f.id === filterId)) filterId = 'all';
  el.filters.innerHTML = '';
  list.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (f.id === filterId ? ' is-on' : '');
    b.dataset.id = f.id;
    b.textContent = f.label + ' ' + f.count;
    b.setAttribute('role', 'tab');
    el.filters.appendChild(b);
  });
}

/** 把命中的关键词标出来（只在标题和片段里标，够用了） */
function mark(text, kw) {
  const t = String(text || '');
  const k = String(kw || '').trim();
  if (!k) return document.createTextNode(t);
  const frag = document.createDocumentFragment();
  const lower = t.toLowerCase();
  const kl = k.toLowerCase();
  let i = 0;
  for (;;) {
    const at = lower.indexOf(kl, i);
    if (at < 0) { frag.appendChild(document.createTextNode(t.slice(i))); break; }
    frag.appendChild(document.createTextNode(t.slice(i, at)));
    const m = document.createElement('mark');
    m.textContent = t.slice(at, at + k.length);
    frag.appendChild(m);
    i = at + k.length;
  }
  return frag;
}

function render() {
  const hits = query(posts, { filterId, keyword });
  el.count.textContent = hits.length === posts.length ? posts.length + ' 篇' : hits.length + ' / ' + posts.length + ' 篇';
  el.empty.hidden = hits.length !== 0;
  el.empty.textContent = keyword ? '没有匹配「' + keyword + '」的文章' : '这里还没有文章';
  el.list.innerHTML = '';

  hits.forEach((hit, i) => {
    const p = hit.post;
    const li = document.createElement('li');
    li.className = 'item' + (hit.snippet ? ' item-2col' : '');
    li.style.animationDelay = (i < 10 ? i * 20 : 0) + 'ms';

    const mark1 = document.createElement('span');
    mark1.className = 'item-mark';
    mark1.textContent = initialOf(p.title);

    const body = document.createElement('span');
    body.className = 'item-body';
    const title = document.createElement('span');
    title.className = 'item-title';
    title.appendChild(mark(p.title || p.slug, keyword));
    if (hit.where) {
      const w = document.createElement('span');
      w.className = 'item-where';
      w.textContent = hit.where;
      title.appendChild(w);
    }
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = describe({ ...p, date: relativeDay(p.updated || p.date) });
    body.append(title, meta);
    if (hit.snippet) {
      const sn = document.createElement('span');
      sn.className = 'item-snippet';
      sn.appendChild(mark(hit.snippet, keyword));
      body.appendChild(sn);
    }

    li.append(mark1, body);

    /*
     * 点一条 = **直接打开这篇文章**（新标签，后台列表留着不动）。
     * 想看它在站上长什么样、或者把链接分享出去，都是这个需求。
     * 要改内容请点右边那个「改」按钮。
     */
    const href = postUrl(p);
    if (href) {
      li.addEventListener('click', () => window.open(href, '_blank', 'noopener'));
      li.title = '打开 ' + decodeURIComponent(href);
    }

    /* 编辑入口单独一个按钮，避免和「打开文章」抢点击 */
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'item-edit';
    edit.textContent = '改';
    edit.title = '在写作页里编辑这篇';
    edit.addEventListener('click', (e) => {
      e.stopPropagation();   /* 别顺带触发外层的「打开文章」 */
      location.href = '/admin/m/?edit=' + encodeURIComponent(p.slug);
    });
    li.appendChild(edit);

    el.list.appendChild(li);
  });
}

el.filters.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  filterId = b.dataset.id;
  renderFilters();
  render();
});
el.search.addEventListener('input', () => { keyword = el.search.value; render(); });
el.refreshBtn.addEventListener('click', () => reindex());
el.newBtn.addEventListener('click', () => { location.href = '/admin/m/'; });

/* ------------------------------------------------------------------ 启动 */

(async function boot() {
  const saved = readSession();
  if (saved?.ticket) {
    ticket = saved.ticket;
    show('list');
    await load();
  } else {
    show('login');
    el.pwd.focus();
  }
})();
