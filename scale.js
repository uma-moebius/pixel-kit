(function (root) {
  const MAX_EDGE = 8192;
  const MAX_PIXELS = 16777216;

  const MESSAGES = {
    format: "Unsupported format. Choose a PNG, JPEG, WebP, or GIF.",
    read: "Could not read this as an image.",
    duplicate: "This name is already used. The first file is kept.",
    name: "The name contains / or \\.",
    small: "Width or height would be under 1 px.",
    side: "One side is over 8,192 px.",
    total: "Total pixels exceed 16,777,216.",
    memory: "Not enough memory for this size.",
    number: "Enter a positive number.",
  };

  const FORMAT_LABEL = { png: "PNG", jpeg: "JPEG", webp: "WebP", gif: "GIF" };

  // -10…-2, then 1…10. There is no 0 or -1: -1 would be the same size as 1.
  const VIEW_STOPS = [];
  for (let level = -10; level <= -2; level++) VIEW_STOPS.push(level);
  for (let level = 1; level <= 10; level++) VIEW_STOPS.push(level);

  function viewFactor(level) {
    const stop = VIEW_STOPS.indexOf(level) >= 0 ? level : 1;
    return stop >= 1 ? stop : 1 / -stop;
  }

  function decimalRatio(text) {
    const trimmed = String(text ?? "").trim();
    const match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(trimmed);
    if (!match) return null;
    const whole = match[1] || "";
    const frac = match[2] != null ? match[2] : (match[3] || "");
    const numer = Number((whole || "0") + frac);
    const denom = 10 ** frac.length || 1;
    if (!Number.isSafeInteger(numer) || numer <= 0 || !Number.isSafeInteger(denom)) return null;
    return { numer, denom };
  }

  function parsePositive(text) {
    const ratio = decimalRatio(text);
    return ratio ? ratio.numer / ratio.denom : null;
  }

  // Round a positive integer fraction half up, so 0.5 goes away from zero.
  function mulDivRound(src, numer, denom) {
    if (
      Number.isSafeInteger(src) &&
      Number.isSafeInteger(numer) &&
      Number.isSafeInteger(denom) &&
      Number.isSafeInteger(src * numer)
    ) {
      const product = src * numer;
      const quotient = Math.floor(product / denom);
      const remainder = product % denom;
      return remainder * 2 >= denom ? quotient + 1 : quotient;
    }
    return Math.round((src * numer) / denom);
  }

  function outputSize(srcW, srcH, settings) {
    if (!(srcW > 0) || !(srcH > 0)) return { ok: false, code: "read" };
    let width;
    let height;
    if (settings.mode === "pixels") {
      if (!settings.pixelRatio) return { ok: false, code: "number" };
      const edge = mulDivRound(1, settings.pixelRatio.numer, settings.pixelRatio.denom);
      if (edge < 1) return { ok: false, code: "small" };
      if (settings.edge === "height") {
        height = edge;
        width = mulDivRound(srcW, edge, srcH);
      } else {
        width = edge;
        height = mulDivRound(srcH, edge, srcW);
      }
    } else {
      if (!settings.scaleRatio) return { ok: false, code: "number" };
      width = mulDivRound(srcW, settings.scaleRatio.numer, settings.scaleRatio.denom);
      height = mulDivRound(srcH, settings.scaleRatio.numer, settings.scaleRatio.denom);
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return { ok: false, code: "side" };
    }
    if (width < 1 || height < 1) return { ok: false, code: "small", width, height };
    if (width > MAX_EDGE || height > MAX_EDGE) return { ok: false, code: "side", width, height };
    if (width * height > MAX_PIXELS) return { ok: false, code: "total", width, height };
    return { ok: true, width, height };
  }

  function classify(files, settings) {
    const results = files.map((file) => {
      if (!file.format) return { status: "fail", code: "format", width: 0, height: 0 };
      if (/[\\/]/.test(file.name || "")) return { status: "fail", code: "name", width: 0, height: 0 };
      if (file.ready === false) return { status: "pending", code: null, width: 0, height: 0 };
      if (!file.readable) return { status: "fail", code: "read", width: 0, height: 0 };
      const size = outputSize(file.width, file.height, settings);
      if (!size.ok) {
        return { status: "fail", code: size.code, width: size.width || 0, height: size.height || 0 };
      }
      return { status: "pass", code: null, width: size.width, height: size.height };
    });
    const claimed = new Set();
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== "pass") continue;
      const name = files[i].name;
      if (claimed.has(name)) {
        results[i] = {
          status: "duplicate",
          code: "duplicate",
          width: results[i].width,
          height: results[i].height,
        };
      } else {
        claimed.add(name);
      }
    }
    return results;
  }

  function downloadAction(files) {
    if (files.length === 0) return { label: "Download PNG", enabled: false, kind: "empty" };
    if (files.some((file) => file.status === "pending")) {
      const assumed = files.map((file) => (
        file.status === "pending" ? { status: "pass", format: file.format } : file
      ));
      return { label: downloadAction(assumed).label, enabled: false, kind: "pending" };
    }
    const passes = files.filter((file) => file.status === "pass");
    if (files.length === 1) {
      if (passes.length === 1) {
        return { label: "Download " + FORMAT_LABEL[files[0].format], enabled: true, kind: files[0].format };
      }
      return { label: "Cannot download", enabled: false, kind: "none" };
    }
    if (passes.length >= 2) return { label: "Download ZIP", enabled: true, kind: "zip" };
    return { label: "Cannot download", enabled: false, kind: "none" };
  }

  function formatCount(value) {
    return Math.round(value).toLocaleString("en-US");
  }

  function formatPair(width, height, withUnit) {
    const text = formatCount(width) + " \u00d7 " + formatCount(height);
    return withUnit ? text + " px" : text;
  }

  function formatScale(value) {
    if (!Number.isFinite(value) || value <= 0) return "";
    return String(Math.round(value * 10000) / 10000);
  }

  function scaleImageData(src, srcW, srcH, dst, dstW, dstH, y0, y1) {
    const start = y0 || 0;
    const end = y1 == null ? dstH : y1;
    for (let y = start; y < end; y++) {
      const sy = Math.floor((y * srcH) / dstH);
      const srcRow = sy * srcW;
      const dstRow = y * dstW;
      for (let x = 0; x < dstW; x++) {
        const sx = Math.floor((x * srcW) / dstW);
        const si = (srcRow + sx) * 4;
        const di = (dstRow + x) * 4;
        const alpha = src[si + 3];
        if (alpha === 0) {
          dst[di] = 0;
          dst[di + 1] = 0;
          dst[di + 2] = 0;
          dst[di + 3] = 0;
        } else {
          dst[di] = src[si];
          dst[di + 1] = src[si + 1];
          dst[di + 2] = src[si + 2];
          dst[di + 3] = alpha;
        }
      }
    }
  }

  function padPalette(palette) {
    let size = 2;
    while (size < palette.length) size *= 2;
    const padded = palette.slice();
    while (padded.length < size) padded.push([0, 0, 0]);
    return padded;
  }

  function medianCut(colors, maxColors) {
    let boxes = [colors.slice()];
    while (boxes.length < maxColors) {
      let best = -1;
      let bestRange = -1;
      let channel = "r";
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.length < 2) continue;
        for (const axis of ["r", "g", "b"]) {
          let lo = 255;
          let hi = 0;
          for (const color of box) {
            if (color[axis] < lo) lo = color[axis];
            if (color[axis] > hi) hi = color[axis];
          }
          const range = hi - lo;
          if (range > bestRange) {
            bestRange = range;
            best = i;
            channel = axis;
          }
        }
      }
      if (best < 0 || bestRange <= 0) break;
      const box = boxes[best];
      box.sort((a, b) => a[channel] - b[channel]);
      let total = 0;
      for (const color of box) total += color.n;
      let running = 0;
      let split = 1;
      for (let i = 0; i < box.length - 1; i++) {
        running += box[i].n;
        if (running >= total / 2) {
          split = i + 1;
          break;
        }
      }
      boxes.splice(best, 1, box.slice(0, split), box.slice(split));
    }
    return boxes.map((box) => {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const color of box) {
        n += color.n;
        r += color.r * color.n;
        g += color.g * color.n;
        b += color.b * color.n;
      }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
  }

  function nearestOpaque(palette, r, g, b, skip) {
    let best = skip === 0 ? 1 : 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      if (i === skip) continue;
      const color = palette[i];
      const dr = r - color[0];
      const dg = g - color[1];
      const db = b - color[2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
        if (distance === 0) break;
      }
    }
    return best;
  }

  function indexImage(rgba, width, height) {
    const count = width * height;
    let hasTransparent = false;
    const unique = new Map();
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      if (rgba[offset + 3] < 128) {
        hasTransparent = true;
        continue;
      }
      const key = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2];
      const found = unique.get(key);
      if (found) found.n += 1;
      else unique.set(key, { r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2], n: 1, key });
    }
    const maxOpaque = hasTransparent ? 255 : 256;
    let palette = [];
    let transparentIndex = -1;
    const indices = new Uint8Array(count);
    if (unique.size <= maxOpaque) {
      const lookup = new Map();
      if (hasTransparent) {
        transparentIndex = 0;
        palette.push([0, 0, 0]);
      }
      for (const color of unique.values()) {
        lookup.set(color.key, palette.length);
        palette.push([color.r, color.g, color.b]);
      }
      for (let i = 0; i < count; i++) {
        const offset = i * 4;
        if (rgba[offset + 3] < 128) indices[i] = transparentIndex;
        else indices[i] = lookup.get((rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2]);
      }
    } else {
      const reduced = medianCut([...unique.values()], maxOpaque);
      if (hasTransparent) {
        transparentIndex = 0;
        palette = [[0, 0, 0], ...reduced];
      } else {
        palette = reduced;
      }
      const cache = new Map();
      for (let i = 0; i < count; i++) {
        const offset = i * 4;
        if (rgba[offset + 3] < 128) {
          indices[i] = transparentIndex;
          continue;
        }
        const r = rgba[offset];
        const g = rgba[offset + 1];
        const b = rgba[offset + 2];
        const cacheKey = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let index = cache.get(cacheKey);
        if (index === undefined) {
          index = nearestOpaque(palette, r, g, b, transparentIndex);
          cache.set(cacheKey, index);
        }
        indices[i] = index;
      }
    }
    return { indices, palette: padPalette(palette), transparentIndex };
  }

  // GIF LZW is the compress routine from GIFCOMPR.C, as used by gifenc (MIT).
  function lzwImageData(pixels) {
    const out = [];
    const writeByte = (value) => out.push(value & 255);
    const BITS = 12;
    const HSIZE = 5003;
    const MASKS = [
      0x0000, 0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff,
      0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff,
    ];
    const htab = new Int32Array(HSIZE);
    const codetab = new Int32Array(HSIZE);
    const accum = new Uint8Array(256);
    htab.fill(-1);
    const initCodeSize = 8;
    let curAccum = 0;
    let curBits = 0;
    const initBits = initCodeSize + 1;
    let clearFlag = false;
    let nBits = initBits;
    let maxcode = (1 << nBits) - 1;
    const clearCode = 1 << (initBits - 1);
    const eoiCode = clearCode + 1;
    let freeEnt = clearCode + 2;
    let packet = 0;
    let hshift = 0;
    for (let fcode = HSIZE; fcode < 65536; fcode *= 2) hshift += 1;
    hshift = 8 - hshift;

    function flushPacket() {
      writeByte(packet);
      for (let i = 0; i < packet; i++) writeByte(accum[i]);
      packet = 0;
    }

    function output(code) {
      curAccum &= MASKS[curBits];
      if (curBits > 0) curAccum |= code << curBits;
      else curAccum = code;
      curBits += nBits;
      while (curBits >= 8) {
        accum[packet++] = curAccum & 0xff;
        if (packet >= 254) flushPacket();
        curAccum >>= 8;
        curBits -= 8;
      }
      if (freeEnt > maxcode || clearFlag) {
        if (clearFlag) {
          nBits = initBits;
          maxcode = (1 << nBits) - 1;
          clearFlag = false;
        } else {
          nBits += 1;
          maxcode = nBits === BITS ? 1 << nBits : (1 << nBits) - 1;
        }
      }
      if (code === eoiCode) {
        while (curBits > 0) {
          accum[packet++] = curAccum & 0xff;
          if (packet >= 254) flushPacket();
          curAccum >>= 8;
          curBits -= 8;
        }
        if (packet > 0) flushPacket();
      }
    }

    writeByte(initCodeSize);
    output(clearCode);
    let ent = pixels[0];
    for (let idx = 1; idx < pixels.length; idx++) {
      const c = pixels[idx];
      const fcode = (c << BITS) + ent;
      let i = (c << hshift) ^ ent;
      if (htab[i] === fcode) {
        ent = codetab[i];
        continue;
      }
      const disp = i === 0 ? 1 : HSIZE - i;
      while (htab[i] >= 0) {
        i -= disp;
        if (i < 0) i += HSIZE;
        if (htab[i] === fcode) {
          ent = codetab[i];
          i = -1;
          break;
        }
      }
      if (i < 0) continue;
      output(ent);
      ent = c;
      if (freeEnt < 1 << BITS) {
        codetab[i] = freeEnt++;
        htab[i] = fcode;
      } else {
        htab.fill(-1);
        freeEnt = clearCode + 2;
        clearFlag = true;
        output(clearCode);
      }
    }
    output(ent);
    output(eoiCode);
    writeByte(0);
    return out;
  }

  function pushU16(bytes, value) {
    bytes.push(value & 255, (value >> 8) & 255);
  }

  function encodeGif(rgba, width, height) {
    const indexed = indexImage(rgba, width, height);
    const palette = indexed.palette;
    const tableBits = Math.max(Math.ceil(Math.log2(palette.length)), 1);
    const fields = (1 << 7) | (7 << 4) | (tableBits - 1);
    const bytes = [];
    for (const char of "GIF89a") bytes.push(char.charCodeAt(0));
    pushU16(bytes, width);
    pushU16(bytes, height);
    bytes.push(fields, 0, 0);
    for (let i = 0; i < (1 << tableBits); i++) {
      const color = palette[i] || [0, 0, 0];
      bytes.push(color[0], color[1], color[2]);
    }
    const transparent = indexed.transparentIndex >= 0;
    bytes.push(0x21, 0xf9, 4);
    bytes.push(transparent ? 0x09 : 0x00);
    pushU16(bytes, 0);
    bytes.push(transparent ? indexed.transparentIndex : 0, 0);
    bytes.push(0x2c);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, width);
    pushU16(bytes, height);
    bytes.push(0);
    const image = lzwImageData(indexed.indices);
    for (const value of image) bytes.push(value);
    bytes.push(0x3b);
    return new Uint8Array(bytes);
  }

  root.PixelScale = {
    MAX_EDGE,
    MAX_PIXELS,
    MESSAGES,
    FORMAT_LABEL,
    decimalRatio,
    parsePositive,
    outputSize,
    classify,
    downloadAction,
    formatCount,
    formatPair,
    formatScale,
    VIEW_STOPS,
    viewFactor,
    scaleImageData,
    encodeGif,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
