#!/usr/bin/env node
/**
 * tools/make-icons.mjs —— 把 assets-src/ 里的参考图处理成网站素材
 *
 * 三步：
 *   1. 抠背景：从四条边泛洪填充，把「与角落同色的连通区域」变透明。
 *      ⚠️ 不能用「白色变透明」—— 角色头发也是白的，那样会打出窟窿。
 *   2. 裁边：去掉四周透明区域，让内容贴边。
 *   3. 输出：favicon 系列 PNG + 站内装饰用 WebP（体积小很多）。
 *
 * 用法： node tools/make-icons.mjs
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'assets-src');
const PUB = join(ROOT, 'public');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** 从四边泛洪填充，把与角落同色的连通区域设为透明；返回被抠掉的比例 */
function keyOut(data, w, h, tol) {
  let r = 0, g = 0, b = 0;
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  r /= 4; g /= 4; b /= 4;
  const T = tol * tol * 3;
  const near = (i) => {
    const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
    return dr * dr + dg * dg + db * db < T;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (!near(p * 4)) return;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  let removed = 0;
  while (stack.length) {
    const p = stack.pop();
    data[p * 4 + 3] = 0;
    removed++;
    const x = p % w, y = (p - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return removed / (w * h);
}

/** 非透明像素的包围盒 */
function bbox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function cutout(name, tol) {
  const file = join(SRC, name + '.jpg');
  if (!existsSync(file)) throw new Error('缺少 ' + file);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ratio = keyOut(data, info.width, info.height, tol);
  const box = bbox(data, info.width, info.height);
  if (!box) throw new Error(name + '：抠完什么都不剩，容差可能过大');
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box).png().toBuffer();
  return { png, box, ratio, srcW: info.width, srcH: info.height };
}

/** 把图放进 size×size 的透明画布，内容按 inner 缩放并居中 */
async function square(buf, size, inner) {
  const resized = await sharp(buf)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png().toBuffer();
  const m = await sharp(resized).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: resized, top: Math.round((size - m.height) / 2), left: Math.round((size - m.width) / 2) }])
    .png().toBuffer();
}

/**
 * 手工拼一个多尺寸 favicon.ico（ICO 就是「目录 + 内嵌 PNG」，浏览器都支持 PNG 版）
 * 没有它的话，浏览器自动请求 /favicon.ico 会 404。
 */
function buildIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);          // 1 = icon
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const payload = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);      // 0 表示 256
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2);                            // 调色板数
    dir.writeUInt8(0, o + 3);                            // 保留
    dir.writeUInt16LE(1, o + 4);                         // 色彩平面
    dir.writeUInt16LE(32, o + 6);                        // 位深
    dir.writeUInt32LE(e.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length;
    payload.push(e.buf);
  });
  return Buffer.concat([head, dir, ...payload]);
}

/** 减小 PNG 体积：转 8 位调色板，保留透明通道 */
const tinyPng = (buf, size, colours = 128) =>
  sharp(buf).resize(size, size).png({ palette: true, colours, effort: 10, compressionLevel: 9 }).toBuffer();

const rows = [];
function save(rel, buf) {
  const abs = join(PUB, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  rows.push([rel, statSync(abs).size]);
}

mkdirSync(join(PUB, 'mascot'), { recursive: true });

/* ---------- 1. 徽记 → favicon 与站内 logo ---------- */
console.log('');
console.log('  处理徽记 emblem …');
const emblem = await cutout('emblem', 36);
console.log('    原图 ' + emblem.srcW + '×' + emblem.srcH +
  ' → 抠掉 ' + (emblem.ratio * 100).toFixed(1) + '% 背景，内容 ' +
  emblem.box.width + '×' + emblem.box.height);

const icon512 = await square(emblem.png, 512, 440);
save('icon-512.png', await tinyPng(icon512, 512, 160));
save('icon-192.png', await tinyPng(icon512, 192, 128));
save('favicon-32.png', await tinyPng(icon512, 32, 64));

/* 多尺寸 .ico：16 / 32 / 48，浏览器和 Windows 都会自动挑合适的那张 */
save('favicon.ico', buildIco([
  { size: 16, buf: await tinyPng(icon512, 16, 48) },
  { size: 32, buf: await tinyPng(icon512, 32, 64) },
  { size: 48, buf: await tinyPng(icon512, 48, 80) },
]));

/* apple-touch-icon 不能用透明底，垫一层深蓝 */
const touchBg = await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 13, g: 27, b: 42, alpha: 1 } } })
  .composite([{ input: await sharp(icon512).resize(150, 150).png().toBuffer(), top: 15, left: 15 }])
  .png().toBuffer();
save('apple-touch-icon.png', touchBg);

/* 站内用的小尺寸 logo */
save('emblem.webp', await sharp(await square(emblem.png, 256, 226)).webp({ quality: 88, alphaQuality: 90 }).toBuffer());

/* ---------- 2. 表情包 → 站内装饰 ---------- */
/* 站内装饰用，480px 宽足够（最大显示尺寸也就 260px 左右，留 2x 余量） */
const MASCOTS = [
  ['chibi-pillow', 'pillow'],
  ['chibi-cake', 'cake'],
  ['chibi-shy', 'shy'],
  ['chibi-stand', 'stand'],
  ['chibi-sword', 'sword'],
  ['chibi-cry', 'cry'],
  ['chibi-snack', 'snack'],
];
console.log('');
console.log('  处理表情包 …');
for (const [src, out] of MASCOTS) {
  const c = await cutout(src, 32);
  const w = Math.min(480, c.box.width);
  const buf = await sharp(c.png).resize(w, null, { fit: 'inside' }).webp({ quality: 78, alphaQuality: 85, effort: 6 }).toBuffer();
  save('mascot/' + out + '.webp', buf);
  console.log('    ' + src.padEnd(14) + ' → mascot/' + (out + '.webp').padEnd(22) +
    Math.round(c.box.width) + '×' + Math.round(c.box.height) + ' → ' + Math.round(w) + 'px宽');
}

/* ---------- 报告 ---------- */
console.log('');
console.log('  ' + '-'.repeat(52));
let total = 0;
for (const [rel, size] of rows) {
  total += size;
  console.log('  ' + rel.padEnd(30) + (size / 1024).toFixed(1).padStart(8) + ' KB');
}
console.log('  ' + '-'.repeat(52));
console.log('  合计 ' + rows.length + ' 个文件，' + (total / 1024).toFixed(1) + ' KB');
console.log('');
