'use strict';

/**
 * Generates the extension's PNG icons.
 *
 * Chrome wants real PNG files and this project has no dependencies, so the
 * PNGs are written by hand: draw into a pixel buffer, then wrap it in the
 * handful of chunks the PNG format needs.
 *
 *   npm run icons
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');
const SIZES = [16, 32, 48, 128];

const PURPLE = [106, 90, 205];   // matches --accent in popup.css
const WHITE = [255, 255, 255];

// ---------------------------------------------------------------- PNG writing

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Buffer} rgba  size*size*4 bytes */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);       // width
  header.writeUInt32BE(size, 4);       // height
  header[8] = 8;                       // bit depth
  header[9] = 6;                       // colour type: RGBA
  header[10] = 0;                      // deflate
  header[11] = 0;                      // adaptive filtering
  header[12] = 0;                      // no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- drawing

/**
 * Draw the icon: a rounded purple square with a white bookmark on it.
 * Sampled 3x per axis so the curves do not look jagged at 16px.
 */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SAMPLES = 3;

  const radius = size * 0.22;

  // Bookmark geometry, in fractions of the icon size.
  const bmLeft = size * 0.33;
  const bmRight = size * 0.67;
  const bmTop = size * 0.24;
  const bmBottom = size * 0.76;
  const notch = size * 0.13;

  const insideRoundedSquare = (x, y) => {
    if (x < 0 || y < 0 || x > size || y > size) return false;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  const insideBookmark = (x, y) => {
    if (x < bmLeft || x > bmRight || y < bmTop || y > bmBottom) return false;
    // Cut a V out of the bottom edge: widest at the very bottom, tapering
    // to a point `notch` pixels higher up.
    const depthIntoBottom = y - (bmBottom - notch);
    if (depthIntoBottom <= 0) return true;
    const distanceFromCentre = Math.abs(x - (bmLeft + bmRight) / 2);
    return distanceFromCentre >= depthIntoBottom;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bg = 0;
      let fg = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          if (insideRoundedSquare(px, py)) {
            bg += 1;
            if (insideBookmark(px, py)) fg += 1;
          }
        }
      }

      const total = SAMPLES * SAMPLES;
      const alpha = bg / total;
      const mark = fg / total;

      // Blend the white mark over the purple, then apply the shape's alpha.
      const mix = alpha > 0 ? mark / alpha : 0;
      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        rgba[offset + c] = Math.round(PURPLE[c] * (1 - mix) + WHITE[c] * mix);
      }
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }

  return rgba;
}

// ---------------------------------------------------------------- run

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
