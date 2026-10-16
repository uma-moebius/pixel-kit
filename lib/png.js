"use strict";
// Minimal PNG reader/writer for the CLI (no dependencies).
// Reads non-interlaced PNGs of any standard color type and bit depth and
// returns 8-bit RGBA. Writes 8-bit RGBA.

const zlib = require("node:zlib");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class PngError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngError("read", "Not a PNG file.");
  }
  let offset = 8;
  let header = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new PngError("read", "Truncated PNG.");
    offset += 12 + length;
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!header || !idat.length) throw new PngError("read", "PNG has no image data.");
  const { width, height, depth, colorType, interlace } = header;
  const channels = CHANNELS[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new PngError("read", "Unsupported PNG color type or bit depth.");
  if (interlace) throw new PngError("interlaced", "Interlaced PNGs are not supported.");
  if (colorType === 3 && !palette) throw new PngError("read", "Palette PNG without a palette.");
  if (!(width > 0 && height > 0)) throw new PngError("read", "PNG has no pixels.");

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw new PngError("read", "Corrupt PNG data.");
  }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new PngError("read", "Truncated PNG data.");

  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const line = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let value = src[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new PngError("read", "Bad PNG filter.");
      line[x] = value & 0xff;
    }
    prev = line;
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const max = (1 << depth) - 1;
  const sample = (line, index) => {
    if (depth === 8) return line[index];
    if (depth === 16) return line[index * 2];
    const bit = index * depth;
    return (line[bit >> 3] >> (8 - depth - (bit & 7))) & max;
  };
  const sample16 = (line, index) => (line[index * 2] << 8) | line[index * 2 + 1];
  const scale = (value) => (depth >= 8 ? value : Math.round((value * 255) / max));
  for (let y = 0; y < height; y++) {
    const line = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      let r, g, b, a = 255;
      if (colorType === 3) {
        const index = sample(line, x);
        r = palette[index * 3];
        g = palette[index * 3 + 1];
        b = palette[index * 3 + 2];
        if (trns && index < trns.length) a = trns[index];
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = scale(sample(line, i));
        if (colorType === 4) a = scale(sample(line, i + 1));
        else if (trns && (depth === 16 ? sample16(line, i) : sample(line, i)) === trns.readUInt16BE(0)) a = 0;
      } else {
        r = sample(line, i);
        g = sample(line, i + 1);
        b = sample(line, i + 2);
        if (colorType === 6) a = sample(line, i + 3);
        else if (trns && trns.length >= 6) {
          const rr = depth === 16 ? sample16(line, i) : r;
          const gg = depth === 16 ? sample16(line, i + 1) : g;
          const bb = depth === 16 ? sample16(line, i + 2) : b;
          if (rr === trns.readUInt16BE(0) && gg === trns.readUInt16BE(2) && bb === trns.readUInt16BE(4)) a = 0;
        }
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { width, height, data: out };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { decodePng, encodePng, PngError };
