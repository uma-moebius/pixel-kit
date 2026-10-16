(function () {
  const PS = globalThis.PixelScale;
  const PR = globalThis.PixelRecolor;
  const PF = globalThis.PixelFolder;
  const MAX_COLOR_ROWS = 512;
  const MAX_VISIBLE_TABS = 5;
  const PRESETS = ["1", "2", "3", "4", "8"];
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const $ = (id) => document.getElementById(id);

  // Mode registry. Add an entry here (plus a [data-mode] block in the
  // inspector) to add a new tool.
  const MODES = [
    { id: "scale", label: "Scale", key: "1", compare: false },
    { id: "colors", label: "Colors", key: "2", compare: true },
  ];

  const app = $("app");
  const preview = $("preview");
  const stage = $("stage");
  const empty = $("empty");
  const view = $("view");
  const beforeFig = $("before-fig");
  const beforeArt = $("before-art");
  const beforeImg = $("before-img");
  const afterArt = $("after-art");
  const previewImg = $("preview-img");
  const afterCap = $("after-cap");
  const popup = $("popup");
  const gauge = $("gauge");
  const gaugeFill = $("gauge-fill");
  const fileList = $("file-list");
  const downloadBtn = $("download");
  const downloadLabel = $("download-label");
  const downloadBtn2 = $("download-2");
  const scaleField = $("scale-field");
  const scaleInput = $("scale-input");
  const pixelBlock = $("pixel-block");
  const pixelField = $("pixel-field");
  const pixelInput = $("pixel-input");
  const derived = $("derived");
  const fileMenu = $("file-menu");
  const dropdown = $("dropdown");
  const colorList = $("color-list");
  const colorsNote = $("colors-note");
  const colorFilter = $("color-filter");
  const inspector = $("inspector");
  const dropzone = $("dropzone");

  const state = {
    files: [],
    selectedId: null,
    tool: "scale",
    mode: "scale",
    edge: "width",
    scaleText: "2",
    pixelText: "",
    view: 1,
    dismissed: "",
    memoryId: null,
    busy: false,
    progress: 0,
    mapping: {},
    bg: "checker",
    grid: false,
    compare: false,
    compareTouched: false,
    filter: "",
    collapsedDirs: new Set(),
    filesCollapsed: localStorage.getItem("pk.filesCollapsed") === "1",
    drawer: false,
    sheet: 0,
  };
  let seq = 0;
  let paletteSig = "";

  // ---------- model ----------

  function settings() {
    return {
      mode: state.mode,
      edge: state.edge,
      scaleRatio: PS.decimalRatio(state.scaleText),
      pixelRatio: PS.decimalRatio(state.pixelText),
    };
  }

  function selected() {
    return state.files.find((file) => file.id === state.selectedId) || null;
  }

  function rows() {
    const ranked = PS.classify(state.files, settings());
    return state.files.map((file, index) => {
      const row = ranked[index];
      if (state.memoryId === file.id) return { ...row, status: "fail", code: "memory" };
      return row;
    });
  }

  function detectFormat(file) {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const known = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif" };
    if (known[type]) return known[type];
    if (type.startsWith("image/")) return null;
    if (name.endsWith(".png")) return "png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg";
    if (name.endsWith(".webp")) return "webp";
    if (name.endsWith(".gif")) return "gif";
    return null;
  }

  function makeEntry(file, path) {
    const format = detectFormat(file);
    return {
      id: ++seq,
      file,
      name: file.name || "image",
      path: path && path.includes("/") ? path : "",
      format,
      url: format ? URL.createObjectURL(file) : "",
      bitmap: null,
      width: 0,
      height: 0,
      readable: false,
      ready: !format,
      pixels: null,
      recolorKey: "",
      recolorUrl: "",
    };
  }

  function release(entry) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    if (entry.bitmap) entry.bitmap.close();
  }

  function readPixels(entry) {
    const canvas = document.createElement("canvas");
    canvas.width = entry.width;
    canvas.height = entry.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(entry.bitmap, 0, 0);
    return context.getImageData(0, 0, entry.width, entry.height).data;
  }

  function hasMapping() {
    return !PR.isEmpty(state.mapping);
  }

  function changedCount() {
    return Object.keys(PR.cleanMapping(state.mapping)).length;
  }

  // URL of the image as it should be shown: the original, or a recolored copy.
  function displayUrl(entry) {
    if (!hasMapping() || !entry.pixels) return entry.url;
    const key = PR.mappingKey(state.mapping);
    if (entry.recolorKey !== key) {
      const canvas = document.createElement("canvas");
      canvas.width = entry.width;
      canvas.height = entry.height;
      const data = PR.applyMapping(entry.pixels, state.mapping);
      canvas.getContext("2d").putImageData(new ImageData(data, entry.width, entry.height), 0, 0);
      entry.recolorUrl = canvas.toDataURL("image/png");
      entry.recolorKey = key;
    }
    return entry.recolorUrl;
  }

  function prefillPixel(entry) {
    if (state.mode !== "pixels" || state.pixelText.trim() || !entry.readable) return;
    const size = PS.outputSize(entry.width, entry.height, {
      mode: "scale", edge: state.edge, scaleRatio: PS.decimalRatio(state.scaleText), pixelRatio: null,
    });
    if (!size.width) return;
    state.pixelText = String(state.edge === "height" ? size.height : size.width);
    pixelInput.value = state.pixelText;
  }

  async function decode(entry) {
    const id = entry.id;
    try {
      const bitmap = await createImageBitmap(entry.file, { imageOrientation: "from-image" });
      if (!state.files.some((file) => file.id === id)) {
        bitmap.close();
        return;
      }
      entry.bitmap = bitmap;
      entry.width = bitmap.width;
      entry.height = bitmap.height;
      entry.readable = bitmap.width > 0 && bitmap.height > 0;
      if (entry.readable) {
        try {
          entry.pixels = readPixels(entry);
        } catch (error) {
          entry.pixels = null;
        }
      }
    } catch (error) {
      if (!state.files.some((file) => file.id === id)) return;
      entry.readable = false;
    }
    entry.ready = true;
    prefillPixel(entry);
    if (state.autoFit && entry.id === state.selectedId) {
      state.autoFit = false;
      requestAnimationFrame(fit);
    }
    render();
  }

  // list: Files, or { file, path } items from a folder.
  function addFiles(list, replace) {
    const incoming = [...list].map((item) => (item instanceof Blob ? { file: item, path: "" } : item));
    if (!incoming.length || state.busy) return;
    state.memoryId = null;
    state.dismissed = "";
    if (!state.files.length) state.autoFit = true;
    if (replace) {
      const index = state.files.findIndex((file) => file.id === state.selectedId);
      if (index < 0) return;
      const created = makeEntry(incoming[0].file, state.files[index].path ? dirOf(state.files[index].path) + incoming[0].file.name : "");
      release(state.files[index]);
      state.files[index] = created;
      state.selectedId = created.id;
      if (created.format) decode(created);
    } else {
      const created = incoming.map((item) => makeEntry(item.file, item.path));
      state.files.push(...created);
      state.selectedId = created[0].id;
      created.forEach((entry) => {
        if (entry.format) decode(entry);
      });
    }
    render();
  }

  function dirOf(path) {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index + 1);
  }

  function deleteFile(id) {
    if (state.busy) return;
    const index = state.files.findIndex((file) => file.id === id);
    if (index < 0) return;
    release(state.files[index]);
    state.files.splice(index, 1);
    if (state.selectedId === id) {
      const next = state.files[index] || state.files[index - 1] || null;
      state.selectedId = next ? next.id : null;
    }
    if (state.memoryId === id) state.memoryId = null;
    state.dismissed = "";
    closeMenus();
    render();
  }

  function clearAll() {
    if (state.busy || !state.files.length) return;
    if (!confirm("Remove all " + state.files.length + " files?")) return;
    state.files.forEach(release);
    state.files = [];
    state.selectedId = null;
    state.memoryId = null;
    state.dismissed = "";
    render();
  }

  function moveSelection(delta) {
    if (!state.files.length) return;
    const order = visibleOrder();
    if (!order.length) return;
    const index = order.findIndex((file) => file.id === state.selectedId);
    const next = order[Math.max(0, Math.min(order.length - 1, index < 0 ? 0 : index + delta))];
    state.selectedId = next.id;
    state.dismissed = "";
    render();
  }

  // ---------- size controls ----------

  function edgeValue(size) {
    return state.edge === "height" ? size.height : size.width;
  }

  function switchMode(mode) {
    if (mode === state.mode || state.busy) return;
    const current = selected();
    if (mode === "pixels" && current && current.readable) {
      const size = PS.outputSize(current.width, current.height, {
        mode: "scale", edge: state.edge, scaleRatio: PS.decimalRatio(state.scaleText), pixelRatio: null,
      });
      if (size.width) state.pixelText = String(edgeValue(size));
    }
    if (mode === "scale" && current && current.readable) {
      const ratio = PS.decimalRatio(state.pixelText);
      const src = state.edge === "height" ? current.height : current.width;
      if (ratio && src) state.scaleText = PS.formatScale((ratio.numer / ratio.denom) / src);
    }
    state.mode = mode;
    state.memoryId = null;
    render();
    if (mode === "pixels") pixelInput.value = state.pixelText;
    else scaleInput.value = state.scaleText;
  }

  function switchEdge(edge) {
    if (edge === state.edge || state.busy) return;
    const current = selected();
    if (current && current.readable) {
      const size = PS.outputSize(current.width, current.height, settings());
      if (size.width) state.pixelText = String(edge === "height" ? size.height : size.width);
    }
    state.edge = edge;
    state.memoryId = null;
    render();
    pixelInput.value = state.pixelText;
  }

  function applyPreset(value) {
    if (state.busy) return;
    if (state.mode !== "scale") switchMode("scale");
    state.scaleText = value;
    scaleInput.value = value;
    state.memoryId = null;
    render();
  }

  // ---------- tools (tabs) ----------

  function setTool(id) {
    if (!MODES.some((mode) => mode.id === id)) return;
    state.tool = id;
    const mode = MODES.find((item) => item.id === id);
    if (!state.compareTouched) state.compare = mode.compare;
    closeMenus();
    render();
  }

  function renderTabs() {
    const tabs = $("tabs");
    const visible = MODES.length > MAX_VISIBLE_TABS + 1 ? MODES.slice(0, MAX_VISIBLE_TABS) : MODES.slice();
    const active = MODES.find((mode) => mode.id === state.tool);
    if (!visible.includes(active)) visible[visible.length - 1] = active;
    const hidden = MODES.filter((mode) => !visible.includes(mode));
    const sig = visible.map((mode) => mode.id).join(",") + "|" + hidden.length;
    if (tabs.dataset.sig !== sig) {
      tabs.dataset.sig = sig;
      tabs.replaceChildren();
      visible.forEach((mode) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "tab";
        tab.id = "tab-" + mode.id;
        tab.dataset.tool = mode.id;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "inspector-panel");
        tab.append(mode.label + " ");
        const kbd = document.createElement("kbd");
        kbd.textContent = mode.key;
        tab.append(kbd);
        tab.addEventListener("click", () => setTool(mode.id));
        tabs.append(tab);
      });
      if (hidden.length) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "tab more";
        more.textContent = "\u22ef";
        more.setAttribute("aria-haspopup", "menu");
        more.setAttribute("aria-label", "More tools");
        more.addEventListener("click", () => openMenu("more", more));
        tabs.append(more);
      }
    }
    tabs.querySelectorAll(".tab[data-tool]").forEach((tab) => {
      const on = tab.dataset.tool === state.tool;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
  }

  $("tabs").addEventListener("keydown", (event) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = MODES.findIndex((mode) => mode.id === state.tool);
    const step = keys[event.key];
    const next = step === -Infinity ? 0 : step === Infinity ? MODES.length - 1 : (index + step + MODES.length) % MODES.length;
    setTool(MODES[next].id);
    const tab = $("tab-" + MODES[next].id);
    if (tab) tab.focus();
  });

  // ---------- zoom ----------

  function zoomBy(delta) {
    const index = PS.VIEW_STOPS.indexOf(state.view);
    const next = Math.max(0, Math.min(PS.VIEW_STOPS.length - 1, index + delta));
    state.view = PS.VIEW_STOPS[next];
    render();
  }

  function fit() {
    const current = selected();
    const row = currentRow();
    if (!current || !row || !row.width) return;
    const columns = state.compare ? 2 : 1;
    const vertical = window.matchMedia("(max-width: 640px)").matches;
    const availW = stage.clientWidth - 48 - (state.compare && !vertical ? 28 : 0);
    const availH = stage.clientHeight - (vertical ? Math.max(0, inspector.offsetHeight - 72) : 0) - 56 - 24 - 24 - (state.compare && vertical ? 16 + 40 : 0);
    const w = vertical ? availW : availW / columns;
    const h = vertical && state.compare ? availH / 2 : availH;
    let best = PS.VIEW_STOPS[0];
    PS.VIEW_STOPS.forEach((stop) => {
      const factor = PS.viewFactor(stop);
      if (row.width * factor <= w && row.height * factor <= h) best = stop;
    });
    state.view = best;
    render();
  }

  // ---------- menus ----------

  const mod = (key) => (IS_MAC ? "\u2318" + key : "Ctrl+" + key);
  const shiftMod = (key) => (IS_MAC ? "\u21e7\u2318" + key : "Ctrl+Shift+" + key);

  function menuItems(name) {
    const hasFile = Boolean(selected());
    const has = state.files.length > 0;
    const action = currentAction();
    if (name === "file") {
      return [
        { label: "Open files\u2026", key: mod("O"), run: () => $("pick").click() },
        { label: "Open folder\u2026", key: shiftMod("O"), run: () => $("folder-pick").click() },
        "-",
        { label: "Download", key: mod("S"), run: download, disabled: !action.enabled || state.busy },
        "-",
        { label: "Import palette\u2026", run: () => $("colors-pick").click() },
        { label: "Export palette", run: exportPalette, disabled: !changedCount() },
        "-",
        { label: "Remove selected file", key: IS_MAC ? "\u232b" : "Del", run: () => deleteFile(state.selectedId), disabled: !hasFile },
        { label: "Clear all files", key: IS_MAC ? "\u21e7\u2318\u232b" : "Ctrl+Shift+Del", run: clearAll, disabled: !has },
      ];
    }
    if (name === "edit") {
      return [
        { label: "Reset colors", run: resetColors, disabled: !changedCount() },
        { label: "Replace selected file\u2026", run: () => $("replace-pick").click(), disabled: !hasFile },
        "-",
        { label: "Select next file", key: "\u2193", run: () => moveSelection(1), disabled: !has },
        { label: "Select previous file", key: "\u2191", run: () => moveSelection(-1), disabled: !has },
      ];
    }
    if (name === "view") {
      const bg = (id, label) => ({ label, check: state.bg === id, run: () => setBg(id) });
      return [
        { label: "Zoom in", key: "+", run: () => zoomBy(1) },
        { label: "Zoom out", key: "\u2212", run: () => zoomBy(-1) },
        { label: "Fit", key: "0", run: fit, disabled: !hasFile },
        { label: "Actual size", key: "1\u00d7", run: () => { state.view = 1; render(); } },
        "-",
        { group: "Background" },
        bg("checker", "Checker"), bg("white", "White"), bg("gray", "Gray"), bg("dark", "Dark"),
        "-",
        { label: "Pixel grid", key: "G", check: state.grid, run: toggleGrid },
        { label: "Before/After", key: "B", check: state.compare, run: toggleCompare },
        { label: "Toggle files pane", key: IS_MAC ? "\u2318\\" : "Ctrl+\\", run: toggleFiles },
      ];
    }
    if (name === "all") {
      return [{ group: "File" }, ...menuItems("file"), "-", { group: "Edit" }, ...menuItems("edit"), "-", { group: "View" }, ...menuItems("view")];
    }
    if (name === "more") {
      return MODES.map((mode) => ({ label: mode.label, key: mode.key, check: mode.id === state.tool, run: () => setTool(mode.id) }));
    }
    return [];
  }

  let openMenuName = null;
  let menuOpener = null;

  function openMenu(name, opener) {
    closeMenus();
    openMenuName = name;
    menuOpener = opener;
    dropdown.replaceChildren();
    menuItems(name).forEach((item) => {
      if (item === "-") {
        dropdown.append(document.createElement("hr"));
        return;
      }
      if (item.group) {
        const group = document.createElement("div");
        group.className = "group";
        group.textContent = item.group;
        dropdown.append(group);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", item.check === undefined ? "menuitem" : "menuitemcheckbox");
      if (item.check !== undefined) button.setAttribute("aria-checked", item.check ? "true" : "false");
      if (item.disabled) button.setAttribute("aria-disabled", "true");
      const label = document.createElement("span");
      label.textContent = item.label;
      const key = document.createElement("span");
      key.textContent = item.key || "";
      button.append(label, key);
      button.addEventListener("click", () => {
        if (item.disabled) return;
        closeMenus(true);
        item.run();
      });
      dropdown.append(button);
    });
    dropdown.hidden = false;
    const rect = opener.getBoundingClientRect();
    const width = dropdown.offsetWidth;
    dropdown.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px";
    dropdown.style.top = (rect.bottom + 4) + "px";
    dropdown.style.maxHeight = (window.innerHeight - rect.bottom - 16) + "px";
    dropdown.style.overflow = "auto";
    opener.setAttribute("aria-expanded", "true");
    const first = dropdown.querySelector("button:not([aria-disabled])");
    if (first) first.focus();
  }

  function closeMenus(restoreFocus) {
    if (!dropdown.hidden) {
      dropdown.hidden = true;
      if (menuOpener) {
        menuOpener.setAttribute("aria-expanded", "false");
        if (restoreFocus) menuOpener.focus();
      }
    }
    openMenuName = null;
    fileMenu.hidden = true;
    delete fileMenu.dataset.id;
  }

  const menuButtons = [...document.querySelectorAll("#menus .mbtn")];
  menuButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      if (openMenuName === button.dataset.menu) closeMenus();
      else openMenu(button.dataset.menu, button);
    });
    button.addEventListener("mouseenter", () => {
      if (openMenuName && openMenuName !== button.dataset.menu && menuButtons.some((b) => b.dataset.menu === openMenuName)) {
        openMenu(button.dataset.menu, button);
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const next = menuButtons[(index + (event.key === "ArrowRight" ? 1 : -1) + menuButtons.length) % menuButtons.length];
        next.focus();
        if (openMenuName) openMenu(next.dataset.menu, next);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        openMenu(button.dataset.menu, button);
      }
    });
  });
  $("burger").addEventListener("click", (event) => {
    if (openMenuName === "all") closeMenus();
    else openMenu("all", event.currentTarget);
  });

  dropdown.addEventListener("keydown", (event) => {
    const items = [...dropdown.querySelectorAll("button:not([aria-disabled])")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      if (next) next.focus();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const at = menuButtons.findIndex((b) => b.dataset.menu === openMenuName);
      if (at < 0) return;
      event.preventDefault();
      const next = menuButtons[(at + (event.key === "ArrowRight" ? 1 : -1) + menuButtons.length) % menuButtons.length];
      openMenu(next.dataset.menu, next);
    } else if (event.key === "Tab") {
      closeMenus();
    }
  });

  // ---------- colors ----------

  function setTarget(from, to) {
    const value = PR.normalizeHex(to);
    if (!value) return false;
    const next = { ...state.mapping };
    if (value === from) delete next[from];
    else next[from] = value;
    state.mapping = next;
    state.memoryId = null;
    render();
    return true;
  }

  function resetColors() {
    if (state.busy) return;
    state.mapping = {};
    render();
  }

  function exportPalette() {
    if (!changedCount()) return;
    saveBlob(new Blob([PR.exportMapping(state.mapping)], { type: "application/json" }), "colors.json");
  }

  function allColors() {
    return PR.extractColors(state.files.filter((file) => file.pixels).map((file) => file.pixels));
  }

  function renderColors(colors) {
    const shown = colors.slice(0, MAX_COLOR_ROWS);
    const sig = shown.map((c) => c.hex + ":" + c.count).join(",");
    if (sig !== paletteSig) {
      paletteSig = sig;
      colorList.replaceChildren();
      shown.forEach((color) => {
        const row = document.createElement("div");
        row.className = "color-row";
        row.dataset.hex = color.hex;
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = color.hex;
        const hex = document.createElement("span");
        hex.className = "color-hex";
        hex.textContent = color.hex;
        const count = document.createElement("span");
        count.className = "color-count";
        count.textContent = PS.formatCount(color.count);
        const arrow = document.createElement("span");
        arrow.className = "color-arrow";
        arrow.textContent = "\u2192";
        const picker = document.createElement("input");
        picker.type = "color";
        picker.className = "color-pick";
        picker.setAttribute("aria-label", "Target for " + color.hex);
        const text = document.createElement("input");
        text.className = "color-text";
        text.autocomplete = "off";
        text.spellcheck = false;
        text.setAttribute("aria-label", "Target hex for " + color.hex);
        picker.addEventListener("input", () => {
          if (state.busy) return;
          setTarget(color.hex, picker.value);
        });
        text.addEventListener("change", () => {
          if (state.busy || !setTarget(color.hex, text.value)) text.value = state.mapping[color.hex] || color.hex;
        });
        text.addEventListener("keydown", (event) => {
          if (event.key === "Enter") text.blur();
        });
        row.append(swatch, hex, count, arrow, picker, text);
        colorList.append(row);
      });
    }
    const filter = state.filter.trim().toLowerCase().replace(/^#/, "");
    colorList.querySelectorAll(".color-row").forEach((row) => {
      const from = row.dataset.hex;
      const target = state.mapping[from] || from;
      const picker = row.querySelector(".color-pick");
      const text = row.querySelector(".color-text");
      if (picker.value !== target) picker.value = target;
      if (document.activeElement !== text && text.value !== target) text.value = target;
      row.classList.toggle("changed", Boolean(state.mapping[from]));
      row.hidden = Boolean(filter) && !from.includes(filter) && !target.includes(filter);
    });
    const changed = changedCount();
    let note = PS.formatCount(colors.length);
    if (changed) note += " \u00b7 " + changed + " changed";
    if (colors.length > shown.length) note += " \u00b7 first " + MAX_COLOR_ROWS;
    colorsNote.textContent = note;
    $("colors-reset").disabled = state.busy || !changed;
    $("colors-export").disabled = state.busy || !changed;
    $("colors-import").disabled = state.busy;
  }

  // ---------- view toggles ----------

  function setBg(id) {
    state.bg = id;
    render();
  }

  function toggleGrid() {
    state.grid = !state.grid;
    render();
  }

  function toggleCompare() {
    state.compare = !state.compare;
    state.compareTouched = true;
    render();
  }

  function toggleFiles() {
    if (window.matchMedia("(max-width: 1024px)").matches) {
      setDrawer(!state.drawer);
      return;
    }
    state.filesCollapsed = !state.filesCollapsed;
    localStorage.setItem("pk.filesCollapsed", state.filesCollapsed ? "1" : "0");
    render();
  }

  let drawerReturn = null;
  function setDrawer(open) {
    state.drawer = open;
    if (open) drawerReturn = document.activeElement;
    render();
    if (open) fileList.focus();
    else if (drawerReturn && drawerReturn.focus) drawerReturn.focus();
  }

  // ---------- render ----------

  function currentAction() {
    const ranked = rows();
    return PS.downloadAction(ranked.map((row, index) => ({ status: row.status, format: state.files[index].format })));
  }

  function currentRow() {
    const ranked = rows();
    return ranked.find((row, index) => state.files[index].id === state.selectedId) || null;
  }

  function visibleOrder() {
    return groups().flatMap((group) => (group.dir && state.collapsedDirs.has(group.dir) ? [] : group.files));
  }

  // Groups files by folder, in order of first appearance.
  function groups() {
    const map = new Map();
    state.files.forEach((file) => {
      const dir = file.path ? dirOf(file.path) : "";
      if (!map.has(dir)) map.set(dir, { dir, files: [] });
      map.get(dir).files.push(file);
    });
    return [...map.values()];
  }

  const STATUS_TEXT = { pass: "OK", duplicate: "Duplicate", fail: "Error", pending: "Loading" };

  function renderFiles(ranked) {
    const byId = new Map(state.files.map((file, index) => [file.id, ranked[index]]));
    fileList.replaceChildren();
    if (!state.files.length) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.innerHTML = "No files yet.<br>Drop images or a folder anywhere.";
      fileList.append(hint);
    }
    groups().forEach((group) => {
      const collapsed = group.dir && state.collapsedDirs.has(group.dir);
      if (group.dir) {
        const head = document.createElement("button");
        head.type = "button";
        head.className = "row dir";
        head.setAttribute("role", "treeitem");
        head.setAttribute("aria-expanded", collapsed ? "false" : "true");
        head.tabIndex = -1;
        const caret = document.createElement("span");
        caret.textContent = collapsed ? "\u25b8" : "\u25be";
        const name = document.createElement("span");
        name.className = "row-name";
        name.textContent = group.dir;
        const count = document.createElement("span");
        count.className = "row-size";
        count.textContent = String(group.files.length);
        head.append(caret, name, count);
        head.addEventListener("click", () => {
          if (collapsed) state.collapsedDirs.delete(group.dir);
          else state.collapsedDirs.add(group.dir);
          render();
        });
        fileList.append(head);
      }
      if (collapsed) return;
      group.files.forEach((file) => {
        const row = byId.get(file.id);
        const button = document.createElement("button");
        button.type = "button";
        const isSel = file.id === state.selectedId;
        button.className = "row" + (group.dir ? " ind" : "") + (isSel ? " selected" : "") + (row.status === "fail" ? " failed" : "");
        button.setAttribute("role", "treeitem");
        button.setAttribute("aria-selected", isSel ? "true" : "false");
        button.tabIndex = -1;
        button.dataset.id = String(file.id);
        const label = file.name + ", " + (STATUS_TEXT[row.status] || row.status).toLowerCase();
        button.setAttribute("aria-label", label);
        button.title = row.code ? PS.MESSAGES[row.code] : file.path || file.name;
        const dot = document.createElement("span");
        dot.className = "dot " + row.status;
        const thumb = document.createElement("img");
        thumb.className = "thumb";
        thumb.alt = "";
        if (file.bitmap) thumb.src = displayUrl(file);
        else thumb.style.visibility = "hidden";
        const name = document.createElement("span");
        name.className = "row-name";
        name.textContent = file.name;
        const size = document.createElement("span");
        size.className = "row-size";
        size.textContent = file.readable && row.status !== "fail" ? PS.formatPair(file.width, file.height, false) : "\u2014";
        button.append(dot, thumb, name, size);
        button.addEventListener("click", () => {
          state.selectedId = file.id;
          state.dismissed = "";
          render();
          fileList.focus();
        });
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          if (state.busy) return;
          state.selectedId = file.id;
          render();
          openFileMenu(file.id, event.clientX, event.clientY);
        });
        fileList.append(button);
      });
    });
  }

  function render() {
    const current = selected();
    const ranked = rows();
    const row = ranked.find((item, index) => state.files[index].id === state.selectedId) || null;
    const action = PS.downloadAction(ranked.map((item, index) => ({ status: item.status, format: state.files[index].format })));
    const hasFiles = state.files.length > 0;
    const colors = allColors();
    const changed = changedCount();

    app.classList.toggle("is-empty", !hasFiles);
    app.classList.toggle("files-collapsed", state.filesCollapsed);
    app.classList.toggle("drawer-open", state.drawer);
    $("scrim").hidden = !state.drawer;

    renderTabs();
    const tool = MODES.find((mode) => mode.id === state.tool);
    $("inspector-title").textContent = tool.label;
    const activeTab = $("tab-" + tool.id);
    if (activeTab) $("inspector-panel").setAttribute("aria-labelledby", activeTab.id);
    document.querySelectorAll("[data-mode]").forEach((block) => {
      block.hidden = block.dataset.mode !== state.tool;
    });

    // zoom
    const viewLabel = state.view + "\u00d7";
    $("view-value").textContent = hasFiles ? viewLabel : "\u2014";
    $("m-zoom").textContent = hasFiles ? viewLabel : "\u2014";

    // stage
    empty.hidden = hasFiles;
    $("float").hidden = !hasFiles;
    stage.className = "stage bg-" + state.bg;
    document.querySelectorAll("[data-bg]").forEach((swatch) => {
      swatch.setAttribute("role", "radio");
      swatch.setAttribute("aria-checked", swatch.dataset.bg === state.bg ? "true" : "false");
    });
    $("grid-toggle").setAttribute("aria-pressed", state.grid ? "true" : "false");
    $("compare-toggle").setAttribute("aria-pressed", state.compare ? "true" : "false");

    const showImage = current && current.bitmap && row && (row.status === "pass" || row.status === "duplicate");
    view.hidden = !showImage;
    if (showImage && row.width && row.height) {
      const factor = PS.viewFactor(state.view);
      const w = row.width * factor;
      const h = row.height * factor;
      const src = displayUrl(current);
      if (previewImg.getAttribute("src") !== src) previewImg.src = src;
      previewImg.style.width = w + "px";
      previewImg.style.height = h + "px";
      beforeFig.hidden = !state.compare;
      afterCap.hidden = !state.compare;
      if (state.compare) {
        if (beforeImg.getAttribute("src") !== current.url) beforeImg.src = current.url;
        beforeImg.style.width = w + "px";
        beforeImg.style.height = h + "px";
        afterCap.textContent = "After" + (changed ? " \u00b7 " + changed + (changed === 1 ? " color" : " colors") + " replaced" : "");
      }
      const cell = (row.width / current.width) * factor;
      [beforeArt, afterArt].forEach((art) => {
        art.classList.toggle("grid", state.grid && cell >= 4);
        art.style.setProperty("--cell", cell + "px");
      });
    }

    // popup
    const code = row && row.code;
    const key = current && code ? current.id + ":" + code : "";
    const showPopup = Boolean(code && key !== state.dismissed && !state.busy);
    popup.hidden = !showPopup;
    popup.classList.toggle("warn", code === "duplicate");
    if (showPopup) {
      $("popup-name").textContent = current.name;
      $("popup-message").textContent = PS.MESSAGES[code];
    }

    // status bar
    const statusText = $("status-text");
    statusText.replaceChildren();
    if (current) {
      const parts = [];
      if (current.readable) parts.push(["in", PS.formatPair(current.width, current.height, false)]);
      if (row && row.width > 0 && row.height > 0 && row.code !== "number") parts.push(["out", PS.formatPair(row.width, row.height, false)]);
      if (current.pixels) parts.push(["colors", PS.formatCount(PR.extractColors([current.pixels]).length)]);
      parts.forEach(([label, value], index) => {
        if (index) statusText.append("  \u00b7  ");
        const b = document.createElement("b");
        b.textContent = value;
        statusText.append(label + " ", b);
      });
      if (!parts.length) statusText.textContent = "\u2014";
    } else {
      statusText.textContent = "No file";
    }
    $("status-name").textContent = current ? (current.path || current.name) : "";
    $("m-name").textContent = current ? current.name : "No file";
    gauge.hidden = !state.busy;
    gaugeFill.style.width = Math.round(state.progress * 100) + "%";

    // files pane
    const fails = ranked.filter((item) => item.status === "fail").length;
    const count = $("file-count");
    count.replaceChildren(String(state.files.length));
    if (fails) {
      const bad = document.createElement("span");
      bad.className = "bad";
      bad.textContent = fails + " \u2715";
      count.append(" \u00b7 ", bad);
    }
    $("files-open-count").textContent = String(state.files.length);
    $("m-files-count").textContent = String(state.files.length);
    renderFiles(ranked);

    // scale inspector
    $("mode-scale").setAttribute("aria-pressed", state.mode === "scale" ? "true" : "false");
    $("mode-pixels").setAttribute("aria-pressed", state.mode === "pixels" ? "true" : "false");
    $("edge-width").setAttribute("aria-pressed", state.edge === "width" ? "true" : "false");
    $("edge-height").setAttribute("aria-pressed", state.edge === "height" ? "true" : "false");
    scaleField.hidden = state.mode !== "scale";
    pixelBlock.hidden = state.mode !== "pixels";
    pixelInput.setAttribute("aria-label", state.edge === "height" ? "Height" : "Width");
    if (document.activeElement !== scaleInput && scaleInput.value !== state.scaleText) scaleInput.value = state.scaleText;
    if (document.activeElement !== pixelInput && pixelInput.value !== state.pixelText) pixelInput.value = state.pixelText;
    const bad = code === "number" || code === "small" || code === "side" || code === "total";
    scaleField.classList.toggle("bad", state.mode === "scale" && bad);
    pixelField.classList.toggle("bad", state.mode === "pixels" && bad);
    const other = state.edge === "width" ? "Height" : "Width";
    const otherValue = row && (state.edge === "width" ? row.height : row.width);
    const showDerived = state.mode === "pixels" && row && row.width > 0 && row.height > 0;
    derived.hidden = !showDerived;
    if (showDerived) derived.textContent = other + " " + PS.formatCount(otherValue) + " px";
    $("presets").querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", state.mode === "scale" && state.scaleText.trim() === button.dataset.value ? "true" : "false");
    });
    $("selected-sec").hidden = !current;
    if (current) {
      $("sel-name").textContent = current.name;
      $("sel-name").title = current.path || current.name;
      $("sel-in").textContent = current.readable ? PS.formatPair(current.width, current.height, false) : "\u2014";
      $("sel-out").textContent = row && row.width > 0 && row.height > 0 && row.code !== "number" ? PS.formatPair(row.width, row.height, false) : "\u2014";
      const status = $("sel-status");
      status.textContent = STATUS_TEXT[row.status] || row.status;
      status.className = row.status === "pass" ? "ok" : row.status === "duplicate" ? "warn" : row.status === "fail" ? "err" : "";
      status.title = row.code ? PS.MESSAGES[row.code] : "";
    }

    renderColors(colors);

    // output + download
    const passing = ranked.filter((item) => item.status === "pass").length;
    const dups = ranked.filter((item) => item.status === "duplicate").length;
    $("out-format").textContent = action.kind === "zip" ? formatsOf(ranked) : current && current.format ? PS.FORMAT_LABEL[current.format] : "\u2014";
    $("out-files").textContent = !hasFiles ? "\u2014" : action.kind === "zip" ? passing + " \u2192 ZIP" : "1";
    let sizeText = "\u2014";
    if (state.tool === "colors") sizeText = changed ? changed + (changed === 1 ? " color" : " colors") + " replaced" : "No changes";
    else {
      const scalePart = state.mode === "scale" ? "\u00d7" + (state.scaleText.trim() || "?") : (state.edge === "width" ? "W " : "H ") + (state.pixelText.trim() || "?") + " px";
      sizeText = scalePart + (row && row.width > 0 && row.code !== "number" ? " \u00b7 " + PS.formatPair(row.width, row.height, false) : "");
    }
    $("out-size").textContent = sizeText;

    let label2 = action.kind === "zip" ? "Download ZIP (" + passing + ")" : action.enabled ? action.label : hasFiles ? action.label : "Download";
    let label1 = "Download";
    if (state.busy) {
      label1 = label2 = "Exporting\u2026 " + Math.round(state.progress * 100) + "%";
    }
    downloadLabel.textContent = label1;
    downloadBtn2.textContent = label2;
    downloadBtn.disabled = state.busy || !action.enabled;
    downloadBtn2.disabled = state.busy || !action.enabled;
    $("out-note").textContent = outputNote(ranked, action, passing, dups, fails);
  }

  function formatsOf(ranked) {
    const set = new Set();
    ranked.forEach((item, index) => {
      if (item.status === "pass") set.add(PS.FORMAT_LABEL[state.files[index].format]);
    });
    return [...set].join(", ") || "\u2014";
  }

  // Matches download(): a ZIP holds only files whose status is "pass";
  // errors and duplicate names are left out.
  function outputNote(ranked, action, passing, dups, fails) {
    if (!state.files.length) return "Add files to enable download";
    if (action.kind === "pending") return "Loading\u2026";
    const skipped = [];
    if (fails) skipped.push(fails + (fails === 1 ? " error" : " errors"));
    if (dups) skipped.push(dups + (dups === 1 ? " duplicate" : " duplicates"));
    if (!action.enabled) {
      if (state.files.length > 1 && passing < 2) return "A ZIP needs at least 2 valid files";
      return "Fix the error to download";
    }
    const summary = action.kind === "zip" ? passing + " files \u2192 ZIP" : "1 file";
    return skipped.length ? summary + " \u00b7 " + skipped.join(" and ") + " skipped" : summary;
  }

  // ---------- download ----------

  function saveBlob(blob, name) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function rasterize(entry, size, onProgress) {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = entry.width;
    sourceCanvas.height = entry.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.drawImage(entry.bitmap, 0, 0);
    const raw = sourceContext.getImageData(0, 0, entry.width, entry.height).data;
    const source = hasMapping() ? PR.applyMapping(raw, state.mapping) : raw;
    const destination = new Uint8ClampedArray(size.width * size.height * 4);
    const step = 48;
    for (let y = 0; y < size.height; y += step) {
      const end = Math.min(size.height, y + step);
      PS.scaleImageData(source, entry.width, entry.height, destination, size.width, size.height, y, end);
      onProgress(end / size.height);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (entry.format === "gif") {
      return new Blob([PS.encodeGif(destination, size.width, size.height)], { type: "image/gif" });
    }
    context.putImageData(new ImageData(destination, size.width, size.height), 0, 0);
    const mime = entry.format === "jpeg" ? "image/jpeg" : entry.format === "webp" ? "image/webp" : "image/png";
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, mime, mime === "image/png" ? undefined : 0.92);
    });
    if (!blob) {
      const error = new Error("encode");
      error.code = "memory";
      throw error;
    }
    return blob;
  }

  function showProgress() {
    gaugeFill.style.width = Math.round(state.progress * 100) + "%";
    const text = "Exporting\u2026 " + Math.round(state.progress * 100) + "%";
    downloadLabel.textContent = text;
    downloadBtn2.textContent = text;
  }

  async function download() {
    if (state.busy) return;
    const ranked = rows();
    const action = PS.downloadAction(ranked.map((row, index) => ({ status: row.status, format: state.files[index].format })));
    if (!action.enabled) return;
    const job = state.files.map((file, index) => ({ file, row: ranked[index] }));
    state.busy = true;
    state.progress = 0;
    closeMenus();
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let activeId = null;
    try {
      if (action.kind === "zip") {
        const zip = new JSZip();
        const passing = job.filter((item) => item.row.status === "pass");
        for (let i = 0; i < passing.length; i++) {
          const item = passing[i];
          activeId = item.file.id;
          const blob = await rasterize(item.file, item.row, (progress) => {
            state.progress = (i + progress) / passing.length;
            showProgress();
          });
          zip.file(item.file.path || item.file.name || "image", blob);
        }
        const zipped = await zip.generateAsync({ type: "blob" });
        saveBlob(zipped, "pixel-kit.zip");
      } else {
        const item = job[0];
        activeId = item.file.id;
        const blob = await rasterize(item.file, item.row, (progress) => {
          state.progress = progress;
          showProgress();
        });
        saveBlob(blob, item.file.name);
      }
    } catch (error) {
      if (activeId) {
        state.memoryId = activeId;
        state.selectedId = activeId;
        state.dismissed = "";
      }
    } finally {
      state.busy = false;
      state.progress = 0;
      render();
    }
  }

  // ---------- context menu ----------

  function openFileMenu(id, x, y) {
    closeMenus();
    fileMenu.hidden = false;
    fileMenu.dataset.id = String(id);
    const width = fileMenu.offsetWidth;
    const height = fileMenu.offsetHeight;
    fileMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + "px";
    fileMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + "px";
  }
  $("file-delete").addEventListener("click", () => deleteFile(Number(fileMenu.dataset.id)));
  $("file-replace").addEventListener("click", () => {
    closeMenus();
    $("replace-pick").click();
  });

  // ---------- wiring ----------

  PRESETS.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = value;
    button.textContent = "\u00d7" + value;
    button.addEventListener("click", () => applyPreset(value));
    $("presets").append(button);
  });

  document.querySelectorAll("[data-shortcut]").forEach((node) => {
    const spec = node.dataset.shortcut;
    node.textContent = spec === "mod+S" ? mod("S") : spec === "mod+O" ? mod("O") : spec === "shift+mod+O" ? shiftMod("O") : "";
  });

  const openFiles = () => $("pick").click();
  const openFolder = () => $("folder-pick").click();
  $("choose").addEventListener("click", openFiles);
  $("choose-folder").addEventListener("click", openFolder);
  $("add-files").addEventListener("click", openFiles);
  $("add-folder").addEventListener("click", openFolder);
  $("replace").addEventListener("click", () => $("replace-pick").click());
  $("pick").addEventListener("change", (event) => {
    addFiles(event.target.files, false);
    event.target.value = "";
  });
  $("folder-pick").addEventListener("change", (event) => {
    addFiles(PF.collectFileList(event.target.files), false);
    event.target.value = "";
  });
  $("replace-pick").addEventListener("change", (event) => {
    addFiles(event.target.files, true);
    event.target.value = "";
  });
  $("mode-scale").addEventListener("click", () => switchMode("scale"));
  $("mode-pixels").addEventListener("click", () => switchMode("pixels"));
  $("edge-width").addEventListener("click", () => switchEdge("width"));
  $("edge-height").addEventListener("click", () => switchEdge("height"));
  scaleInput.addEventListener("input", () => {
    if (state.busy) {
      scaleInput.value = state.scaleText;
      return;
    }
    state.scaleText = scaleInput.value;
    state.memoryId = null;
    render();
  });
  pixelInput.addEventListener("input", () => {
    if (state.busy) {
      pixelInput.value = state.pixelText;
      return;
    }
    state.pixelText = pixelInput.value;
    state.memoryId = null;
    render();
  });
  $("zoom-in").addEventListener("click", () => zoomBy(1));
  $("zoom-out").addEventListener("click", () => zoomBy(-1));
  $("m-zoom-in").addEventListener("click", () => zoomBy(1));
  $("m-zoom-out").addEventListener("click", () => zoomBy(-1));
  stage.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  document.querySelectorAll("[data-bg]").forEach((swatch) => {
    swatch.addEventListener("click", () => setBg(swatch.dataset.bg));
  });
  $("grid-toggle").addEventListener("click", toggleGrid);
  $("compare-toggle").addEventListener("click", toggleCompare);
  $("files-collapse").addEventListener("click", toggleFiles);
  $("files-open").addEventListener("click", () => setDrawer(true));
  $("m-files").addEventListener("click", () => setDrawer(true));
  $("scrim").addEventListener("click", () => setDrawer(false));
  function setSheet(level) {
    state.sheet = level;
    inspector.classList.toggle("sheet-half", level === 1);
    inspector.classList.toggle("sheet-full", level === 2);
  }
  $("grab").addEventListener("click", () => setSheet((state.sheet + 1) % 3));
  $("download").addEventListener("click", download);
  downloadBtn2.addEventListener("click", download);
  $("colors-reset").addEventListener("click", resetColors);
  $("colors-export").addEventListener("click", exportPalette);
  $("colors-import").addEventListener("click", () => $("colors-pick").click());
  $("colors-pick").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || state.busy) return;
    try {
      state.mapping = PR.importMapping(await file.text());
      render();
    } catch (error) {
      alert("Could not read this color mapping. Use JSON like {\"#ff0000\": \"#00ff00\"}.");
    }
  });
  colorFilter.addEventListener("input", () => {
    state.filter = colorFilter.value;
    render();
  });
  $("popup-close").addEventListener("click", () => {
    const current = selected();
    const row = currentRow();
    if (row && row.code === "memory") state.memoryId = null;
    else if (current && row && row.code) state.dismissed = current.id + ":" + row.code;
    render();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!fileMenu.hidden && !fileMenu.contains(event.target)) {
      fileMenu.hidden = true;
    }
    if (!dropdown.hidden && !dropdown.contains(event.target) && event.target !== menuOpener && !(menuOpener && menuOpener.contains(event.target))) {
      closeMenus();
    }
  });

  function typing(target) {
    return target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  }

  document.addEventListener("keydown", (event) => {
    const modKey = IS_MAC ? event.metaKey : event.ctrlKey;
    const key = event.key;
    if (key === "Escape") {
      if (!dropdown.hidden || !fileMenu.hidden) closeMenus(true);
      else if (state.drawer) setDrawer(false);
      else if (state.sheet) setSheet(0);
      else if (!popup.hidden) $("popup-close").click();
      return;
    }
    if (modKey && !event.altKey) {
      const lower = key.toLowerCase();
      if (lower === "o") {
        event.preventDefault();
        if (event.shiftKey) openFolder();
        else openFiles();
      } else if (lower === "s") {
        event.preventDefault();
        download();
      } else if (key === "\\") {
        event.preventDefault();
        toggleFiles();
      } else if (event.shiftKey && (key === "Backspace" || key === "Delete")) {
        event.preventDefault();
        clearAll();
      }
      return;
    }
    if (key === "F10" || (key === "Alt" && !event.repeat)) {
      if (key === "F10") event.preventDefault();
      if (menuButtons[0].offsetParent) menuButtons[0].focus();
      return;
    }
    if (typing(event.target) || event.altKey || event.metaKey || event.ctrlKey) return;
    if (!dropdown.hidden && dropdown.contains(event.target)) return;
    if (event.target.closest && event.target.closest("[role=tablist], [role=menubar]")) {
      if (["ArrowLeft", "ArrowRight", "ArrowDown", "Home", "End"].includes(key)) return;
    }
    if (/^[1-9]$/.test(key)) {
      const mode = MODES.find((item) => item.key === key);
      if (mode) setTool(mode.id);
    } else if (key === "+" || key === "=") zoomBy(1);
    else if (key === "-" || key === "\u2212") zoomBy(-1);
    else if (key === "0") fit();
    else if (key === "g" || key === "G") toggleGrid();
    else if (key === "b" || key === "B") toggleCompare();
    else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveSelection(key === "ArrowDown" ? 1 : -1);
    } else if ((key === "Backspace" || key === "Delete") && fileList.contains(document.activeElement)) {
      event.preventDefault();
      deleteFile(state.selectedId);
    }
  });

  // Drag and drop anywhere in the window.
  let dragDepth = 0;
  document.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
    dragDepth++;
    const n = event.dataTransfer.items ? event.dataTransfer.items.length : 0;
    $("dropzone-text").textContent = n ? "Drop to add " + n + (n === 1 ? " item" : " items") : "Drop to add";
    dropzone.hidden = false;
  });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.hidden = true;
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropzone.hidden = true;
    if (!event.dataTransfer) return;
    const items = [...(event.dataTransfer.items || [])];
    const entries = items.map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null));
    if (entries.length && entries.every(Boolean) && entries.some((entry) => entry.isDirectory)) {
      PF.collectEntries(entries).then((found) => addFiles(found, false));
    } else {
      addFiles(event.dataTransfer.files, false);
    }
  });

  setSheet(1);
  render();
})();
