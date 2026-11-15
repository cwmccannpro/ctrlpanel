// Generates the PWA icons into public/ — no image dependencies, just a tiny PNG
// encoder. Run with: node scripts/make-icons.mjs
//
// The mark is a "power ring" (an open circle with a dot) in the default accent on
// the default near-black surface. "maskable" icons are full-bleed with the mark
// kept inside the central safe zone, so any platform mask (circle, squircle…)
// can crop them safely.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [10, 8, 8]; // --bg-base
const ACCENT = [225, 29, 72]; // --accent (default)
const SS = 3; // supersampling per axis

// CRC32 for PNG chunks.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Coverage (0..1) of the mark at (x, y) in a unit square. `scale` shrinks the
 * mark about the centre (maskable icons use a smaller one).
 */
function markAt(x, y, scale) {
  const dx = (x - 0.5) / scale;
  const dy = (y - 0.545) / scale; // nudged down so the mark (bar + ring) is optically centred
  const r = Math.hypot(dx, dy);
  // Ring with a gap at the top (a power symbol): angle measured from "up".
  const angle = Math.atan2(dx, -dy); // 0 = up, ±π = down
  const inRing = r >= 0.27 && r <= 0.37 && Math.abs(angle) > 0.42;
  // Bar through the gap.
  const inBar = Math.abs(dx) <= 0.045 && dy >= -0.42 && dy <= -0.06;
  // Round the bar's top end.
  const inCap = Math.hypot(dx, dy + 0.42) <= 0.045;
  return inRing || inBar || inCap ? 1 : 0;
}

function render(size, { maskable = false, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.72 : 1;
  const radius = 0.22; // corner radius of the rounded square (fraction of size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCover = 0;
      let markCover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          // Rounded-square footprint (full square when maskable / apple).
          let inside = 1;
          if (rounded && !maskable) {
            const cx = Math.min(u, 1 - u);
            const cy = Math.min(v, 1 - v);
            if (cx < radius && cy < radius) inside = Math.hypot(radius - cx, radius - cy) <= radius ? 1 : 0;
          }
          bgCover += inside;
          markCover += inside * markAt(u, v, scale);
        }
      }
      const n = SS * SS;
      const a = bgCover / n; // alpha of the background shape
      const m = markCover / n; // alpha of the mark
      const i = (y * size + x) * 4;
      if (a === 0) continue; // transparent corner
      // Mark over background, premultiplied by coverage.
      const mix = a ? m / a : 0;
      px[i] = Math.round(BG[0] * (1 - mix) + ACCENT[0] * mix);
      px[i + 1] = Math.round(BG[1] * (1 - mix) + ACCENT[1] * mix);
      px[i + 2] = Math.round(BG[2] * (1 - mix) + ACCENT[2] * mix);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, px);
}

mkdirSync(join(root, 'icons'), { recursive: true });
const files = {
  'icons/icon-192.png': render(192),
  'icons/icon-512.png': render(512),
  'icons/icon-maskable-512.png': render(512, { maskable: true }),
  'icons/apple-touch-icon.png': render(180, { rounded: false }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(root, name), data);
  console.log(`wrote public/${name} (${data.length} bytes)`);
}

// Vector favicon: same mark, so the tab icon stays crisp at any size.
writeFileSync(
  join(root, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="rgb(${BG.join(',')})"/>
  <g transform="translate(0 4)" fill="none" stroke="rgb(${ACCENT.join(',')})" stroke-linecap="round">
    <path d="M33.4 28.6a32 32 0 1 0 33.2 0" stroke-width="10"/>
    <path d="M50 12v34" stroke-width="9"/>
  </g>
</svg>
`
);
console.log('wrote public/favicon.svg');
