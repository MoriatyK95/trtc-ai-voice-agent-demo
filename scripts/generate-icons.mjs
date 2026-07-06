/**
 * One-off helper that renders the app icon (public/icon.svg design) to
 * icon-192.png and icon-512.png using only Node built-ins — no image
 * libraries needed. Re-run with `node scripts/generate-icons.mjs` if you
 * ever change the icon design.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Minimal PNG encoder: raw RGBA pixels → PNG file bytes. */
function encodePng(width, height, rgba) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA

  // Each scanline is prefixed with filter byte 0 (no filter).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draws the icon at the given size and returns raw RGBA pixels. */
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512; // design coordinates are 512-based

  const cornerRadius = 112 * s;
  const orbCx = 256 * s;
  const orbCy = 256 * s;
  const orbR = 160 * s;

  // Sound-wave bars: [x, y, w, h] in 512-space, corner radius 8
  const bars = [
    [196, 226, 16, 60],
    [228, 196, 16, 120],
    [260, 216, 16, 80],
    [292, 236, 16, 40],
  ].map((b) => b.map((v) => v * s));

  const insideRoundedRect = (x, y) => {
    const rx = Math.max(cornerRadius - x, x - (size - cornerRadius), 0);
    const ry = Math.max(cornerRadius - y, y - (size - cornerRadius), 0);
    return rx * rx + ry * ry <= cornerRadius * cornerRadius;
  };

  const insideBar = (x, y) => {
    for (const [bx, by, bw, bh] of bars) {
      const r = 8 * s;
      if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
        const rx = Math.max(bx + r - x, x - (bx + bw - r), 0);
        const ry = Math.max(by + r - y, y - (by + bh - r), 0);
        if (rx * rx + ry * ry <= r * r) return true;
      }
    }
    return false;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!insideRoundedRect(x + 0.5, y + 0.5)) continue; // transparent corner

      // Background navy
      let [r, g, b] = [0x0b, 0x10, 0x20];

      // Orb with a diagonal blue→purple gradient
      const dx = x + 0.5 - orbCx;
      const dy = y + 0.5 - orbCy;
      if (dx * dx + dy * dy <= orbR * orbR) {
        const t = Math.min(Math.max((dx + dy + 2 * orbR) / (4 * orbR), 0), 1);
        r = Math.round(0x4f + (0x8b - 0x4f) * t);
        g = Math.round(0x8c + (0x5c - 0x8c) * t);
        b = Math.round(0xff + (0xf6 - 0xff) * t);
      }

      if (insideBar(x + 0.5, y + 0.5)) [r, g, b] = [255, 255, 255];

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return px;
}

for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, drawIcon(size)));
  console.log(`wrote ${file}`);
}
