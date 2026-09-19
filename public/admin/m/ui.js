/**
 * 手机写作页的控制器：把 DOM 事件接到 app.js 的规则和 Worker 的接口上。
 *
 * 分工：本文件只管「界面上发生什么」，规则在 app.js（可被测试直接 import），
 * 写仓库在 Worker（token 只在服务端）。
 */
import {
  createApi, parseTags, joinTags, initialOf, describe, relativeDay, validate,
  CATEGORIES, categoryNote, normalizeCategory,
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
  fDraft: $('fDraft'), fPrivate: $('fPrivate'), tagRow: $('tagRow'),
  saveBtn: $('saveBtn'), saveMsg: $('saveMsg'), saveFab: $('saveFab'), wordCount: $('wordCount'),
  sheet: $('sheet'), viewBtn: $('viewBtn'), delBtn: $('delBtn'), cancelSheet: $('cancelSheet'),
  toast: $('toast'),
  cats: $('cats'), catHint: $('catHint'),
};

/** 当前选中的分类（默认随笔，和站点一贯的默认一致） */
let category = '随笔';

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

/** 字数提示：让作者知道离 20 字底线还有多远（规则与站点自检一致） */
function renderCount() {
  const n = el.fBody.value.trim().length;
  const short = n < 20;
  el.wordCount.textContent = short ? n + ' / 20 字' : n + ' 字';
  el.wordCount.classList.toggle('is-short', short);
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
[el.fTitle, el.fBody, el.fTags, el.fSummary, el.fDate, el.fDraft, el.fPrivate]
  .forEach((n) => n.addEventListener('input', () => {
    setDirty(true);
    say(el.saveMsg, '');
    renderCount();
  }));

async function openNew() {
  setEditing(null);
  fillForm({ date: new Date().toISOString().slice(0, 10), tags: [] });
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
  const payload = {
    title: el.fTitle.value,
    body: el.fBody.value,
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

/* ------------------------------------------------------------------ 启动 */

(async function boot() {
  const saved = readSession();
  if (saved?.ticket) {
    ticket = saved.ticket;
    /* 先假定还有效，直接进列表；过期了接口会返回 401，再退回来 */
    show('list');
    await loadList();
    if (el.screenLogin.hidden === false) return;
  } else {
    show('login');
    el.pwd.focus();
  }
})();
