'use strict';

// Baseline JPEG encoder, 4:4:4, no dependencies.
//
// Photographic PNGs are the wrong format for the web: a 960px-wide crop of a
// Canva export lands around 500 KB as PNG and around 45 KB as JPEG. The gallery
// serves JPEG derivatives and keeps the PNG originals as the download source.
//
// Tables are ITU T.81 Annex K. Everything is kept in natural (raster) order and
// zigzagged only where the format demands it, so there is one convention to
// hold in your head instead of two.

// zz[k] = natural index of the k-th coefficient in zigzag order.
const ZIGZAG = [
   0,  1,  8, 16,  9,  2,  3, 10,
  17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

const QUANT_LUMA = [
  16, 11, 10, 16,  24,  40,  51,  61,
  12, 12, 14, 19,  26,  58,  60,  55,
  14, 13, 16, 24,  40,  57,  69,  56,
  14, 17, 22, 29,  51,  87,  80,  62,
  18, 22, 37, 56,  68, 109, 103,  77,
  24, 35, 55, 64,  81, 104, 113,  92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103,  99,
];

const QUANT_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
];

// Scale factors for the AAN forward DCT, folded into the quant tables.
const AAN = [
  1.0, 1.387039845, 1.306562965, 1.175875602,
  1.0, 0.785694958, 0.541196100, 0.275899379,
];

const DC_LUMA_BITS = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const AC_LUMA_BITS = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

const AC_CHROMA_BITS = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

// BITS[len] = how many codes of that length. Walks lengths in order, handing out
// consecutive codes and shifting left at each new length. T.81 Annex C.
function buildHuffmanTable(bits, vals) {
  const table = [];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len]; i++) {
      table[vals[k++]] = { code, length: len };
      code++;
    }
    code <<= 1;
  }
  return table;
}

// Quant values scaled for the requested quality, plus the same values folded
// with the AAN scale factors and pre-inverted so the DCT can multiply.
function scaleQuant(base, quality) {
  const sf = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2;
  const table = new Int32Array(64);
  const forward = new Float32Array(64);
  for (let n = 0; n < 64; n++) {
    let v = Math.floor((base[n] * sf + 50) / 100);
    if (v < 1) v = 1;
    else if (v > 255) v = 255;
    table[n] = v;
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const n = row * 8 + col;
      forward[n] = 1 / (table[n] * AAN[row] * AAN[col] * 8);
    }
  }
  return { table, forward };
}

