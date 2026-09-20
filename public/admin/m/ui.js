/**
 * 手机写作页的控制器：把 DOM 事件接到 app.js 的规则和 Worker 的接口上。
 *
 * 分工：本文件只管「界面上发生什么」，规则在 app.js（可被测试直接 import），
 * 写仓库在 Worker（token 只在服务端）。
 */
import {
  createApi, parseTags, joinTags, initialOf, describe, relativeDay, validate,
  CATEGORIES, categoryNote, normalizeCategory, toHardBreaks,
} from './app.js';

const API = 'https://oauth.yuuu.love';
const SESSION_KEY = 'yuuu-mobile-editor';

const $ = (id) => document.getElementById(id);
const el = {
  screenLogin: $('screenLogin'), screenList: $('screenList'), screenEdit: $('screenEdit'),
  loginForm: $('loginForm'), pwd: $('pwd'), loginBtn: $('loginBtn'), loginMsg: $('loginMsg'),
  list: $('list'), listEmpty: $('listEmpty'), listCount: $('listCount'), search: $('search'),
  filters: $('filters'), newBtn: $('newBtn'), refreshBtn: $('refreshBtn'),
  backBtn: $('backBtn'), moreBtn: $('moreBtn'), editState: $('editState'),
  fTitle: $('fTitle'), fBody: $('fBody'), fTags: $('fTags'), fSummary: $('fSummary'), fDate: $('fDate'),
  fDraft: $('fDraft'), fPrivate: $('fPrivate'), fBreaks: $('fBreaks'), tagRow: $('tagRow'),
  breakHint: $('breakHint'),
  saveBtn: $('saveBtn'), saveMsg: $('saveMsg'), saveFab: $('saveFab'), wordCount: $('wordCount'),
  sheet: $('sheet'), viewBtn: $('viewBtn'), delBtn: $('delBtn'), cancelSheet: $('cancelSheet'),
  toast: $('toast'),
  cats: $('cats'), catHint: $('catHint'),
};

/** 当前选中的分类（默认随笔，和站点一贯的默认一致） */
let category = '随笔';

/** 「回车即换行」开关的持久化键。默认开 —— 手机上写东西的人基本都按回车当换行 */
const BREAKS_KEY = 'yuuu-mobile-breaks';
const readBreaks = () => {
  try { return localStorage.getItem(BREAKS_KEY) !== '0'; } catch { return true; }
};
const saveBreaks = (on) => { try { localStorage.setItem(BREAKS_KEY, on ? '1' : '0'); } catch { /* 忽略 */ } };

let ticket = '';
let posts = [];
let filter = 'all';
let keyword = '';
/** 当前在编辑的是哪一篇：null 表示新建 */
let current = null;
let dirty = false;
let toastTimer = 0;

const api = createApi(API, () => ticket);

/* ------------------------------------------------------------------ 小工具 */

function say(node, text, kind) {
  node.textContent = text || '';
  node.classList.toggle('is-error', kind === 'error');
  node.classList.toggle('is-ok', kind === 'ok');
}

function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

function show(which) {
  el.screenLogin.hidden = which !== 'login';
  el.screenList.hidden = which !== 'list';
  el.screenEdit.hidden = which !== 'edit';
  window.scrollTo(0, 0);
  /* 列表滚到顶没意义，写作时把标题滚进视野更自然 */
  if (which === 'edit') document.querySelector('.edit-body').scrollTop = 0;
}

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ticket, at: Date.now() }));
  } catch { /* 隐私模式下写不了，忽略 */ }
}
function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 忽略 */ }
}

/** 浏览器原生确认框在手机上不难看，比自己画一个省事且不会出 bug */
const confirmAsk = (text) => Promise.resolve(window.confirm(text));

/* ------------------------------------------------------------------ 登录 */

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = el.pwd.value;
  if (!password) { say(el.loginMsg, '先输口令', 'error'); return; }
  el.loginBtn.disabled = true;
  say(el.loginMsg, '正在校验…');
  try {
    const data = await api.login(password);
    ticket = data.ticket || '';
    saveSession();
    el.pwd.value = '';
    say(el.loginMsg, '');
    await loadList(data.posts);
    show('list');
    await openRequested();
  } catch (err) {
    say(el.loginMsg, err.message || '校验失败', 'error');
    el.pwd.select();
  } finally {
    el.loginBtn.disabled = false;
  }
});

