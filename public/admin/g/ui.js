/**
 * 图库的控制器（/admin/g/）。
 *
 * 和写作页一样的分工：规则在 gallery.js（可测），界面在这里，
 * 写仓库由 Worker 代劳（GitHub token 只在服务端）。
 */
import {
  groupByDir, categories, filterImages, humanSize, dirLabel, dirValue,
  toJpegName, dataUrlBytes, shouldCompress, MAX_EDGE, UNCATEGORIZED,
} from './gallery.js';

const API = 'https://oauth.yuuu.love';
/* 和写作页共用同一个 key：在这儿登录过，去 /admin/m/ 就不用再输口令 */
const SESSION_KEY = 'yuuu-mobile-editor';

const $ = (id) => document.getElementById(id);
const el = {
  screenLogin: $('screenLogin'), screenGallery: $('screenGallery'),
  loginForm: $('loginForm'), pwd: $('pwd'), loginBtn: $('loginBtn'), loginMsg: $('loginMsg'),
  cats: $('cats'), search: $('search'), grid: $('grid'), empty: $('empty'), count: $('count'),
  refreshBtn: $('refreshBtn'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  sheet: $('sheet'), sheetThumb: $('sheetThumb'), sheetName: $('sheetName'),
  sheetInfo: $('sheetInfo'), sheetBody: $('sheetBody'),
  dirSheet: $('dirSheet'), dirChoices: $('dirChoices'), newDir: $('newDir'), useNewDir: $('useNewDir'), cancelDir: $('cancelDir'),
  toast: $('toast'),
};

let ticket = '';
let images = [];
let currentDir = '__all__';
let keyword = '';
let picked = [];   /* 正在上传的文件 */
let toastTimer = 0;

/* ------------------------------------------------------------------ 小工具 */

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

function show(which) {
  el.screenLogin.hidden = which !== 'login';
  el.screenGallery.hidden = which !== 'gallery';
  window.scrollTo(0, 0);
}

function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ticket, at: Date.now() })); } catch { /* 忽略 */ }
}
const readSession = () => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};

/** 调 Worker：统一带 ticket、统一把错误抛成人话 */
async function post(path, payload) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(payload || {}), ticket }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('服务端的 GitHub token 没有写权限（到 GitHub 建个 classic token 勾 repo，然后 npm run put-token && npm run deploy）');
    }
    throw new Error(data.message || ('请求失败（HTTP ' + res.status + '）'));
  }
  return data;
}

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
      body: JSON.stringify({ password, from: 'gallery', want: 'all', site: location.origin }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(data.message || '试得太频繁了，等 15 分钟再来');
    if (!res.ok) throw new Error(data.message || '口令不对');
    ticket = data.ticket || '';
    saveSession();
    el.pwd.value = '';
    say(el.loginMsg, '');
    show('gallery');
    await load();
  } catch (err) {
    say(el.loginMsg, err.message || '校验失败', 'error');
    el.pwd.select();
  } finally {
    el.loginBtn.disabled = false;
  }
});

/* ------------------------------------------------------------------ 列表 */

async function load() {
  if (!ticket) { show('login'); return; }
  el.count.textContent = '加载中…';
  try {
    const data = await post('/admin/images', {});
    images = data.images || [];
    renderCats();
    renderGrid();
  } catch (err) {
    el.count.textContent = '';
    if (/过期/.test(err.message)) { ticket = ''; show('login'); say(el.loginMsg, err.message, 'error'); return; }
    toast(err.message || '加载失败', 4000);
  }
}

function renderCats() {
  const list = categories(images);
  /* 当前选中的分类如果没了（图都被删了），退回「全部」 */
  if (!list.some((c) => c.dir === currentDir)) currentDir = '__all__';
  el.cats.innerHTML = '';
  list.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.dir === currentDir ? ' is-on' : '');
    b.dataset.dir = c.dir;
    b.textContent = c.label + ' ' + c.count;
    b.setAttribute('role', 'tab');
    el.cats.appendChild(b);
  });
}

function renderGrid() {
  const list = filterImages(images, { dir: currentDir, keyword });
  el.count.textContent = list.length === images.length
    ? images.length + ' 张'
    : list.length + ' / ' + images.length + ' 张';
  el.empty.hidden = list.length !== 0;
  el.empty.textContent = images.length === 0 ? '还没有图片，点右下角 ＋ 上传' : '没有匹配的图片';
  el.grid.innerHTML = '';
  list.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = (i < 12 ? i * 18 : 0) + 'ms';
    const im = document.createElement('img');
    im.src = img.url;
    im.alt = img.name;
    im.loading = 'lazy';
    const tag = document.createElement('span');
    tag.className = 'card-tag';
    tag.textContent = dirLabel(img.dir);
    card.append(im, tag);
    card.addEventListener('click', () => openSheet(img));
    el.grid.appendChild(card);
  });
}

el.cats.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  currentDir = b.dataset.dir;
  renderCats();
  renderGrid();
});
el.search.addEventListener('input', () => { keyword = el.search.value; renderGrid(); });
el.refreshBtn.addEventListener('click', () => load());

/* ------------------------------------------------------------------ 图片操作面板 */

let sheetImage = null;

