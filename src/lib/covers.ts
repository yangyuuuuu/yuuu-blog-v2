/**
 * 封面池
 * ---------------------------------------------------------------------------
 * 想加图：把图片放进 public/covers/（或 public/mascot/），然后在下面加一行。
 * 文章 frontmatter 里可以写三种值：
 *
 *   cover: stand                  → 用池子里的（推荐，改池子就能全站换风格）
 *   cover: /covers/my-photo.jpg   → 用你自己的图（public 下的绝对路径）
 *   cover: https://.../x.jpg      → 外链
 *   不写                           → 按 slug 从池子里稳定地挑一张
 *
 * 「稳定」是指：同一篇文章每次构建拿到的封面都一样，不会刷新一次换一张。
 */
export interface CoverOption {
  /** frontmatter 里写的 id */
  id: string;
  /** 实际图片路径 */
  src: string;
  /** 说明，只给人看 */
  label: string;
}

export const COVER_POOL: CoverOption[] = [
  { id: 'stand', src: '/mascot/stand.webp', label: '站立 · 精神饱满' },
  { id: 'sword', src: '/mascot/sword.webp', label: '持剑 · 装备齐全' },
  { id: 'shy', src: '/mascot/shy.webp', label: '害羞 · 捂嘴' },
  { id: 'cake', src: '/mascot/cake.webp', label: '蛋糕 · 深夜加餐' },
  { id: 'pillow', src: '/mascot/pillow.webp', label: '抱枕 · 躺平' },
  { id: 'snack', src: '/mascot/snack.webp', label: '鸡腿 · 啃点干货' },
  { id: 'cry', src: '/mascot/cry.webp', label: '哭泣 · 读到头秃' },
];

const BY_ID = new Map(COVER_POOL.map((c) => [c.id, c]));

/** FNV-1a：稳定的字符串哈希 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 没指定封面时，按 slug 从池子里稳定地挑一张 */
export function randomFromPool(slug: string): string {
  if (!COVER_POOL.length) return '';
  return COVER_POOL[hash(slug) % COVER_POOL.length].src;
}

export function resolveCover(raw: string | undefined, slug: string): string {
  const t = (raw ?? '').trim();
  if (!t) return randomFromPool(slug);
  const hit = BY_ID.get(t);
  return hit ? hit.src : t;
}

/** 池子里有没有这个 id —— 给自检用 */
export const hasCoverId = (id: string): boolean => BY_ID.has(id);
