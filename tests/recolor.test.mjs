import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const code = readFileSync(new URL("../recolor.js", import.meta.url), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const {
  normalizeHex,
  extractColors,
  cleanMapping,
  isEmpty,
  applyMapping,
  mappingKey,
  exportMapping,
  importMapping,
} = sandbox.PixelRecolor;

const px = (...values) => new Uint8ClampedArray(values);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("normalizeHex accepts short, long, and missing #", () => {
  assert.equal(normalizeHex("#FFF"), "#ffffff");
  assert.equal(normalizeHex("ff6600"), "#ff6600");
  assert.equal(normalizeHex(" #Ab12Cd "), "#ab12cd");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex(null), null);
});

test("extractColors counts opaque and semi-transparent pixels across images", () => {
  const a = { data: px(255, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0) };
  const b = px(0, 255, 0, 255, 255, 0, 0, 255, 9, 9, 9, 0);
  assert.deepEqual(plain(extractColors([a, b])), [
    { hex: "#ff0000", count: 3 },
    { hex: "#00ff00", count: 1 },
  ]);
});

test("extractColors ignores fully transparent pixels and sorts ties by hex", () => {
  const data = px(0, 0, 2, 255, 0, 0, 1, 255, 5, 5, 5, 0);
  assert.deepEqual(plain(extractColors([data])).map((c) => c.hex), ["#000001", "#000002"]);
  assert.deepEqual(plain(extractColors([])), []);
});

test("applyMapping replaces exact matches and keeps alpha", () => {
  const data = px(255, 0, 0, 255, 255, 0, 0, 100, 254, 0, 0, 255);
  const out = applyMapping(data, { "#FF0000": "#00ff66" });
  assert.deepEqual([...out], [0, 255, 102, 255, 0, 255, 102, 100, 254, 0, 0, 255]);
  assert.deepEqual([...data], [255, 0, 0, 255, 255, 0, 0, 100, 254, 0, 0, 255]);
});

test("applyMapping leaves fully transparent pixels untouched", () => {
  const data = px(255, 0, 0, 0);
  assert.deepEqual([...applyMapping(data, { "#ff0000": "#00ff00" })], [255, 0, 0, 0]);
});

test("applyMapping does not chain mappings", () => {
  const data = px(1, 1, 1, 255, 2, 2, 2, 255);
  const out = applyMapping(data, { "#010101": "#020202", "#020202": "#030303" });
  assert.deepEqual([...out], [2, 2, 2, 255, 3, 3, 3, 255]);
});

test("empty or no-op mapping returns identical data", () => {
  const data = px(10, 20, 30, 255, 0, 0, 0, 0);
  assert.deepEqual([...applyMapping(data, {})], [...data]);
  assert.deepEqual([...applyMapping(data, { "#0a141e": "#0A141E" })], [...data]);
  assert.equal(isEmpty({ "#0a141e": "#0a141e", nope: "#000000" }), true);
  assert.equal(isEmpty({ "#000000": "#ffffff" }), false);
});

test("cleanMapping and mappingKey are order independent", () => {
  assert.deepEqual(plain(cleanMapping({ "FFF": "#000", "#x": "#000" })), { "#ffffff": "#000000" });
  assert.equal(
    mappingKey({ "#bbbbbb": "#000000", "#aaaaaa": "#111111" }),
    mappingKey({ "#aaaaaa": "#111111", "#bbbbbb": "#000000" }),
  );
});

test("export and import round-trip", () => {
  const mapping = { "#ff0000": "#00ff00", "#123456": "#654321" };
  assert.deepEqual(plain(importMapping(exportMapping(mapping))), mapping);
  assert.deepEqual(plain(importMapping('[{"from":"#F00","to":"#0F0"}]')), { "#ff0000": "#00ff00" });
  assert.throws(() => importMapping("not json"));
  assert.throws(() => importMapping("3"));
});
