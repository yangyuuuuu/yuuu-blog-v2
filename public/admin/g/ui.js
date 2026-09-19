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
  banner: $('banner'), bannerText: $('bannerText'), bannerAction: $('bannerAction'),
  renameSheet: $('renameSheet'), renameInput: $('renameInput'), renameHint: $('renameHint'),
  renameRefs: $('renameRefs'), renameCancel: $('renameCancel'), renameOk: $('renameOk'),
  lightbox: $('lightbox'), lightboxImg: $('lightboxImg'), lightboxInfo: $('lightboxInfo'),
  lightboxRaw: $('lightboxRaw'), lightboxClose: $('lightboxClose'),
  refreshBtn: $('refreshBtn'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  selectBtn: $('selectBtn'), batchbar: $('batchbar'), batchCount: $('batchCount'),
  selectAllBtn: $('selectAllBtn'), clearSelBtn: $('clearSelBtn'),
  batchMoveBtn: $('batchMoveBtn'), batchDelBtn: $('batchDelBtn'), batchDoneBtn: $('batchDoneBtn'),
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

/*
 * 刚上传的图：**站点还没构建完**（Cloudflare 要 1 分钟左右），
 * 这时缩略图地址 /uploads/... 还是 404，卡片就是一块空白 ——
 * 用户会以为"没传上去"。所以上传成功后先用**手机里的原文件**（blob URL）当缩略图，
 * 看得见、也能确认传的是哪张；等站点构建好了再把远程地址换回来。
 */
const pendingThumbs = new Map();   /* path -> blobURL */
function clearStaleThumbs(maxAgeMs = 3 * 60 * 1000) {
  const now = Date.now();
  for (const [path, v] of pendingThumbs) {
    if (now - v.at > maxAgeMs) { URL.revokeObjectURL(v.url); pendingThumbs.delete(path); }
  }
}

/** 批量选择状态：mode 打开后卡片右上角出现勾选框 */
const batch = { mode: false, paths: new Set() };
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

/** 顶部横幅：把错误原因留在屏幕上（toast 会消失，横幅不会） */
function showBanner(text, actionLabel, onAction) {
  if (!el.banner) return;
  el.bannerText.textContent = text;
  if (actionLabel) {
    el.bannerAction.textContent = actionLabel;
    el.bannerAction.hidden = false;
    el.bannerAction.onclick = onAction;
  } else {
    el.bannerAction.hidden = true;
    el.bannerAction.onclick = null;
  }
  el.banner.hidden = false;
}
function hideBanner() {
  if (!el.banner) return;
  el.banner.hidden = true;
  el.bannerAction.hidden = true;
  el.bannerAction.onclick = null;
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
    hideBanner();
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
    im.alt = img.name;
    im.loading = 'lazy';
    const local = pendingThumbs.get(img.path);
    im.src = local ? local.url : img.url;
    /*
     * 远程地址取不到（多半是刚上传、站点还没构建完）时，
     * 给一个说得清楚的占位，而不是一片空白。
     */
    im.addEventListener('error', () => {
      if (local) return;   /* 本地缩略图也失败就算了 */
      card.classList.add('is-missing');
      tag.textContent = dirLabel(img.dir) + ' · 还没构建好';
    });
    const tag = document.createElement('span');
    tag.className = 'card-tag';
    tag.textContent = dirLabel(img.dir);
    /* 勾选框只在选择模式下显示（CSS 控制），始终渲染是为了切换时不闪 */
    const check = document.createElement('span');
    check.className = 'card-check';
    check.textContent = batch.paths.has(img.path) ? '✓' : '';
    card.classList.toggle('is-on', batch.paths.has(img.path));
    card.append(im, tag, check);
    card.addEventListener('click', () => {
      if (batch.mode) toggleSelect(img.path);
      else openSheet(img);
    });
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

/* ------------------------------------------------------------------ 批量选择 */

function toggleSelect(path) {
  if (batch.paths.has(path)) batch.paths.delete(path);
  else batch.paths.add(path);
  renderGrid();
  renderBatchBar();
}

function renderBatchBar() {
  el.batchCount.textContent = String(batch.paths.size);
  el.batchMoveBtn.disabled = batch.paths.size === 0;
  el.batchDelBtn.disabled = batch.paths.size === 0;
  el.batchbar.hidden = !batch.mode;
}

function setBatchMode(on) {
  batch.mode = on;
  document.body.classList.toggle('is-batch', on);
  if (!on) batch.paths.clear();
  el.pickBtn.hidden = on;
  renderGrid();
  renderBatchBar();
}

el.selectBtn.addEventListener('click', () => setBatchMode(!batch.mode));
el.batchDoneBtn.addEventListener('click', () => setBatchMode(false));
el.selectAllBtn.addEventListener('click', () => {
  for (const img of filterImages(images, { dir: currentDir, keyword })) batch.paths.add(img.path);
  renderGrid();
  renderBatchBar();
});
el.clearSelBtn.addEventListener('click', () => {
  batch.paths.clear();
  renderGrid();
  renderBatchBar();
});

el.batchMoveBtn.addEventListener('click', () => {
  const paths = [...batch.paths];
  if (!paths.length) return;
  pickDir((dir) => runBatch({ action: 'move', paths, dir }, '归类'));
});

el.batchDelBtn.addEventListener('click', async () => {
  const paths = [...batch.paths];
  if (!paths.length) return;
  if (!confirm('删除选中的 ' + paths.length + ' 张图？\n会从 GitHub 删掉这些文件，用到它们的文章会变成破图。')) return;
  await runBatch({ action: 'delete', paths }, '删除');
});

/** 批量请求：一次提交处理多张（Worker 走 Git tree 接口） */
async function runBatch(payload, label) {
  toast('正在' + label + ' ' + payload.paths.length + ' 张…', 20000);
  try {
    const res = await post('/admin/images/batch', payload);
    toast(label + '完成：' + (res.count || 0) + ' 张' + (res.note ? '（' + res.note + '）' : ''));
    setBatchMode(false);
    await load();
  } catch (err) {
    /*
     * 失败也要**把原因说清楚、并且刷新列表** ——
     * 之前只丢一句 toast，用户看到"会发生错误"却不知道错在哪，
     * 而且界面还停在操作前的样子，会以为图片丢了。
     */
    showBanner(label + '失败：' + err.message, '刷新列表', () => { hideBanner(); load(); });
    toast(label + '失败：' + err.message, 8000);
    await load();
  }
}

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
  el.sheetBody.appendChild(sheetButton('看原图（大图）', () => {
    el.sheet.hidden = true;
    openLightbox(img);
  }));

  /* 重命名：图库里那些哈希名（0b91ecca….jpg）终于能改成看得懂的名字 */
  el.sheetBody.appendChild(sheetButton('重命名…', () => {
    el.sheet.hidden = true;
    openRename(img);
  }));
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

/* ------------------------------------------------------------------ 看原图（灯箱） */

/**
 * 看原图。
 * 图库卡片里的缩略图只有几百像素，看不清细节 —— 这里铺满屏幕看**原图**。
 * 用站点地址（同一张图，浏览器已经缓存过，不会重复下载）。
 */
function openLightbox(img) {
  el.lightboxImg.src = img.url;
  el.lightboxImg.alt = img.name;
  el.lightboxInfo.textContent = dirLabel(img.dir) + ' · ' + img.name + ' · ' + humanSize(img.size);
  el.lightbox.hidden = false;
}
function closeLightbox() {
  el.lightbox.hidden = true;
  el.lightboxImg.removeAttribute('src');   /* 停掉加载，省流量 */
}
el.lightboxClose.addEventListener('click', closeLightbox);
el.lightbox.addEventListener('click', (e) => { if (e.target === el.lightbox) closeLightbox(); });
el.lightboxRaw.addEventListener('click', () => {
  if (el.lightboxImg.src) window.open(el.lightboxImg.src, '_blank', 'noopener');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.lightbox.hidden) closeLightbox();
  if (!el.renameSheet.hidden) el.renameSheet.hidden = true;
  if (!el.sheet.hidden) el.sheet.hidden = true;
});

/* ------------------------------------------------------------------ 重命名 */

let renameTarget = null;

/**
 * 重命名对话框。
 * 只让用户改**主名**，后缀强制沿用原来的（避免把 .jpg 改成 .png 之后浏览器按错类型解析）。
 * 默认勾选「同时更新文章里的引用」—— 否则已经引用了这张图的文章会立刻变破图。
 */
function openRename(img) {
  renameTarget = img;
  const stem = img.name.replace(/\.[a-z0-9]+$/i, '');
  const ext = (img.name.match(/\.[a-z0-9]+$/i) || [''])[0];
  el.renameHint.textContent = '当前：' + img.name + '（后缀 ' + ext + ' 保持不变）';
  el.renameInput.value = stem;
  el.renameRefs.checked = true;
  el.renameSheet.hidden = false;
  /* 手机上自动聚焦 + 选中，改起来快 */
  setTimeout(() => { el.renameInput.focus(); el.renameInput.select(); }, 50);
}

async function doRename() {
  if (!renameTarget) return;
  const name = el.renameInput.value.trim();
  if (!name) { toast('新文件名不能为空', 3000); return; }
  el.renameOk.disabled = true;
  try {
    const res = await post('/admin/image/rename', {
      path: renameTarget.path,
      name,
      updateRefs: el.renameRefs.checked,
    });
    el.renameSheet.hidden = true;
    const refs = res && res.refsUpdated ? '，同时更新了 ' + res.refsUpdated + ' 篇文章的引用' : '';
    toast('已改名为 ' + (res && res.name ? res.name : name) + refs, 5000);
    await load();
  } catch (err) {
    showBanner('改名失败：' + err.message, '关闭', hideBanner);
    toast(err.message, 6000);
  } finally {
    el.renameOk.disabled = false;
  }
}

el.renameOk.addEventListener('click', doRename);
el.renameCancel.addEventListener('click', () => { el.renameSheet.hidden = true; });
el.renameSheet.addEventListener('click', (e) => { if (e.target === el.renameSheet) el.renameSheet.hidden = true; });
el.renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRename(); } });

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
    showBanner('改分类失败：' + err.message, '刷新列表', () => { hideBanner(); load(); });
    toast(err.message, 6000);
    await load();
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
      const res = await post('/admin/image/upload', { ...payload, dir });
      done.push(res);
      /*
       * 存下本地缩略图：站点要等 Cloudflare 构建（约 1 分钟）才有这张图，
       * 这期间用手机里的原文件显示，用户能立刻看到自己传的是哪张。
       */
      if (res && res.path && files[i]) {
        try { pendingThumbs.set(res.path, { url: URL.createObjectURL(files[i]), at: Date.now() }); } catch { /* 忽略 */ }
      }
    } catch (err) {
      toast('第 ' + (i + 1) + ' 张失败：' + err.message, 6000);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (done.length) {
    /* 说清楚"现在看到的是本机预览，站点约 1 分钟后才有" */
    toast('上传完成 ' + done.length + ' 张 → ' + dirLabel(dir) + '（缩略图是本机预览，站点约 1 分钟后生效）', 5000);
  } else {
    toast('没有图片上传成功', 3000);
  }
  await load();

  /*
   * 站点构建好之后自动换回远程地址，并顺手把过期 blob 清掉。
   * 60 秒是个经验值（Cloudflare Pages 一般 40~60 秒）。
   */
  if (done.length) {
    setTimeout(() => {
      clearStaleThumbs(0);      /* 立刻清掉，强制用远程地址 */
      load();
    }, 70000);
  }
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