/* ------------------------------------------------------------------ 列表 */

async function loadList(fromLogin) {
  if (!ticket) { show('login'); return; }
  el.listCount.textContent = '加载中…';
  try {
    const data = fromLogin && Array.isArray(fromLogin)
      ? { posts: fromLogin }
      : await api.list();
    posts = data.posts || [];
    renderList();
  } catch (err) {
    el.listCount.textContent = '';
    if (/过期/.test(err.message)) { clearSession(); ticket = ''; show('login'); say(el.loginMsg, err.message, 'error'); return; }
    toast(err.message || '加载失败');
  }
}

function visiblePosts() {
  const k = keyword.trim().toLowerCase();
  return posts.filter((p) => {
    if (filter === 'draft' && !p.draft) return false;
    if (filter === 'published' && p.draft) return false;
    if (filter === 'hidden' && !p.hidden) return false;
    if (!k) return true;
    return [p.title, p.category, (p.tags || []).join(' '), p.summary]
      .some((v) => String(v || '').toLowerCase().includes(k));
  });
}

function renderList() {
  const items = visiblePosts();
  el.listCount.textContent = items.length === posts.length
    ? posts.length + ' 篇'
    : items.length + ' / ' + posts.length + ' 篇';
  el.listEmpty.hidden = items.length !== 0;
  el.list.innerHTML = '';

  items.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'item';
    /* 列表长了以后逐个淡入会显得拖沓，这里只给前 8 个错峰 */
    li.style.animationDelay = (i < 8 ? i * 22 : 0) + 'ms';

    const mark = document.createElement('span');
    mark.className = 'item-mark';
    mark.textContent = initialOf(p.title);

    const body = document.createElement('span');
    body.className = 'item-body';
    const title = document.createElement('span');
    title.className = 'item-title';
    title.textContent = p.title || p.slug;
    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = describe({ ...p, date: relativeDay(p.updated || p.date) });
    body.append(title, meta);

    const arrow = document.createElement('span');
    arrow.className = 'item-arrow';
    arrow.textContent = '›';

    li.append(mark, body, arrow);
    li.addEventListener('click', () => openPost(p));
    el.list.appendChild(li);
  });
}

el.search.addEventListener('input', () => { keyword = el.search.value; renderList(); });
el.filters.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  filter = btn.dataset.filter;
  el.filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === btn));
  renderList();
});
el.refreshBtn.addEventListener('click', () => loadList());
el.newBtn.addEventListener('click', () => openNew());

/* ------------------------------------------------------------------ 写作 */

function setEditing(post) {
  current = post;
  el.editState.textContent = post ? '编辑中' : '新文章';
  el.viewBtn.hidden = !post || post.draft;
}

function fillForm(data) {
  category = normalizeCategory(data.category || '随笔');
  renderCats();
  if (el.fBreaks) el.fBreaks.checked = readBreaks();
  renderBreakHint();
  el.fTitle.value = data.title || '';
  el.fBody.value = data.body || '';
  el.fTags.value = joinTags(data.tags);
  el.fSummary.value = data.summary || '';
  el.fDate.value = (data.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  el.fDraft.checked = !!data.draft;
  el.fPrivate.checked = !!data.private;
  renderTagRow();
  renderCount();
  setDirty(false);
}

/**
 * 字数提示：**只做参考**，不设下限、也不标红。
 * 原来写成「12 / 20 字」并变金色，等于暗示"还不够" —— 现在去掉这个要求了，
 * 提示就该是中性信息（有些作者会想看字数）。
 */
function renderCount() {
  const n = el.fBody.value.trim().length;
  el.wordCount.textContent = n ? n + ' 字' : '';
  el.wordCount.classList.remove('is-short');
}

/** 画分类胶囊。手机上比下拉框好点：一眼看全，点一下就切 */
function renderCats() {
  el.cats.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.id === category ? ' is-on' : '');
    b.textContent = c.id;
    b.dataset.cat = c.id;
    b.setAttribute('aria-pressed', c.id === category ? 'true' : 'false');
    el.cats.appendChild(b);
  });
  el.catHint.textContent = categoryNote(category);
}