// AAN forward DCT, in place, then quantize. `block` is natural order.
function forwardDCTQuant(block, forward, out) {
  let tmp0, tmp1, tmp2, tmp3, tmp4, tmp5, tmp6, tmp7;
  let tmp10, tmp11, tmp12, tmp13;
  let z1, z2, z3, z4, z5, z11, z13;

  for (let i = 0; i < 8; i++) {
    const o = i * 8;
    tmp0 = block[o + 0] + block[o + 7];
    tmp7 = block[o + 0] - block[o + 7];
    tmp1 = block[o + 1] + block[o + 6];
    tmp6 = block[o + 1] - block[o + 6];
    tmp2 = block[o + 2] + block[o + 5];
    tmp5 = block[o + 2] - block[o + 5];
    tmp3 = block[o + 3] + block[o + 4];
    tmp4 = block[o + 3] - block[o + 4];

    tmp10 = tmp0 + tmp3;
    tmp13 = tmp0 - tmp3;
    tmp11 = tmp1 + tmp2;
    tmp12 = tmp1 - tmp2;

    block[o + 0] = tmp10 + tmp11;
    block[o + 4] = tmp10 - tmp11;

    z1 = (tmp12 + tmp13) * 0.707106781;
    block[o + 2] = tmp13 + z1;
    block[o + 6] = tmp13 - z1;

    tmp10 = tmp4 + tmp5;
    tmp11 = tmp5 + tmp6;
    tmp12 = tmp6 + tmp7;

    z5 = (tmp10 - tmp12) * 0.382683433;
    z2 = 0.541196100 * tmp10 + z5;
    z4 = 1.306562965 * tmp12 + z5;
    z3 = tmp11 * 0.707106781;

    z11 = tmp7 + z3;
    z13 = tmp7 - z3;

    block[o + 5] = z13 + z2;
    block[o + 3] = z13 - z2;
    block[o + 1] = z11 + z4;
    block[o + 7] = z11 - z4;
  }

  for (let i = 0; i < 8; i++) {
    tmp0 = block[i + 8 * 0] + block[i + 8 * 7];
    tmp7 = block[i + 8 * 0] - block[i + 8 * 7];
    tmp1 = block[i + 8 * 1] + block[i + 8 * 6];
    tmp6 = block[i + 8 * 1] - block[i + 8 * 6];
    tmp2 = block[i + 8 * 2] + block[i + 8 * 5];
    tmp5 = block[i + 8 * 2] - block[i + 8 * 5];
    tmp3 = block[i + 8 * 3] + block[i + 8 * 4];
    tmp4 = block[i + 8 * 3] - block[i + 8 * 4];

    tmp10 = tmp0 + tmp3;
    tmp13 = tmp0 - tmp3;
    tmp11 = tmp1 + tmp2;
    tmp12 = tmp1 - tmp2;

    block[i + 8 * 0] = tmp10 + tmp11;
    block[i + 8 * 4] = tmp10 - tmp11;

    z1 = (tmp12 + tmp13) * 0.707106781;
    block[i + 8 * 2] = tmp13 + z1;
    block[i + 8 * 6] = tmp13 - z1;

    tmp10 = tmp4 + tmp5;
    tmp11 = tmp5 + tmp6;
    tmp12 = tmp6 + tmp7;

    z5 = (tmp10 - tmp12) * 0.382683433;
    z2 = 0.541196100 * tmp10 + z5;
    z4 = 1.306562965 * tmp12 + z5;
    z3 = tmp11 * 0.707106781;

    z11 = tmp7 + z3;
    z13 = tmp7 - z3;

    block[i + 8 * 5] = z13 + z2;
    block[i + 8 * 3] = z13 - z2;
    block[i + 8 * 1] = z11 + z4;
    block[i + 8 * 7] = z11 - z4;
  }

  for (let n = 0; n < 64; n++) {
    const v = block[n] * forward[n];
    out[n] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
  }
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.count = 0;
  }

  writeBits(code, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.count++;
      if (this.count === 8) {
        const b = this.acc & 0xff;
        this.bytes.push(b);
        if (b === 0xff) this.bytes.push(0x00); // byte stuffing
        this.acc = 0;
        this.count = 0;
      }
    }
  }

  // Pad the final partial byte with 1s, per T.81.
  flush() {
    while (this.count !== 0) this.writeBits(1, 1);
  }
}

// Number of bits needed to represent `v`, and its JPEG-coded value.
function magnitude(v) {
  let a = v < 0 ? -v : v;
  let size = 0;
  while (a) {
    size++;
    a >>= 1;
  }
  return size;
}

function encodeBlock(bw, coefs, prevDC, dcTable, acTable) {
  const dc = coefs[0];
  const diff = dc - prevDC;

  if (diff === 0) {
    const e = dcTable[0];
    bw.writeBits(e.code, e.length);
  } else {
    const size = magnitude(diff);
    const e = dcTable[size];
    bw.writeBits(e.code, e.length);
    // Negative values are stored as the one's complement of their magnitude.
    bw.writeBits(diff > 0 ? diff : diff - 1 + (1 << size), size);
  }

  // Trailing zeroes are replaced by a single EOB, so find the last non-zero.
  let end = 0;
  for (let k = 1; k < 64; k++) {
    if (coefs[ZIGZAG[k]] !== 0) end = k;
  }

  let run = 0;
  for (let k = 1; k <= end; k++) {
    const v = coefs[ZIGZAG[k]];
    if (v === 0) {
      run++;
      continue;
    }
    while (run > 15) {
      const zrl = acTable[0xf0]; // ZRL: sixteen zeroes
      bw.writeBits(zrl.code, zrl.length);
      run -= 16;
    }
    const size = magnitude(v);
    const e = acTable[(run << 4) | size];
    bw.writeBits(e.code, e.length);
    bw.writeBits(v > 0 ? v : v - 1 + (1 << size), size);
    run = 0;
  }

  if (end < 63) {
    const eob = acTable[0x00];
    bw.writeBits(eob.code, eob.length);
  }
}

/**
 * @param {{width:number,height:number,channels:number,data:Buffer}} image
 * @param {number} quality 1-100
 * @returns {Buffer} a complete baseline JPEG
 */
