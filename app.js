"use strict";

// Converters live in formats.js (KINDS, detectKind, probeFormats).

const $ = (id) => document.getElementById(id);
const drop = $("drop");
const fileInput = $("file-input");
const groupsEl = $("format-groups");
const qualityIn = $("quality");
const qualityOut = $("quality-out");
const qualityWrap = $("quality-wrap");
const maxWidthIn = $("max-width");
const maxWidthWrap = $("maxwidth-wrap");
const autoDl = $("auto-download");
const overlay = $("overlay");
const bulk = $("bulk");
const zipBtn = $("download-all");
const clearBtn = $("clear");
const listEl = $("list");

/** @type {{file: File, kind: string|null, li: HTMLLIElement, result: {blob: Blob, name: string}|null, thumb: string|null, failed: boolean}[]} */
let items = [];
const selected = {}; // kind -> chosen format
const groups = {};   // kind -> row element
let runId = 0;       // bumped whenever settings change, so stale runs stop
let running = false;
let timer = 0;

// Remembered between visits. Storage can be blocked, so every access is guarded.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

init();

async function init() {
  await probeFormats();

  for (const [kind, def] of Object.entries(KINDS)) {
    selected[kind] = def.formats.find((f) => f.id === store.get("format-" + kind)) ?? def.formats[0];

    const row = document.createElement("div");
    row.className = "formats-row";
    const label = document.createElement("span");
    label.className = "formats-label";
    label.textContent = `${def.label} to`;
    const pills = document.createElement("div");
    pills.className = "formats";
    pills.setAttribute("role", "radiogroup");
    pills.setAttribute("aria-label", `${def.label} output format`);

    for (const f of def.formats) {
      const lab = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "format-" + kind;
      input.value = f.id;
      input.checked = f === selected[kind];
      input.addEventListener("change", () => {
        selected[kind] = f;
        store.set("format-" + kind, f.id);
        syncControls();
        settingsChanged((i) => i.kind === kind);
      });
      const span = document.createElement("span");
      span.textContent = f.label;
      lab.append(input, span);
      pills.appendChild(lab);
    }
    row.append(label, pills);
    groupsEl.appendChild(row);
    groups[kind] = row;
  }

  qualityIn.value = store.get("quality") ?? qualityIn.value;
  qualityOut.textContent = qualityIn.value;
  maxWidthIn.value = store.get("maxWidth") ?? "";
  autoDl.checked = store.get("autoDownload") === "1";
  syncControls();

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

  // The whole page is a drop target.
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener("paste", (e) => addFiles(e.clipboardData?.files ?? []));

  const imageLossy = (i) => i.kind === "image" && selected.image.lossy;
  qualityIn.addEventListener("input", () => {
    qualityOut.textContent = qualityIn.value;
    store.set("quality", qualityIn.value);
    settingsChanged(imageLossy);
  });
  maxWidthIn.addEventListener("input", () => {
    store.set("maxWidth", maxWidthIn.value);
    settingsChanged((i) => i.kind === "image");
  });
  autoDl.addEventListener("change", () => store.set("autoDownload", autoDl.checked ? "1" : "0"));

  zipBtn.addEventListener("click", downloadZip);
  clearBtn.addEventListener("click", clearAll);
}

function hasFiles(e) {
  return e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}

// Show only the format rows and options that matter for what is in the list.
function syncControls() {
  const present = new Set(items.map((i) => i.kind).filter(Boolean));
  if (!present.size) present.add("image");
  for (const [kind, row] of Object.entries(groups)) row.hidden = !present.has(kind);
  qualityWrap.style.display = present.has("image") && selected.image.lossy ? "" : "none";
  maxWidthWrap.style.display = present.has("image") ? "" : "none";
}

function addFiles(fileList) {
  let added = false;
  for (const file of fileList) {
    const kind = detectKind(file);
    const li = document.createElement("li");
    li.className = "item";
    const item = { file, kind, li, result: null, thumb: null, failed: !kind };
    renderItem(item, kind ? "Converting…" : "Unsupported file type", kind ? "" : "err");
    items.push(item);
    listEl.appendChild(li);
    added = true;
  }
  if (added) schedule(0);
  syncControls();
  refreshBulk();
}

