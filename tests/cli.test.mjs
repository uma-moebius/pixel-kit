import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { decodePng, encodePng } = require("../lib/png.js");
const BIN = new URL("../bin/pixel-kit.js", import.meta.url).pathname;

function cli(args, cwd) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr, json: () => JSON.parse(result.stdout) };
}

function rgba(width, height, pixels) {
  return encodePng(new Uint8ClampedArray(pixels.flat()), width, height);
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const HALF_BLUE = [0, 0, 255, 128];
const CLEAR = [0, 0, 0, 0];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pixel-kit-test-"));
  mkdirSync(join(dir, "art", "sub"), { recursive: true });
  writeFileSync(join(dir, "art", "a.png"), rgba(2, 2, [RED, RED, HALF_BLUE, CLEAR]));
  writeFileSync(join(dir, "art", "sub", "b.png"), rgba(1, 1, [BLUE]));
  writeFileSync(join(dir, "art", ".hidden.png"), rgba(1, 1, [RED]));
  writeFileSync(join(dir, "art", "notes.txt"), "x");
  writeFileSync(join(dir, "art", "photo.jpg"), "not really");
  writeFileSync(join(dir, "map.json"), JSON.stringify({ "#ff0000": "#00ff00" }));
  return dir;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  return out; // CRC is not checked by the reader.
}

function rawPng(width, height, depth, colorType, rows, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  const raw = Buffer.concat(rows.map((row) => Buffer.from([0, ...row])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("png: RGBA round trip", () => {
  const png = rgba(2, 2, [RED, BLUE, HALF_BLUE, CLEAR]);
  const image = decodePng(png);
  assert.deepEqual([image.width, image.height], [2, 2]);
  assert.deepEqual([...image.data], [RED, BLUE, HALF_BLUE, CLEAR].flat());
});

test("png: 2-bit palette with transparency and 8-bit gray", () => {
  const plte = chunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]));
  const trns = chunk("tRNS", Buffer.from([0]));
  const pal = decodePng(rawPng(3, 1, 2, 3, [[0b00011000]], [plte, trns]));
  assert.deepEqual([...pal.data], [255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255]);
  const gray = decodePng(rawPng(2, 1, 8, 0, [[0, 200]]));
  assert.deepEqual([...gray.data], [0, 0, 0, 255, 200, 200, 200, 255]);
});

test("colors: counts across folders, skips hidden and non-images", () => {
  const dir = fixture();
  const r = cli(["colors", "art", "--json"], dir);
  const result = r.json();
  assert.equal(r.code, 1); // photo.jpg is reported as skipped
  assert.deepEqual(result.colors, [
    { hex: "#0000ff", count: 2 },
    { hex: "#ff0000", count: 2 },
  ]);
  assert.deepEqual(result.files.map((f) => [f.path, f.status]), [
    ["art/a.png", "ok"],
    ["art/photo.jpg", "skipped"],
    ["art/sub/b.png", "ok"],
  ]);
});

test("process: recolor then scale, keeps relative paths and alpha", () => {
  const dir = fixture();
  const r = cli(["process", "art/a.png", "art/sub", "--map", "map.json", "--scale", "2", "-o", "out", "--json"], dir);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json().summary.written, 2);
  const a = decodePng(readFileSync(join(dir, "out", "a.png")));
  assert.deepEqual([a.width, a.height], [4, 4]);
  assert.deepEqual([...a.data.slice(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual([...a.data.slice(32, 36)], HALF_BLUE);
  assert.deepEqual([...a.data.slice(60, 64)], CLEAR);
  assert.ok(existsSync(join(dir, "out", "sub", "b.png")));
});

test("recolor uses the web app's export format, including the array form", () => {
  const dir = fixture();
  writeFileSync(join(dir, "list.json"), JSON.stringify([{ from: "#F00", to: "#00F" }]));
  const r = cli(["recolor", "art/a.png", "--map", "list.json", "-o", "out", "--json"], dir);
  assert.equal(r.code, 0);
  assert.equal(r.json().files[0].replacedPixels, 2);
  assert.deepEqual([...decodePng(readFileSync(join(dir, "out", "a.png"))).data.slice(0, 4)], BLUE);
});

test("scale: --width and --height keep the aspect ratio", () => {
  const dir = fixture();
  const r = cli(["scale", "art/a.png", "--height", "6", "-o", "out", "--json"], dir);
  assert.equal(r.code, 0);
  assert.deepEqual([r.json().files[0].outWidth, r.json().files[0].outHeight], [6, 6]);
});

test("refuses to overwrite without --force; --dry-run writes nothing", () => {
  const dir = fixture();
  assert.equal(cli(["scale", "art", "--scale", "1", "-o", "out"], dir).code, 1);
  const again = cli(["scale", "art", "--scale", "1", "-o", "out", "--json"], dir);
  assert.equal(again.code, 4);
  assert.equal(again.json().summary.written, 0);
  assert.equal(cli(["scale", "art/a.png", "--scale", "1", "-o", "out", "--force"], dir).code, 0);
  const dry = cli(["scale", "art/a.png", "--scale", "3", "-o", "dry", "--dry-run", "--json"], dir);
  assert.equal(dry.code, 0);
  assert.equal(dry.json().files[0].status, "planned");
  assert.equal(existsSync(join(dir, "dry")), false);
});

test("stable exit codes for bad input", () => {
  const dir = fixture();
  assert.equal(cli(["nope"], dir).code, 2);
  assert.equal(cli(["scale", "art", "-o", "out"], dir).code, 2);
  assert.equal(cli(["scale", "art", "--scale", "2", "--width", "4", "-o", "out"], dir).code, 2);
  assert.equal(cli(["scale", "art", "--scale", "0", "-o", "out"], dir).code, 2);
  assert.equal(cli(["recolor", "art", "--map", "missing.json", "-o", "out"], dir).code, 3);
  writeFileSync(join(dir, "bad.json"), "{");
  assert.equal(cli(["recolor", "art", "--map", "bad.json", "-o", "out", "--json"], dir).json().exitCode, 3);
  assert.equal(cli(["colors", "missing-folder"], dir).code, 5);
  const r = cli(["scale", "--bogus"], dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /Unknown option/);
});

test("help and version", () => {
  for (const command of ["colors", "recolor", "scale", "process"]) {
    const r = cli([command, "--help"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /Usage: pixel-kit /);
  }
  assert.match(cli(["--version"]).out, /^\d+\.\d+\.\d+/);
});