el.cats.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  category = normalizeCategory(btn.dataset.cat);
  renderCats();
  setDirty(true);
  say(el.saveMsg, '');
});

/** 有未保存改动时把悬浮保存按钮亮出来（平时界面保持安静） */
function setDirty(v) {
  dirty = v;
  document.body.classList.toggle('is-dirty', v);
  el.saveFab.hidden = !v;
}

/** 「回车即换行」的提示文案：让作者知道保存后会发生什么 */
function renderBreakHint() {
  if (!el.breakHint) return;
  el.breakHint.textContent = el.fBreaks && el.fBreaks.checked
    ? '回车即换行：单独换行会真的换行（写俳句、分行短句都靠它）'
    : '标准 Markdown：空一行才算新段落，单独换行会被合并';
}

function renderTagRow() {
  const tags = parseTags(el.fTags.value);
  el.tagRow.innerHTML = '';
  tags.forEach((t) => {
    const s = document.createElement('span');
    s.className = 'tag-pill';
    s.textContent = '#' + t;
    el.tagRow.appendChild(s);
  });
}
el.fTags.addEventListener('input', renderTagRow);
if (el.fBreaks) {
  el.fBreaks.addEventListener('change', () => {
    saveBreaks(el.fBreaks.checked);
    renderBreakHint();
    setDirty(true);
  });
}

[el.fTitle, el.fBody, el.fTags, el.fSummary, el.fDate, el.fDraft, el.fPrivate]
  .forEach((n) => n.addEventListener('input', () => {
    setDirty(true);
    say(el.saveMsg, '');
    renderCount();
  }));

/**
 * 新建。可以带参数（从日记页点「写这一天」过来的）：
 *   ?cat=日记&date=2026-08-15
 * 日记一天只写一篇 —— 那天已经有就直接打开那一篇并说明原因。
 */
async function openNew(params) {
  const cat = params ? (params.get('cat') || '') : '';
  const wantDate = params ? (params.get('date') || '') : '';
  if (cat === '日记' && wantDate) {
    const exists = posts.find(
      (p) => p.category === '日记' && String(p.date || '').slice(0, 10) === wantDate,
    );
    if (exists) {
      toast(wantDate + ' 已经写过一篇了，打开的是那一篇（一天一篇）', 7000);
      return openPost(exists);
    }
  }
  setEditing(null);
  fillForm({
    date: wantDate || new Date().toISOString().slice(0, 10),
    tags: [],
    ...(cat ? { category: cat } : {}),
  });
  say(el.saveMsg, '');
  show('edit');
  setTimeout(() => el.fTitle.focus(), 120);
}

async function openPost(p) {
  setEditing(p);
  fillForm({ ...p });
  say(el.saveMsg, '正文加载中…');
  show('edit');
  try {
    const full = await api.read(p.path || ('src/content/posts/' + p.slug + '.md'));
    fillForm(full);
    say(el.saveMsg, '');
  } catch (err) {
    /* 读不到也不能把已有内容抹掉：至少让标题/分类能改 */
    say(el.saveMsg, err.message || '正文没取到', 'error');
  }
}

async function doSave() {
  /*
   * 保存时把「单个换行」写成 Markdown 硬换行（行尾两个空格）。
   * 用户在编辑器里看到的还是他打的样子（行尾空格不可见），
   * 但线上渲染就会真的换行 —— 这就是他抱怨的「我换了行，上线后没了」。
   * 代码块里的换行不动（见 toHardBreaks）。
   */
  const useBreaks = !el.fBreaks || el.fBreaks.checked;
  const payload = {
    title: el.fTitle.value,
    body: useBreaks ? toHardBreaks(el.fBody.value) : el.fBody.value,
    category,
    tags: parseTags(el.fTags.value),
    summary: el.fSummary.value,
    date: el.fDate.value,
    draft: el.fDraft.checked,
    private: el.fPrivate.checked,
  };
  const bad = validate(payload);
  if (bad) { say(el.saveMsg, bad, 'error'); return; }

  /* 改已有文章要带 path；新建不带（文件名由服务器按标题生成） */
  if (current?.path || current?.slug) {
    payload.path = current.path || ('src/content/posts/' + current.slug + '.md');
  }

  el.saveBtn.disabled = true;
  say(el.saveMsg, '正在保存…');
  try {
    const res = await api.save(payload);
    setDirty(false);
    say(el.saveMsg, '已保存 · ' + (res.updated || ''), 'ok');
    toast('已提交，约 1 分钟上线');
    /* 保存后回到列表并刷新，用户能马上看到结果 */
    await loadList();
    const hit = posts.find((x) => x.slug === (res.path || '').split('/').pop()?.replace(/\.md$/, ''));
    if (hit) { current = hit; setEditing(hit); }
    setTimeout(() => { if (!el.screenEdit.hidden) show('list'); }, 650);
  } catch (err) {
    say(el.saveMsg, err.message || '保存失败', 'error');
  } finally {
    el.saveBtn.disabled = false;
  }
}

