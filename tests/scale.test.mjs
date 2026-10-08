import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import vm from "node:vm";

const code = readFileSync(new URL("../scale.js", import.meta.url), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const {
  decimalRatio,
  parsePositive,
  outputSize,
  classify,
  downloadAction,
  scaleImageData,
  encodeGif,
  formatPair,
  formatScale,
  VIEW_STOPS,
  viewFactor,
  MESSAGES,
} = sandbox.PixelScale;

const scaleOf = (factor) => ({
  mode: "scale",
  edge: "width",
  scaleRatio: decimalRatio(String(factor)),
  pixelRatio: null,
});
const pixelsOf = (edge, pixel) => ({
  mode: "pixels",
  edge,
  scaleRatio: null,
  pixelRatio: decimalRatio(String(pixel)),
});

function file(partial) {
  return {
    name: "Sprite.PNG",
    format: "png",
    ready: true,
    readable: true,
    width: 16,
    height: 16,
    ...partial,
  };
}

test("view zoom runs from -10 to 10 with 1 at the center", () => {
  assert.equal(VIEW_STOPS.length, 19);
  assert.equal(VIEW_STOPS[0], -10);
  assert.equal(VIEW_STOPS[9], 1);
  assert.equal(VIEW_STOPS[18], 10);
  assert.equal(VIEW_STOPS.includes(0), false);
  assert.equal(VIEW_STOPS.includes(-1), false);
  assert.equal(viewFactor(1), 1);
  assert.equal(viewFactor(8), 8);
  assert.equal(viewFactor(-2), 0.5);
  assert.equal(viewFactor(-10), 0.1);
  assert.equal(viewFactor(0), 1);
});

test("scale 2 of the 16×16 sample is 32×32", () => {
  const size = outputSize(16, 16, scaleOf(2));
  assert.equal(size.ok, true);
  assert.equal(size.width, 32);
  assert.equal(size.height, 32);
});

test("round half up and do not snap the factor to an integer", () => {
  const half = outputSize(3, 1, scaleOf(0.5));
  assert.equal(half.width, 2);
  assert.equal(half.height, 1);
  const fraction = outputSize(100, 1, scaleOf(1.005));
  assert.equal(fraction.width, 101);
  const derived = outputSize(1200, 900, pixelsOf("width", 10));
  assert.equal(derived.width, 10);
  assert.equal(derived.height, 8);
});

test("pixel width 9000 of 1200×900 is over the side limit and still reports both edges", () => {
  const size = outputSize(1200, 900, pixelsOf("width", 9000));
  assert.equal(size.ok, false);
  assert.equal(size.code, "side");
  assert.equal(size.width, 9000);
  assert.equal(size.height, 6750);
});

test("8192 is allowed and 8193 is not; the pixel cap is exclusive", () => {
  assert.equal(outputSize(8192, 1, scaleOf(1)).ok, true);
  assert.equal(outputSize(8193, 1, scaleOf(1)).code, "side");
  assert.equal(outputSize(4096, 4096, scaleOf(1)).ok, true);
  assert.equal(outputSize(4097, 4096, scaleOf(1)).code, "total");
  assert.equal(outputSize(1, 1, scaleOf(0.4)).code, "small");
});

test("a blank or non-positive field is not a size", () => {
  assert.equal(parsePositive("2.5"), 2.5);
  assert.equal(parsePositive(".5"), 0.5);
  assert.equal(parsePositive("0"), null);
  assert.equal(parsePositive(""), null);
  assert.equal(parsePositive("2x"), null);
  assert.equal(outputSize(16, 16, scaleOf(null)).code, "number");
});

test("checks: format, name, size, then the first passing name wins", () => {
  const settings = scaleOf(2);
  const result = classify([
    file({ name: "Sprite.PNG" }),
    file({ name: "Sprite.PNG" }),
    file({ name: "a/b.png" }),
    file({ name: "icon.bmp", format: null }),
    file({ name: "big.png", width: 1200, height: 900 }),
    file({ name: "broken.gif", readable: false }),
    file({ name: "later.png", ready: false }),
  ], scaleOf(8));
  assert.deepEqual(result.map((item) => item.status), [
    "pass",
    "duplicate",
    "fail",
    "fail",
    "fail",
    "fail",
    "pending",
  ]);
  assert.equal(result[2].code, "name");
  assert.equal(result[3].code, "format");
  assert.equal(result[4].code, "side");
  assert.equal(result[5].code, "read");

  const kept = classify([
    file({ name: "bad.png", format: null }),
    file({ name: "bad.png" }),
    file({ name: "Sprite.PNG" }),
    file({ name: "Sprite.PNG" }),
  ], settings);
  assert.deepEqual(kept.map((item) => item.status), ["fail", "pass", "pass", "duplicate"]);
  assert.equal(MESSAGES[kept[3].code], "This name is already used. The first file is kept.");
});

test("download label follows the single-file and zip rules", () => {
  const empty = downloadAction([]);
  assert.equal(empty.label, "Download PNG");
  assert.equal(empty.enabled, false);
  assert.equal(downloadAction([{ status: "pass", format: "jpeg" }]).label, "Download JPEG");
  assert.equal(downloadAction([{ status: "pass", format: "webp" }]).label, "Download WebP");
  assert.equal(downloadAction([{ status: "pass", format: "gif" }]).label, "Download GIF");
  assert.equal(downloadAction([{ status: "fail", format: "png" }]).label, "Cannot download");
  assert.equal(downloadAction([
    { status: "pass", format: "png" },
    { status: "duplicate", format: "png" },
    { status: "fail", format: "png" },
  ]).label, "Cannot download");
  const zip = downloadAction([
    { status: "pass", format: "png" },
    { status: "duplicate", format: "png" },
    { status: "pass", format: "png" },
  ]);
  assert.equal(zip.label, "Download ZIP");
  assert.equal(zip.enabled, true);
  const pending = downloadAction([{ status: "pending", format: "png" }]);
  assert.equal(pending.enabled, false);
  assert.equal(pending.label, "Download PNG");
});

test("nearest neighbor uses one source pixel per block and clears transparent rgb", () => {
  const src = new Uint8ClampedArray([
    10, 20, 30, 255, 40, 50, 60, 255,
    1, 2, 3, 0, 7, 8, 9, 255,
  ]);
  const dst = new Uint8ClampedArray(8 * 4 * 4);
  scaleImageData(src, 2, 2, dst, 4, 4);
  assert.deepEqual([...dst.slice(0, 4)], [10, 20, 30, 255]);
  assert.deepEqual([...dst.slice(4, 8)], [10, 20, 30, 255]);
  assert.deepEqual([...dst.slice(8, 12)], [40, 50, 60, 255]);
  const clear = 2 * 4 * 4;
  assert.deepEqual([...dst.slice(clear, clear + 4)], [0, 0, 0, 0]);
  assert.equal(formatPair(9000, 6750, true), "9,000 \u00d7 6,750 px");
  assert.equal(formatPair(32, 32, false), "32 \u00d7 32");
  assert.equal(formatScale(7.5), "7.5");
  assert.equal(formatScale(2), "2");
});

function decodePng(data) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString("ascii", pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows = [];
  let i = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[i++];
    const row = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      if (filter === 1) row[x] = (row[x] + a) & 255;
      else if (filter === 2) row[x] = (row[x] + b) & 255;
      else if (filter === 3) row[x] = (row[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[x] = (row[x] + pr) & 255;
      }
    }
    prev = row;
    rows.push(row);
  }
  return { width, height, rows };
}

test("a gif round-trips through the system decoder", () => {
  const width = 64;
  const height = 48;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const transparent = x < 4 || y < 4;
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      rgba[i] = on ? 255 : 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = on ? 0 : 255;
      rgba[i + 3] = transparent ? 0 : 255;
    }
  }
  const gif = encodeGif(rgba, width, height);
  assert.equal(Buffer.from(gif.subarray(0, 6)).toString(), "GIF89a");
  writeFileSync("/tmp/pixel-scale-round.gif", gif);
  execFileSync("sips", ["-s", "format", "png", "/tmp/pixel-scale-round.gif", "--out", "/tmp/pixel-scale-round.png"], { stdio: "ignore" });
  const png = decodePng(readFileSync("/tmp/pixel-scale-round.png"));
  assert.equal(png.width, width);
  assert.equal(png.height, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const got = png.rows[y].subarray(x * 4, x * 4 + 4);
      if (rgba[i + 3] === 0) {
        assert.equal(got[3], 0, x + "," + y);
      } else {
        assert.equal(got[0], rgba[i], x + "," + y);
        assert.equal(got[1], rgba[i + 1]);
        assert.equal(got[2], rgba[i + 2]);
        assert.equal(got[3], 255);
      }
    }
  }
});
