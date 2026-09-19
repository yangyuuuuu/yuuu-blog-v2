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
