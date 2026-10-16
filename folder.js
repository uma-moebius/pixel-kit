(function (root) {
  // Folder drop helpers. Works with FileSystemEntry objects from
  // DataTransferItem.webkitGetAsEntry() and with webkitdirectory file lists.

  const SUPPORTED = /\.(png|jpe?g|webp|gif)$/i;

  function isHidden(path) {
    return String(path || "").split("/").some((part) => part.startsWith("."));
  }

  function isSupported(name) {
    return SUPPORTED.test(String(name || ""));
  }

  // Strips leading slashes and empty segments: "/a//b.png" -> "a/b.png".
  function cleanPath(path) {
    return String(path || "").split(/[\\/]/).filter(Boolean).join("/");
  }

  function keep(path) {
    return !isHidden(path) && isSupported(path);
  }

  function readAll(reader) {
    return new Promise((resolve, reject) => {
      const all = [];
      const next = () => {
        reader.readEntries((batch) => {
          if (!batch.length) resolve(all);
          else {
            all.push(...batch);
            next();
          }
        }, reject);
      };
      next();
    });
  }

  function fileOf(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  // Returns [{ file, path }] for supported, non-hidden images, sorted by path.
  async function collectEntries(entries) {
    const out = [];
    async function walk(entry, prefix) {
      if (!entry || entry.name.startsWith(".")) return;
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory) {
        const children = await readAll(entry.createReader());
        for (const child of children) await walk(child, path);
      } else if (entry.isFile && keep(path)) {
        try {
          out.push({ file: await fileOf(entry), path });
        } catch (error) {
          // Unreadable entries are skipped.
        }
      }
    }
    for (const entry of entries) await walk(entry, "");
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
  }

  // For <input webkitdirectory>: uses webkitRelativePath.
  function collectFileList(files) {
    return [...files]
      .map((file) => ({ file, path: cleanPath(file.webkitRelativePath || file.name) }))
      .filter((item) => keep(item.path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  root.PixelFolder = { isHidden, isSupported, cleanPath, readAll, collectEntries, collectFileList };
})(typeof globalThis !== "undefined" ? globalThis : this);
