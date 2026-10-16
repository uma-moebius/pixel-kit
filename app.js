(function () {
  const PS = globalThis.PixelScale;
  const PR = globalThis.PixelRecolor;
  const MAX_COLOR_ROWS = 512;
  const $ = (id) => document.getElementById(id);

  const preview = $("preview");
  const stage = $("stage");
  const empty = $("empty");
  const checker = $("checker");
  const previewImg = $("preview-img");
  const sizeLabel = $("size-label");
  const popup = $("popup");
  const popupName = $("popup-name");
  const popupMessage = $("popup-message");
  const gauge = $("gauge");
  const gaugeFill = $("gauge-fill");
  const noFile = $("no-file");
  const card = $("card");
  const thumb = $("thumb");
  const thumbImg = $("thumb-img");
  const cardName = $("card-name");
  const cardMeta = $("card-meta");
  const fileList = $("file-list");
  const downloadBtn = $("download");
  const scaleField = $("scale-field");
  const scaleInput = $("scale-input");
  const pixelBlock = $("pixel-block");
  const pixelField = $("pixel-field");
  const pixelInput = $("pixel-input");
  const derived = $("derived");
  const viewValue = $("view-value");
  const viewRange = $("view-range");
  const fileMenu = $("file-menu");
  const fileDelete = $("file-delete");
  const colorList = $("color-list");
  const colorsNote = $("colors-note");

  const state = {
    files: [],
    selectedId: null,
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
  };
  let paletteSig = "";
  let seq = 0;

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
      if (state.memoryId === file.id) {
        return { ...row, status: "fail", code: "memory" };
      }
      return row;
    });
  }

  function detectFormat(file) {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    const known = {
      "image/png": "png",
      "image/jpeg": "jpeg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    if (known[type]) return known[type];
    if (type.startsWith("image/")) return null;
    if (name.endsWith(".png")) return "png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg";
    if (name.endsWith(".webp")) return "webp";
    if (name.endsWith(".gif")) return "gif";
    return null;
  }

  function makeEntry(file) {
    const format = detectFormat(file);
    return {
      id: ++seq,
      file,
      name: file.name || "image",
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
      mode: "scale",
      edge: state.edge,
      scaleRatio: PS.decimalRatio(state.scaleText),
      pixelRatio: null,
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
    render();
  }

  function addFiles(list, replace) {
    const incoming = [...list];
    if (!incoming.length || state.busy) return;
    state.memoryId = null;
    state.dismissed = "";
    if (replace) {
      const index = state.files.findIndex((file) => file.id === state.selectedId);
      if (index < 0) return;
      const created = makeEntry(incoming[0]);
      release(state.files[index]);
      state.files[index] = created;
      state.selectedId = created.id;
      if (created.format) decode(created);
    } else {
      const created = incoming.map(makeEntry);
      state.files.push(...created);
      state.selectedId = created[0].id;
      created.forEach((entry) => {
        if (entry.format) decode(entry);
      });
    }
    render();
  }

  function edgeValue(size) {
    return state.edge === "height" ? size.height : size.width;
  }

  function switchMode(mode) {
    if (mode === state.mode || state.busy) return;
    const current = selected();
    if (mode === "pixels" && current && current.readable) {
      const size = PS.outputSize(current.width, current.height, {
        mode: "scale",
        edge: state.edge,
        scaleRatio: PS.decimalRatio(state.scaleText),
        pixelRatio: null,
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
      if (size.width) {
        state.pixelText = String(edge === "height" ? size.height : size.width);
      }
    }
    state.edge = edge;
    state.memoryId = null;
    render();
    pixelInput.value = state.pixelText;
  }

  function render() {
    const current = selected();
    const ranked = rows();
    const currentRow = ranked.find((row, index) => state.files[index].id === state.selectedId);
    const action = PS.downloadAction(ranked.map((row, index) => ({
      status: row.status,
      format: state.files[index].format,
    })));

    const viewLabel = state.view + "\u00d7";
    viewValue.textContent = viewLabel;
    viewRange.value = String(PS.VIEW_STOPS.indexOf(state.view));
    viewRange.setAttribute("aria-valuetext", viewLabel);
    stage.classList.toggle("empty", state.files.length === 0);
    empty.hidden = state.files.length > 0;

    const showImage = current && current.bitmap && currentRow && (currentRow.status === "pass" || currentRow.status === "duplicate");
    checker.hidden = !showImage;
    if (showImage && currentRow.width && currentRow.height) {
      const viewScale = PS.viewFactor(state.view);
      const src = displayUrl(current);
      if (previewImg.getAttribute("src") !== src) previewImg.src = src;
      previewImg.style.width = (currentRow.width * viewScale) + "px";
      previewImg.style.height = (currentRow.height * viewScale) + "px";
    }

    const showSize = currentRow && currentRow.width > 0 && currentRow.height > 0 && currentRow.code !== "number";
    sizeLabel.hidden = !showSize;
    if (showSize) sizeLabel.textContent = PS.formatPair(currentRow.width, currentRow.height, true);

    const code = currentRow && currentRow.code;
    const key = current && code ? current.id + ":" + code : "";
    const showPopup = Boolean(code && key !== state.dismissed && !state.busy);
    popup.hidden = !showPopup;
    popup.classList.toggle("warn", code === "duplicate");
    if (showPopup) {
      popupName.textContent = current.name;
      popupMessage.textContent = PS.MESSAGES[code];
    }

    gauge.hidden = !state.busy;
    gaugeFill.style.width = Math.round(state.progress * 100) + "%";

    const hasFile = Boolean(current);
    noFile.hidden = hasFile;
    card.hidden = !hasFile;
    if (hasFile) {
      cardName.textContent = current.name;
      const meta = current.readable && current.width
        ? PS.FORMAT_LABEL[current.format] + " \u00b7 " + PS.formatPair(current.width, current.height, true)
        : "";
      cardMeta.hidden = !meta;
      cardMeta.textContent = meta;
      const showThumb = Boolean(showImage);
      thumb.classList.toggle("show", showThumb);
      thumbImg.hidden = !showThumb;
      if (showThumb) {
        const src = displayUrl(current);
        if (thumbImg.getAttribute("src") !== src) thumbImg.src = src;
      }
    }

    $("mode-scale").setAttribute("aria-pressed", state.mode === "scale" ? "true" : "false");
    $("mode-pixels").setAttribute("aria-pressed", state.mode === "pixels" ? "true" : "false");
    $("edge-width").setAttribute("aria-pressed", state.edge === "width" ? "true" : "false");
    $("edge-height").setAttribute("aria-pressed", state.edge === "height" ? "true" : "false");
    scaleField.hidden = state.mode !== "scale";
    pixelBlock.hidden = state.mode !== "pixels";
    pixelInput.setAttribute("aria-label", state.edge === "height" ? "Height" : "Width");
    if (document.activeElement !== scaleInput && scaleInput.value !== state.scaleText) {
      scaleInput.value = state.scaleText;
    }
    if (document.activeElement !== pixelInput && pixelInput.value !== state.pixelText) {
      pixelInput.value = state.pixelText;
    }

    const fieldCode = currentRow && currentRow.code;
    const bad = fieldCode === "number" || fieldCode === "small" || fieldCode === "side" || fieldCode === "total";
    scaleField.classList.toggle("bad", state.mode === "scale" && bad);
    pixelField.classList.toggle("bad", state.mode === "pixels" && bad);

    const other = state.edge === "width" ? "Height" : "Width";
    const otherValue = currentRow && (state.edge === "width" ? currentRow.height : currentRow.width);
    const showDerived = state.mode === "pixels" && currentRow && currentRow.width > 0 && currentRow.height > 0;
    derived.hidden = !showDerived;
    if (showDerived) derived.textContent = other + " " + PS.formatCount(otherValue) + " px";

    fileList.replaceChildren();
    state.files.forEach((file, index) => {
      const row = ranked[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "row" + (file.id === state.selectedId ? " selected" : "");
      if (file.id === state.selectedId) button.setAttribute("aria-current", "true");
      const dot = document.createElement("span");
      dot.className = "dot " + row.status;
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "row-size" + (row.status === "pass" ? "" : " none");
      size.textContent = row.status === "pass" ? PS.formatPair(row.width, row.height, false) : "\u2014";
      button.append(dot, name, size);
      button.addEventListener("click", () => {
        state.selectedId = file.id;
        state.dismissed = "";
        render();
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (state.busy) return;
        openMenu(file.id, event.clientX, event.clientY);
      });
      fileList.append(button);
    });

    renderColors();

    downloadBtn.textContent = action.label;
    downloadBtn.disabled = state.busy || !action.enabled;
  }

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

  function renderColors() {
    const sources = state.files.filter((file) => file.pixels);
    const colors = PR.extractColors(sources.map((file) => file.pixels));
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
          if (state.busy || !setTarget(color.hex, text.value)) {
            text.value = state.mapping[color.hex] || color.hex;
          }
        });
        text.addEventListener("keydown", (event) => {
          if (event.key === "Enter") text.blur();
        });
        row.append(swatch, hex, count, arrow, picker, text);
        colorList.append(row);
      });
    }
    colorList.querySelectorAll(".color-row").forEach((row) => {
      const from = row.dataset.hex;
      const target = state.mapping[from] || from;
      const picker = row.querySelector(".color-pick");
      const text = row.querySelector(".color-text");
      if (picker.value !== target) picker.value = target;
      if (document.activeElement !== text && text.value !== target) text.value = target;
      row.classList.toggle("changed", Boolean(state.mapping[from]));
    });
    const changed = Object.keys(PR.cleanMapping(state.mapping)).length;
    let note = "";
    if (!colors.length) note = "No colors";
    else {
      note = PS.formatCount(colors.length) + (colors.length === 1 ? " color" : " colors");
      if (changed) note += " \u00b7 " + changed + " changed";
      if (colors.length > shown.length) note += " \u00b7 showing first " + MAX_COLOR_ROWS;
    }
    colorsNote.textContent = note;
    colorList.hidden = !colors.length;
    $("colors-reset").disabled = state.busy || !changed;
    $("colors-export").disabled = state.busy || !changed;
    $("colors-import").disabled = state.busy;
  }

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

  async function download() {
    if (state.busy) return;
    const ranked = rows();
    const action = PS.downloadAction(ranked.map((row, index) => ({
      status: row.status,
      format: state.files[index].format,
    })));
    if (!action.enabled) return;
    const job = state.files.map((file, index) => ({ file, row: ranked[index] }));
    state.busy = true;
    state.progress = 0;
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
            gaugeFill.style.width = Math.round(state.progress * 100) + "%";
          });
          const parts = item.file.name.split(/[\\/]/);
          zip.file(parts[parts.length - 1] || "image", blob);
        }
        const zipped = await zip.generateAsync({ type: "blob" });
        saveBlob(zipped, "pixel-scale.zip");
      } else {
        const item = job[0];
        activeId = item.file.id;
        const blob = await rasterize(item.file, item.row, (progress) => {
          state.progress = progress;
          gaugeFill.style.width = Math.round(state.progress * 100) + "%";
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

  $("choose").addEventListener("click", () => $("pick").click());
  $("replace").addEventListener("click", () => $("replace-pick").click());
  $("pick").addEventListener("change", (event) => {
    addFiles(event.target.files, false);
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
  viewRange.addEventListener("input", () => {
    state.view = PS.VIEW_STOPS[Number(viewRange.value)] ?? 1;
    render();
  });
  function closeMenu() {
    fileMenu.hidden = true;
    delete fileMenu.dataset.id;
  }
  function openMenu(id, x, y) {
    fileMenu.hidden = false;
    fileMenu.dataset.id = String(id);
    const width = fileMenu.offsetWidth;
    const height = fileMenu.offsetHeight;
    fileMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + "px";
    fileMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - height - 8)) + "px";
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
    closeMenu();
    render();
  }
  fileDelete.addEventListener("click", () => {
    const id = Number(fileMenu.dataset.id);
    deleteFile(id);
  });
  document.addEventListener("pointerdown", (event) => {
    if (fileMenu.hidden || fileMenu.contains(event.target)) return;
    closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  $("popup-close").addEventListener("click", () => {
    const current = selected();
    const row = rows().find((item, index) => state.files[index].id === state.selectedId);
    if (row && row.code === "memory") state.memoryId = null;
    else if (current && row && row.code) state.dismissed = current.id + ":" + row.code;
    render();
  });
  downloadBtn.addEventListener("click", download);
  $("colors-reset").addEventListener("click", () => {
    if (state.busy) return;
    state.mapping = {};
    render();
  });
  $("colors-export").addEventListener("click", () => {
    saveBlob(new Blob([PR.exportMapping(state.mapping)], { type: "application/json" }), "colors.json");
  });
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

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    stage.classList.toggle("drag", preview.contains(event.target));
  });
  document.addEventListener("dragleave", (event) => {
    if (!preview.contains(event.relatedTarget)) stage.classList.remove("drag");
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    stage.classList.remove("drag");
    if (preview.contains(event.target)) addFiles(event.dataTransfer.files, false);
  });

  render();
})();
