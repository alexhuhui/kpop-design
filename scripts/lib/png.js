'use strict';

// Minimal PNG reader. Node builtins only (zlib).
// Handles the 8-bit non-interlaced RGB / RGBA files Canva exports.

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Reads just the IHDR. Cheap enough to call on every file during a scan.
function readHeader(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Full decode to an interleaved 8-bit pixel buffer.
function decode(buf) {
  const head = readHeader(buf);
  if (head.bitDepth !== 8) throw new Error(`bit depth ${head.bitDepth} unsupported (need 8)`);
  if (head.interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (head.colorType !== 2 && head.colorType !== 6) {
    throw new Error(`color type ${head.colorType} unsupported (need 2 or 6)`);
  }

  const channels = head.colorType === 2 ? 3 : 4;
  const idat = [];

  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += len + 12; // length + type + data + CRC
  }
  if (!idat.length) throw new Error('no IDAT chunks');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = head;
  const stride = width * channels;
  const out = Buffer.allocUnsafe(stride * height);

  let src = 0;
  let prev = Buffer.alloc(stride); // scanline above; zeroes for row 0
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const line = out.subarray(y * stride, y * stride + stride);
    raw.copy(line, 0, src, src + stride);
    src += stride;

    switch (filter) {
      case 0:
        break;
      case 1: // Sub
        for (let i = channels; i < stride; i++) line[i] = (line[i] + line[i - channels]) & 0xff;
        break;
      case 2: // Up
        for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 0xff;
        break;
      case 3: // Average
        for (let i = 0; i < stride; i++) {
          const left = i >= channels ? line[i - channels] : 0;
          line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < stride; i++) {
          const left = i >= channels ? line[i - channels] : 0;
          const upLeft = i >= channels ? prev[i - channels] : 0;
          line[i] = (line[i] + paeth(left, prev[i], upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`unknown filter type ${filter} on row ${y}`);
    }
    prev = line;
  }

  return { width, height, channels, data: out };
}

module.exports = { readHeader, decode };
