/** 站点级常量：改这里就能改全站标题、描述与统计开关 */

export const SITE_TITLE = 'yuuu';
export const SITE_TAGLINE = 'FONTAINE';
export const SITE_DESC = '在枫丹的午后，写下一页页温柔。日记、随笔与技术分享。';
export const AUTHOR = 'yuuu';

/**
 * Cloudflare Web Analytics 的 Beacon Token。
 * 留空则完全不加任何第三方脚本；填上之后才会异步加载那一个统计脚本。
 * 获取方式：Cloudflare Dashboard → Web Analytics → 添加站点 → 复制 JS snippet 里的 token。
 */
export const CF_BEACON_TOKEN = '';