function encode(image, quality = 78) {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const { width, height, channels, data } = image;

  const luma = scaleQuant(QUANT_LUMA, q);
  const chroma = scaleQuant(QUANT_CHROMA, q);

  const dcLuma = buildHuffmanTable(DC_LUMA_BITS, DC_LUMA_VALS);
  const acLuma = buildHuffmanTable(AC_LUMA_BITS, AC_LUMA_VALS);
  const dcChroma = buildHuffmanTable(DC_CHROMA_BITS, DC_CHROMA_VALS);
  const acChroma = buildHuffmanTable(AC_CHROMA_BITS, AC_CHROMA_VALS);

  const head = [];
  const u8 = (v) => head.push(v & 0xff);
  const u16 = (v) => {
    head.push((v >> 8) & 0xff, v & 0xff);
  };
  const marker = (m) => head.push(0xff, m);

  marker(0xd8); // SOI

  marker(0xe0); // APP0 / JFIF
  u16(16);
  head.push(0x4a, 0x46, 0x49, 0x46, 0x00); // "JFIF\0"
  u16(0x0101); // version 1.1
  u8(0); // density units: none
  u16(1);
  u16(1);
  u8(0);
  u8(0); // no thumbnail

  marker(0xdb); // DQT, both tables
  u16(132);
  u8(0);
  for (let k = 0; k < 64; k++) u8(luma.table[ZIGZAG[k]]);
  u8(1);
  for (let k = 0; k < 64; k++) u8(chroma.table[ZIGZAG[k]]);

  marker(0xc0); // SOF0, baseline
  u16(17);
  u8(8); // 8-bit samples
  u16(height);
  u16(width);
  u8(3); // three components
  u8(1); u8(0x11); u8(0); // Y,  1x1 sampling, quant table 0
  u8(2); u8(0x11); u8(1); // Cb, 1x1 sampling, quant table 1
  u8(3); u8(0x11); u8(1); // Cr

  marker(0xc4); // DHT, all four tables
  u16(2 + 4 * 17 + DC_LUMA_VALS.length + AC_LUMA_VALS.length
        + DC_CHROMA_VALS.length + AC_CHROMA_VALS.length);
  const emitHuff = (id, bits, vals) => {
    u8(id);
    for (let i = 1; i <= 16; i++) u8(bits[i]);
    for (const v of vals) u8(v);
  };
  emitHuff(0x00, DC_LUMA_BITS, DC_LUMA_VALS);
  emitHuff(0x10, AC_LUMA_BITS, AC_LUMA_VALS);
  emitHuff(0x01, DC_CHROMA_BITS, DC_CHROMA_VALS);
  emitHuff(0x11, AC_CHROMA_BITS, AC_CHROMA_VALS);

  marker(0xda); // SOS
  u16(12);
  u8(3);
  u8(1); u8(0x00); // Y  uses DC table 0, AC table 0
  u8(2); u8(0x11); // Cb uses DC table 1, AC table 1
  u8(3); u8(0x11); // Cr
  u8(0); u8(63); u8(0); // spectral selection 0-63, no successive approximation

  const bw = new BitWriter();
  const blockY = new Float32Array(64);
  const blockCb = new Float32Array(64);
  const blockCr = new Float32Array(64);
  const quantized = new Int32Array(64);

  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        // Blocks past the edge repeat the last row/column rather than going
        // black, which keeps the boundary from ringing.
        const sy = Math.min(by + y, height - 1);
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(bx + x, width - 1);
          const p = (sy * width + sx) * channels;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const i = y * 8 + x;
          // BT.601, level-shifted by -128 as baseline JPEG expects.
          blockY[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          blockCb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          blockCr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }

      forwardDCTQuant(blockY, luma.forward, quantized);
      encodeBlock(bw, quantized, dcY, dcLuma, acLuma);
      dcY = quantized[0];

      forwardDCTQuant(blockCb, chroma.forward, quantized);
      encodeBlock(bw, quantized, dcCb, dcChroma, acChroma);
      dcCb = quantized[0];

      forwardDCTQuant(blockCr, chroma.forward, quantized);
      encodeBlock(bw, quantized, dcCr, dcChroma, acChroma);
      dcCr = quantized[0];
    }
  }

  bw.flush();

  return Buffer.concat([
    Buffer.from(head),
    Buffer.from(bw.bytes),
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

module.exports = { encode };
