/**
 * 手机写作页的逻辑（/admin/m/）。
 *
 * 为什么单独一个文件、为什么不引任何框架：
 *   1. 这一页是**专门给手机**做的，UI 全在自己手里 —— 不用再跟第三方后台的桌面布局打架。
 *   2. 逻辑抽出来是为了能被 tools/check-mobile-app.mjs 直接 import 着测：
 *      「正文太短不让存」「保存时带上 path 就是更新、不带就是新建」这类规则
 *      写在 UI 事件处理里就没法测了。
 *   3. 零依赖：手机网络不稳，少一个请求少一个挂掉的点（首屏也只有几 KB）。
 *
 * 与 Worker 的分工：本文件只负责「收集用户输入 + 调接口 + 显示结果」；
 * 真正写 GitHub 的是 Worker（token 只在服务端），口令也是 Worker 校验。
 */

/** 站点的写作底线，和 tools/verify.mjs 保持一致（标点也算字） */
export const MIN_BODY = 20;

/**
 * 分类。必须和 public/admin/config.yml 的 options 一致 ——
 * 那边是给 Decap 后台用的，这里是手机页用的；改一处记得改两处。
 * 每条带一句说明，手机上选的时候能明白后果（尤其是「日记」会隐藏）。
 */
export const CATEGORIES = [
  { id: '随笔', note: '想到什么写什么' },
  { id: '安利', note: '看完电影 / 番剧 / 书，想推荐或吐槽' },
  { id: '技术', note: '折腾记录、踩坑' },
  { id: '日记', note: '会被隐藏：不进首页 / 搜索 / RSS' },
];

/** 分类的说明文字（给手机页显示） */
export const categoryNote = (id) => (CATEGORIES.find((c) => c.id === id) || {}).note || '';

/** 分类是否合法；不认识的一律退回「随笔」（后台改过分类名时也不会存成空值） */
export const normalizeCategory = (id) =>
  CATEGORIES.some((c) => c.id === id) ? id : '随笔';

/** 保存前的本地校验。返回 null 表示可以提交，否则返回给用户看的错误文案。 */
export function validate({ title, body }) {
  if (!String(title || '').trim()) return '标题还没写';
  const text = String(body || '');
  if (text.trim().length < MIN_BODY) {
    return '正文太短了（至少 ' + MIN_BODY + ' 个字，标点也算）—— 站点自检会拦下它';
  }
  return null;
}

/** 标签：手机上是逗号/空格分隔的一行文字，转成数组（去空、去重、限长） */
export function parseTags(raw) {
  const out = [];
  for (const piece of String(raw || '').split(/[,，、\s]+/)) {
    const t = piece.trim();
    if (t && !out.includes(t) && t.length <= 20) out.push(t);
  }
  return out.slice(0, 8);
}

/** 标签数组 → 显示用的一行 */
export const joinTags = (tags) => (Array.isArray(tags) ? tags.join(', ') : '');

/** 标题首字符，用于列表左侧的小圆标 */
export const initialOf = (s) => {
  const t = String(s || '').trim();
  return t ? Array.from(t)[0] : '·';
};

/** 列表项要显示的信息（日期 / 分类 / 状态），做成纯函数好测 */
export function describe(post) {
  const bits = [];
  if (post.date) bits.push(String(post.date).slice(0, 10));
  if (post.category) bits.push(post.category);
  if (post.draft) bits.push('草稿');
  if (post.hidden) bits.push('隐藏');
  return bits.join(' · ');
}

/** 相对时间，比裸日期好读 */
export function relativeDay(dateStr, today = new Date()) {
  const d = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(d + 'T00:00:00');
  const days = Math.round((t - target) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days > 1 && days < 30) return days + ' 天前';
  if (days < 0) return d;
  return d;
}

/** 调 Worker 的薄封装：统一带上 ticket、统一把错误抛成人话 */
export function createApi(base, getTicket) {
  async function post(path, payload) {
    const res = await fetch(base.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(payload || {}), ticket: getTicket() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      /*
       * 403 是最容易让人摸不着头脑的一种：能读到文章（说明 token 是好的），
       * 但保存时报 "Resource not accessible by personal access token"。
       * 原因是 GitHub 对「读」和「写」分开校验 —— 把话说明白，别让用户干瞪眼。
       */
      if (res.status === 403 || /not accessible by personal access token/i.test(data.message || '')) {
        throw new Error(
          '服务端的 GitHub token 没有写权限。到 GitHub 重新建一个 classic token（勾 repo），' +
          '然后 cd workers/oauth 执行：npm run put-token && npm run deploy',
        );
      }
      throw new Error(data.message || ('请求失败（HTTP ' + res.status + '）'));
    }
    return data;
  }
  return {
    /** 口令 → ticket + 文章清单 */
    async login(password) {
      const origin = location.origin;
      const res = await fetch(base.replace(/\/+$/, '') + '/hidden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, from: 'mobile-editor', want: 'all', site: origin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error(data.message || '试得太频繁了，等 15 分钟再来');
      if (!res.ok) throw new Error(data.message || '口令不对');
      return data; // { ticket, posts, now }
    },
    list: () => post('/admin/posts', {}),
    read: (path) => post('/admin/file', { path }),
    save: (payload) => post('/admin/save', payload),
    remove: (path) => post('/admin/delete', { path }),
  };
}