function renderItem(item, status, cls = "") {
  const { file, li, result } = item;
  li.textContent = "";

  let thumb;
  if (item.kind === "image") {
    thumb = document.createElement("img");
    thumb.alt = "";
    thumb.src = item.thumb ??= URL.createObjectURL(file);
  } else {
    thumb = document.createElement("div");
    thumb.className = "ph";
    thumb.textContent = extOf(file.name) || "file";
  }

  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = result ? result.name : file.name;
  const meta = document.createElement("div");
  meta.className = "meta " + cls;
  meta.textContent = status;
  info.append(name, meta);

  const side = document.createElement("div");
  side.className = "side";
  if (result) {
    const a = document.createElement("a");
    a.className = "dl";
    a.href = result.url;
    a.download = result.name;
    a.textContent = "Download";
    side.appendChild(a);
  }
  const rm = document.createElement("button");
  rm.className = "rm";
  rm.type = "button";
  rm.setAttribute("aria-label", "Remove " + file.name);
  rm.textContent = "×";
  rm.addEventListener("click", () => removeItem(item));
  side.appendChild(rm);

  li.append(thumb, info, side);
}

function removeItem(item) {
  freeItem(item);
  item.li.remove();
  items = items.filter((i) => i !== item);
  syncControls();
  refreshBulk();
}

function freeItem(item) {
  if (item.result) URL.revokeObjectURL(item.result.url);
  if (item.thumb) URL.revokeObjectURL(item.thumb);
  item.result = null;
  item.thumb = null;
}

function clearAll() {
  items.forEach((i) => { freeItem(i); i.li.remove(); });
  items = [];
  syncControls();
  refreshBulk();
}

function refreshBulk() {
  const ready = items.filter((i) => i.result).length;
  bulk.hidden = items.length === 0;
  zipBtn.hidden = ready < 2;
  zipBtn.textContent = `Download all (${ready}) as .zip`;
}

// Settings changed: matching results no longer fit, so drop them and redo.
function settingsChanged(matches) {
  for (const item of items) {
    if (!item.kind || !matches(item)) continue;
    if (item.result) URL.revokeObjectURL(item.result.url);
    item.result = null;
    item.failed = false;
    renderItem(item, "Converting…");
  }
  runId++;
  refreshBulk();
  schedule(150);
}

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(processQueue, delay);
}

async function processQueue() {
  if (running) { schedule(50); return; }
  running = true;
  const myRun = runId;
  const opts = {
    quality: Number(qualityIn.value) / 100,
    maxWidth: parseInt(maxWidthIn.value, 10) || 0,
  };

  try {
    for (const item of items.slice()) {
      if (item.result || item.failed || !items.includes(item)) continue;
      if (myRun !== runId) break; // settings changed; a new run is queued
      const fmt = selected[item.kind];
      try {
        const blob = await KINDS[item.kind].convert(item.file, fmt, opts);
        if (myRun !== runId || !items.includes(item)) continue;
        const base = item.file.name.replace(/\.[^.]+$/, "") || "file";
        item.result = { blob, name: `${base}.${fmt.ext}`, url: URL.createObjectURL(blob) };
        renderItem(item, `${fmtSize(item.file.size)} → ${fmtSize(blob.size)}`, "ok");
        refreshBulk();
        if (autoDl.checked) triggerDownload(item.result.url, item.result.name);
      } catch (err) {
        if (items.includes(item)) {
          item.failed = true;
          renderItem(item, "Could not convert: " + (err.message || err), "err");
        }
      }
    }
  } finally {
    running = false;
  }
  // Files added (or settings changed) while we were busy still need converting.
  if (items.some((i) => !i.result && !i.failed)) schedule(0);
}

function triggerDownload(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// ---- zip (store-only, no compression; most outputs are already compressed) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function downloadZip() {
  const done = items.filter((i) => i.result);
  if (!done.length) return;

  const used = new Set();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { result } of done) {
    // Make names unique inside the archive.
    let name = result.name, n = 1;
    while (used.has(name)) name = result.name.replace(/(\.[^.]+)$/, `-${n++}$1`);
    used.add(name);

    const nameBytes = TEXT_ENC.encode(name);
    const data = new Uint8Array(await result.blob.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local.buffer, nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, done.length, true);
  end.setUint16(10, done.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  const blob = new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "offlip-converted.zip");
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
