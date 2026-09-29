/**
 * 图库的逻辑（/admin/g/）。
 *
 * 只放**能被 node 直接测**的纯函数：分类整理、搜索过滤、文件名与体积处理。
 * DOM 相关的一律留在 ui.js。
 *
 * 关于分类：分类 = public/uploads 下的**子目录名**。
 * 这样 Decap 自带的媒体库也能按文件夹浏览，Markdown 里的路径也自带分类
 * （/uploads/表情包/xxx.jpg）。根目录下的老图算「未分类」，不用迁移。
 */

/** 展示「未分类」用的名字（dir 为空字符串时） */
export const UNCATEGORIZED = '未分类';

/** 内部 dir（'' = 未分类）→ 界面上显示的名字 */
export const dirLabel = (dir) => (dir ? dir : UNCATEGORIZED);

/** 界面上的名字 → 内部 dir（「未分类」= 根目录） */
export const dirValue = (label) => (label === UNCATEGORIZED ? '' : String(label || '').trim());

/** 按分类分组，未分类排最前，其余按名字排序 */
export function groupByDir(images) {
  const map = new Map();
  for (const img of images) {
    const key = img.dir || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(img);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([dir, list]) => ({ dir, label: dirLabel(dir), images: list }));
}

/** 分类清单（含每类数量 + 未分类排最前），用于顶部筛选 */
export function categories(images) {
  const groups = groupByDir(images);
  return [
    { dir: '__all__', label: '全部', count: images.length },
    ...groups.map((g) => ({ dir: g.dir, label: g.label, count: g.images.length })),
  ];
}

/** 关键词过滤：匹配文件名、分类名、路径 */
export function filterImages(images, { dir = '__all__', keyword = '' } = {}) {
  const k = String(keyword || '').trim().toLowerCase();
  return images.filter((img) => {
    if (dir !== '__all__' && (img.dir || '') !== dir) return false;
    if (!k) return true;
    return [img.name, img.dir, img.path].some((v) => String(v || '').toLowerCase().includes(k));
  });
}

/** 人类可读的体积 */
export function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 上传前把图压一下：手机上随手拍的照片动辄 5MB，
 * 直接塞进 git 仓库既慢又把仓库撑大。压到最长边 MAX_EDGE、质量 0.85 的 JPEG。
 * 返回 { dataUrl, name, bytes }；canvas 不可用（老浏览器）时原样返回。
 */
export const MAX_EDGE = 1600;

export function toJpegName(name) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
  return base + '.jpg';
}

/** 估算 dataURL 的字节数（base64 → 二进制） */
export function dataUrlBytes(dataUrl) {
  const m = /^data:[^;]+;base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return 0;
  const b64 = m[1].replace(/=+$/, '');
  return Math.floor((b64.length * 3) / 4);
}

/** 要不要压：小图、gif、svg 都不动（gif 压了就没了动画） */
export function shouldCompress({ type, size }) {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(String(type || ''))) return false;
  return Number(size) > 400 * 1024;
}

/* ---------------------------------------------------------------- 缩略图 */

/**
 * 缩略图参数 —— ⚠️ 必须和 tools/make-thumbs.mjs 里那两个常量一模一样
 * （WIDTH = 720 / QUALITY = 0.68）。两边不一致的话，手动跑的和上传时生成的
 * 会呈现两种画质，用户一眼就看出来。
 */
export const THUMB_WIDTH = 720;
export const THUMB_QUALITY = 0.68;

/**
 * 一张图**要不要再单独出一个缩略图**。
 *
 *   · gif / svg / avif 不做：gif 压成 jpg 就没了动画，svg 是矢量（本来就小）
 *   · 比 720 还小的图不做：缩略图反而更大、还更糊（站点那边找不到缩略图会退回原图）
 *   · 小文件（< 400KB）不做：这就是 shouldCompress 那条线，和上传时压不压保持一致
 *     —— 主图既然原样上传，再配一张更糊的缩略图没有意义
 */
export function shouldMakeThumb({ type, size, width }) {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(String(type || ''))) return false;
  if (Number(size) <= 400 * 1024) return false;
  return Number(width) > THUMB_WIDTH;
}

/**
 * 顺手生成一张缩略图（上传时一起传，服务端写进 public/uploads/thumbs/）。
 *
 * 为什么在浏览器里做：和 tools/make-thumbs.mjs 同一个理由 —— 不引新依赖。
 * Cloudflare Pages 没有按需缩放，缩略图只能提前做好。
 *
 * 返回 JPEG 的 dataURL；不需要（或这个浏览器画不出来）时返回 null ——
 * 缩略图是**锦上添花**，没有它上传照样要成功（老图、gif 就一直是原图直出）。
 */
export function makeThumbDataUrl(img) {
  try {
    const c = document.createElement('canvas');
    c.width = THUMB_WIDTH;
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * THUMB_WIDTH / (img.naturalWidth || img.width)));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch {
    return null;
  }
}