el.saveBtn.addEventListener('click', doSave);
el.saveFab.addEventListener('click', doSave);

el.backBtn.addEventListener('click', async () => {
  if (dirty && !(await confirmAsk('还没保存，确定离开？'))) return;
  show('list');
});

/* 电脑上用 Ctrl/Cmd+S 保存，手机上不影响 */
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!el.screenEdit.hidden) doSave();
  }
});

/* ------------------------------------------------------------------ 更多操作 */

el.moreBtn.addEventListener('click', () => { el.sheet.hidden = false; });
el.cancelSheet.addEventListener('click', () => { el.sheet.hidden = true; });
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) el.sheet.hidden = true; });

el.viewBtn.addEventListener('click', () => {
  el.sheet.hidden = true;
  const slug = current?.slug || (current?.path || '').split('/').pop()?.replace(/\.md$/, '');
  if (slug) window.open('/posts/' + slug + '/', '_blank', 'noopener');
});

el.delBtn.addEventListener('click', async () => {
  el.sheet.hidden = true;
  if (!current) { toast('这篇还没保存过，不用删'); return; }
  const path = current.path || ('src/content/posts/' + current.slug + '.md');
  if (!(await confirmAsk('删除《' + (current.title || current.slug) + '》？\n会同时从 GitHub 删掉这个文件，站点重建后就不见了。'))) return;
  try {
    await api.remove(path);
    toast('已删除');
    if (current) await loadList();
    show('list');
  } catch (err) {
    toast(err.message || '删除失败');
  }
});

/* 返回时如果键盘还开着，先收起来再切屏（否则会看到一屏半截的界面） */
window.addEventListener('pagehide', () => { /* 预留：需要时在这里补埋点 */ });

/* 给自动化探针用的就绪标记：证明监听器都已经挂上了（人工用不到，占几个字节） */
window.__READY = true;

/**
 * 支持从「文章管理页」点进来直接编辑：/admin/m/?edit=<slug>
 * 手机页本身没有列表跳转的需求，但管理页搜到文章后点一下就该到编辑界面，
 * 而不是「登录 → 再从列表里翻一遍」。
 */
async function openRequested() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('edit');
  /* 日记页跳过来时会留一句话（比如「那天已经写过一篇」），读完就清掉 */
  const note = sessionStorage.getItem('yuuu-diary-note');
  if (note) sessionStorage.removeItem('yuuu-diary-note');

  if (slug) {
    const hit = posts.find((p) => p.slug === slug);
    if (!hit) { toast('没找到这篇文章（可能刚被改名）'); return; }
    /* 清掉参数，免得刷新时又跳一次 */
    history.replaceState(null, '', location.pathname);
    await openPost(hit);
    if (note) toast(note, 7000);
    return;
  }
  if (params.get('cat') || params.get('date')) {
    history.replaceState(null, '', location.pathname);
    await openNew(params);
    return;
  }
  if (note) toast(note, 7000);
}

/* ------------------------------------------------------------------ 启动 */

(async function boot() {
  const saved = readSession();
  if (saved?.ticket) {
    ticket = saved.ticket;
    /* 先假定还有效，直接进列表；过期了接口会返回 401，再退回来 */
    show('list');
    await loadList();
    if (el.screenLogin.hidden === false) return;
    await openRequested();
  } else {
    show('login');
    el.pwd.focus();
  }
})();