function sheetButton(text, onClick, kind) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sheet-item' + (kind ? ' sheet-item--' + kind : '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function openSheet(img) {
  sheetImage = img;
  el.sheetThumb.src = img.url;
  el.sheetName.textContent = img.name;
  el.sheetInfo.textContent = dirLabel(img.dir) + ' · ' + humanSize(img.size);
  el.sheetBody.innerHTML = '';

  const pathBox = document.createElement('div');
  pathBox.className = 'path-box';
  pathBox.textContent = decodeURIComponent(img.url);
  el.sheetBody.appendChild(pathBox);

  /* 复制路径 —— 写文章时要往 Markdown 里贴的就是这个 */
  el.sheetBody.appendChild(sheetButton('复制图片路径', async () => {
    try {
      await navigator.clipboard.writeText(decodeURIComponent(img.url));
      toast('已复制：' + decodeURIComponent(img.url));
    } catch {
      /* 手机上非 https 或没权限时会失败，退回到手选 */
      const ta = document.createElement('textarea');
      ta.value = decodeURIComponent(img.url);
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制'); } catch { toast('复制失败，手动选一下上面那行'); }
      ta.remove();
    }
    el.sheet.hidden = true;
  }));

  el.sheetBody.appendChild(sheetButton('换分类…', () => {
    el.sheet.hidden = true;
    pickDir((dir) => changeDir(img, dir));
  }));
  el.sheetBody.appendChild(sheetButton('看原图', () => { window.open(img.url, '_blank', 'noopener'); }));
  el.sheetBody.appendChild(sheetButton('删除这张图', async () => {
    el.sheet.hidden = true;
    if (!confirm('删除《' + img.name + '》？\n会从 GitHub 删掉这个文件，用到它的文章会变成破图。')) return;
    try {
      await post('/admin/image/delete', { path: img.path });
      toast('已删除');
      await load();
    } catch (err) { toast(err.message, 4000); }
  }, 'danger'));

  el.sheetBody.appendChild(sheetButton('取消', () => { el.sheet.hidden = true; }));
  el.sheet.hidden = false;
}

el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) el.sheet.hidden = true; });

/* ------------------------------------------------------------------ 改分类 */

/**
 * 打开「选分类」面板，选完调用 onPick(dir)。
 * 两种场景共用：给已有图片换分类、给刚选好的一批新图定分类。
 * 一开始我让它们各自写一遍逻辑，结果上传那条路走错了分支（把空数组当批次去归类），
 * 现在统一成一个回调，谁用谁传。
 */
function pickDir(onPick) {
  const list = categories(images).filter((c) => c.dir !== '__all__');
  const labels = list.map((c) => c.label);
  if (!labels.includes(UNCATEGORIZED)) labels.unshift(UNCATEGORIZED);

  el.dirChoices.innerHTML = '';
  labels.forEach((label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', () => { el.dirSheet.hidden = true; onPick(dirValue(label)); });
    el.dirChoices.appendChild(b);
  });
  el.newDir.value = '';
  el.dirSheet.hidden = false;
  el.dirSheet._onPick = onPick;
}

el.useNewDir.addEventListener('click', () => {
  const name = el.newDir.value.trim().replace(/[\\/:*?"<>|]/g, '');
  if (!name) { toast('先给新分类起个名字'); return; }
  const cb = el.dirSheet._onPick;
  el.dirSheet.hidden = true;
  if (cb) cb(name);
});
el.cancelDir.addEventListener('click', () => { el.dirSheet.hidden = true; });
el.dirSheet.addEventListener('click', (e) => { if (e.target === el.dirSheet) el.dirSheet.hidden = true; });

/** 给已有图片换分类 */
async function changeDir(img, dir) {
  try {
    await post('/admin/image/move', { path: img.path, dir });
    toast('已移到「' + dirLabel(dir) + '」');
    await load();
  } catch (err) {
    toast(err.message, 4000);
  }
}

/* ------------------------------------------------------------------ 上传 */

el.pickBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', () => {
  const files = [...el.fileInput.files];
  el.fileInput.value = '';
  if (!files.length) return;
  pickDir((dir) => uploadAll(files, dir));
});

/** 逐张上传（带进度提示）。分类在上传时就带上，不用再补一次归类 */
async function uploadAll(files, dir) {
  const done = [];
  for (let i = 0; i < files.length; i++) {
    toast('上传中 ' + (i + 1) + '/' + files.length + '…', 15000);
    try {
      const payload = await prepare(files[i]);
      done.push(await post('/admin/image/upload', { ...payload, dir }));
    } catch (err) {
      toast('第 ' + (i + 1) + ' 张失败：' + err.message, 6000);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  toast(done.length ? '上传完成 ' + done.length + ' 张 → ' + dirLabel(dir) : '没有图片上传成功', 3000);
  await load();
}

/** 读取文件 → （必要时）压缩 → dataURL */
async function prepare(file) {
  const raw = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });

  if (!shouldCompress({ type: file.type, size: file.size })) {
    return { name: file.name, dataUrl: raw };
  }
  /* 压到最长边 MAX_EDGE，明显能省一半以上体积 */
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('这张图打不开'));
    i.src = raw;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  if (scale >= 1) return { name: file.name, dataUrl: raw };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { name: toJpegName(file.name), dataUrl };
}

/* ------------------------------------------------------------------ 启动 */

(async function boot() {
  const saved = readSession();
  if (saved?.ticket) {
    ticket = saved.ticket;
    show('gallery');
    await load();
  } else {
    show('login');
    el.pwd.focus();
  }
})();
