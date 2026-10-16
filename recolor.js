(function (root) {
  // Exact-match recoloring for pixel art. Colors are compared on RGB only,
  // alpha is kept as is, and fully transparent pixels are never touched.

  function hex2(value) {
    return value.toString(16).padStart(2, "0");
  }

  function toHex(r, g, b) {
    return "#" + hex2(r) + hex2(g) + hex2(b);
  }

  function normalizeHex(text) {
    if (typeof text !== "string") return null;
    let value = text.trim().toLowerCase();
    if (value[0] !== "#") value = "#" + value;
    if (/^#[0-9a-f]{3}$/.test(value)) {
      value = "#" + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
    }
    return /^#[0-9a-f]{6}$/.test(value) ? value : null;
  }

  // images: array of { data } or raw RGBA arrays. Returns [{ hex, count }]
  // sorted by count (desc), then hex.
  function extractColors(images) {
    const counts = new Map();
    for (const image of images) {
      const data = image && image.data ? image.data : image;
      if (!data) continue;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const list = [];
    counts.forEach((count, key) => {
      list.push({ hex: toHex((key >> 16) & 255, (key >> 8) & 255, key & 255), count });
    });
    list.sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
    return list;
  }

  // Keeps only valid entries whose target differs from the source.
  function cleanMapping(mapping) {
    const out = {};
    if (!mapping || typeof mapping !== "object") return out;
    Object.keys(mapping).forEach((from) => {
      const a = normalizeHex(from);
      const b = normalizeHex(mapping[from]);
      if (a && b && a !== b) out[a] = b;
    });
    return out;
  }

  function isEmpty(mapping) {
    return Object.keys(cleanMapping(mapping)).length === 0;
  }

  // Returns a new Uint8ClampedArray; the source is not modified.
  function applyMapping(data, mapping) {
    const out = new Uint8ClampedArray(data);
    const clean = cleanMapping(mapping);
    const table = new Map();
    Object.keys(clean).forEach((from) => {
      table.set(parseInt(from.slice(1), 16), parseInt(clean[from].slice(1), 16));
    });
    if (!table.size) return out;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] === 0) continue;
      const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
      const target = table.get(key);
      if (target === undefined) continue;
      out[i] = (target >> 16) & 255;
      out[i + 1] = (target >> 8) & 255;
      out[i + 2] = target & 255;
    }
    return out;
  }

  function mappingKey(mapping) {
    const clean = cleanMapping(mapping);
    return Object.keys(clean).sort().map((k) => k + ">" + clean[k]).join(",");
  }

  function exportMapping(mapping) {
    return JSON.stringify(cleanMapping(mapping), null, 2) + "\n";
  }

  // Accepts {"#from":"#to"} or [{from,to}]. Throws on invalid JSON.
  function importMapping(text) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const obj = {};
      parsed.forEach((item) => {
        if (item && item.from) obj[item.from] = item.to;
      });
      return cleanMapping(obj);
    }
    if (parsed && typeof parsed === "object") return cleanMapping(parsed);
    throw new Error("mapping");
  }

  root.PixelRecolor = {
    toHex,
    normalizeHex,
    extractColors,
    cleanMapping,
    isEmpty,
    applyMapping,
    mappingKey,
    exportMapping,
    importMapping,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
