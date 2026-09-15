#!/usr/bin/env node
/**
 * 生成 public/og-default.png（1200×630）
 * 纯 Node 实现：手写 PNG 编码 + 扫描线多边形填充，不依赖任何图像库、不派生子进程。
 * 用法：node tools/make-og.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'public', 'og-default.png');

const W = 1200;
const H = 630;
const px = new Uint8Array(W * H * 4);

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function blend(x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const ia = a > 1 ? 1 : a;
  px[i] = px[i] * (1 - ia) + r * ia;
  px[i + 1] = px[i + 1] * (1 - ia) + g * ia;
  px[i + 2] = px[i + 2] * (1 - ia) + b * ia;
  px[i + 3] = 255;
}

/* 1. 竖直渐变背景 */
const top = hex('#0D1B2A');
const bottom = hex('#183553');
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const c = top.map((v, i) => v + (bottom[i] - v) * t);
  for (let x = 0; x < W; x++) blend(x, y, c, 1);
}

/* 2. 中心光晕 */
const glow = hex('#7EC8E3');
const gx = 600, gy = 250, gr = 520;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - gx, y - gy) / gr;
    if (d < 1) blend(x, y, glow, (1 - d) * (1 - d) * 0.26);
  }
}

/* 3. 气泡 */
const bubbles = [
  [130, 470, 26], [240, 150, 14], [1010, 180, 20], [1090, 420, 12],
  [900, 520, 9], [180, 300, 8], [760, 110, 10],
];
for (const [cx, cy, r] of bubbles) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const edge = Math.min(1, (r - d) / 1.6);
      const hi = Math.max(0, 1 - Math.hypot(x - (cx - r * 0.34), y - (cy - r * 0.34)) / (r * 0.8));
      blend(x, y, hex('#F5FAFF'), edge * (0.1 + hi * 0.5));
    }
  }
}

/* 4. 底部海浪 */
for (let x = 0; x < W; x++) {
  const y1 = H - 96 + Math.sin(x / 190) * 20;
  const y2 = H - 56 + Math.sin(x / 150 + 1.4) * 16;
  for (let y = Math.floor(y1); y < H; y++) blend(x, y, hex('#7EC8E3'), 0.1);
  for (let y = Math.floor(y2); y < H; y++) blend(x, y, hex('#7EC8E3'), 0.14);
}

/* 5. 皇冠（扫描线填充多边形） */
const CROWN = [[9, 34], [6.6, 17.5], [15.5, 23.4], [24, 10.6], [32.5, 23.4], [41.4, 17.5], [39, 34]];
const S = 8.4;
const OFF_X = 600 - 24 * S;
const OFF_Y = 300 - 26 * S;

function fillPoly(points, colorFn) {
  const pts = points.map(([x, y]) => [OFF_X + x * S, OFF_Y + y * S]);
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) {
        const t = (x - OFF_X) / (48 * S);
        blend(x, y, colorFn(t), 1);
      }
    }
  }
}

const goldTop = hex('#FFF3D2');
const goldBottom = hex('#E8C87A');
const goldAt = (t) => goldTop.map((v, i) => v + (goldBottom[i] - v) * Math.min(1, Math.max(0, t)));

fillPoly(CROWN, goldAt);

/* 冠座 */
const base = [[9, 34], [39, 34], [39, 39.4], [9, 39.4]];
fillPoly(base, goldAt);

/* 冠上的宝石 */
for (const [cx, cy, r] of [[24, 27.6, 2.4], [15.5, 25.2, 1.6], [32.5, 25.2, 1.6]]) {
  const bx = OFF_X + cx * S, by = OFF_Y + cy * S, br = r * S;
  for (let y = Math.floor(by - br); y <= by + br; y++) {
    for (let x = Math.floor(bx - br); x <= bx + br; x++) {
      if (Math.hypot(x - bx, y - by) <= br) blend(x, y, hex('#FFFBEE'), 0.92);
    }
  }
}

/* 6. 编码 PNG */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(OUT, png);
console.log('written: public/og-default.png  ' + png.length + ' bytes  ' + W + 'x' + H);
