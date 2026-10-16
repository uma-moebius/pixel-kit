import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const code = readFileSync(new URL("../folder.js", import.meta.url), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { isHidden, isSupported, cleanPath, collectEntries, collectFileList } = sandbox.PixelFolder;

const fileEntry = (name) => ({ name, isFile: true, isDirectory: false, file: (ok) => ok({ name }) });
// Returns children two at a time, like browsers that page readEntries.
const dirEntry = (name, children) => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader() {
    let i = 0;
    return { readEntries(ok) { const batch = children.slice(i, i + 2); i += 2; setTimeout(() => ok(batch)); } };
  },
});

test("filters by extension and hidden names", () => {
  assert.equal(isSupported("a.PNG"), true);
  assert.equal(isSupported("a.jpeg"), true);
  assert.equal(isSupported("a.txt"), false);
  assert.equal(isHidden(".DS_Store"), true);
  assert.equal(isHidden("a/.git/b.png"), true);
  assert.equal(isHidden("a/b.png"), false);
  assert.equal(cleanPath("/a//b\\c.png"), "a/b/c.png");
});

test("collectEntries walks nested folders and reads every page", async () => {
  const tree = [
    fileEntry("top.gif"),
    dirEntry("sprites", [
      fileEntry("b.png"), fileEntry(".DS_Store"), fileEntry("a.webp"),
      fileEntry("notes.txt"), dirEntry("sub", [fileEntry("c.jpg")]),
      dirEntry(".hidden", [fileEntry("x.png")]),
    ]),
  ];
  const got = await collectEntries(tree);
  assert.deepEqual([...got].map((item) => item.path), [
    "sprites/a.webp", "sprites/b.png", "sprites/sub/c.jpg", "top.gif",
  ]);
  assert.equal(got[0].file.name, "a.webp");
});

test("collectFileList uses webkitRelativePath", () => {
  const got = collectFileList([
    { name: "a.png", webkitRelativePath: "art/a.png" },
    { name: ".DS_Store", webkitRelativePath: "art/.DS_Store" },
    { name: "b.png", webkitRelativePath: "" },
  ]);
  assert.deepEqual([...got].map((item) => item.path), ["art/a.png", "b.png"]);
});
