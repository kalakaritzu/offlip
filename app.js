"use strict";

// Output formats. Support is probed at startup, since canvas.toBlob silently
// falls back to PNG for types the browser cannot encode.
const FORMATS = [
  { mime: "image/png", ext: "png", label: "PNG", lossy: false },
  { mime: "image/jpeg", ext: "jpg", label: "JPG", lossy: true },
  { mime: "image/webp", ext: "webp", label: "WebP", lossy: true },
  { mime: "image/avif", ext: "avif", label: "AVIF", lossy: true },
];

const $ = (id) => document.getElementById(id);
const drop = $("drop");
const fileInput = $("file-input");
const formatSel = $("format");
const qualityIn = $("quality");
const qualityOut = $("quality-out");
const qualityWrap = $("quality-wrap");
const maxWidthIn = $("max-width");
const convertBtn = $("convert");
const zipBtn = $("download-all");
const clearBtn = $("clear");
const listEl = $("list");

/** @type {{file: File, li: HTMLLIElement, result: {blob: Blob, name: string, url: string}|null}[]} */
let items = [];

init();

async function init() {
  const supported = await Promise.all(FORMATS.map(canEncode));
  FORMATS.forEach((f, i) => {
    if (!supported[i]) return;
    const opt = document.createElement("option");
    opt.value = f.mime;
    opt.textContent = f.label;
    formatSel.appendChild(opt);
  });
  updateQualityVisibility();

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener("paste", (e) => addFiles(e.clipboardData?.files ?? []));
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

  formatSel.addEventListener("change", () => { updateQualityVisibility(); invalidateResults(); });
  qualityIn.addEventListener("input", () => { qualityOut.textContent = qualityIn.value; invalidateResults(); });
  maxWidthIn.addEventListener("input", invalidateResults);

  convertBtn.addEventListener("click", convertAll);
  zipBtn.addEventListener("click", downloadZip);
  clearBtn.addEventListener("click", clearAll);
}

function canEncode(format) {
  return new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    c.toBlob((b) => resolve(!!b && b.type === format.mime), format.mime);
  });
}

function currentFormat() {
  return FORMATS.find((f) => f.mime === formatSel.value) ?? FORMATS[0];
}

function updateQualityVisibility() {
  qualityWrap.style.display = currentFormat().lossy ? "" : "none";
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith("image/")) continue;
    const li = document.createElement("li");
    li.className = "item";
    const item = { file, li, result: null };
    renderItem(item, "Ready");
    items.push(item);
    listEl.appendChild(li);
  }
  refreshButtons();
}

function renderItem(item, status, cls = "") {
  const { file, li, result } = item;
  li.textContent = "";

  const img = document.createElement("img");
  img.alt = "";
  img.src = result ? result.url : (item.thumb ??= URL.createObjectURL(file));

  const info = document.createElement("div");
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = file.name;
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
  } else {
    const rm = document.createElement("button");
    rm.className = "rm";
    rm.type = "button";
    rm.setAttribute("aria-label", "Remove " + file.name);
    rm.textContent = "×";
    rm.addEventListener("click", () => removeItem(item));
    side.appendChild(rm);
  }
  li.append(img, info, side);
}

function removeItem(item) {
  freeItem(item);
  item.li.remove();
  items = items.filter((i) => i !== item);
  refreshButtons();
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
  refreshButtons();
}

// Settings changed: earlier results no longer match, so drop them.
function invalidateResults() {
  for (const item of items) {
    if (!item.result) continue;
    URL.revokeObjectURL(item.result.url);
    item.result = null;
    renderItem(item, "Ready");
  }
  refreshButtons();
}

function refreshButtons() {
  convertBtn.disabled = items.length === 0;
  clearBtn.disabled = items.length === 0;
  zipBtn.disabled = !items.some((i) => i.result);
}

async function convertAll() {
  convertBtn.disabled = true;
  const format = currentFormat();
  const quality = Number(qualityIn.value) / 100;
  const maxWidth = parseInt(maxWidthIn.value, 10) || 0;

  for (const item of items) {
    if (item.result) continue;
    renderItem(item, "Converting…");
    try {
      const blob = await convertOne(item.file, format, quality, maxWidth);
      const base = item.file.name.replace(/\.[^.]+$/, "") || "image";
      item.result = { blob, name: `${base}.${format.ext}`, url: URL.createObjectURL(blob) };
      renderItem(item, `${fmtSize(item.file.size)} → ${fmtSize(blob.size)}`, "ok");
    } catch (err) {
      renderItem(item, "Could not convert: " + (err.message || err), "err");
    }
  }
  convertBtn.disabled = items.length === 0;
  refreshButtons();
}

async function convertOne(file, format, quality, maxWidth) {
  const bitmap = await createImageBitmap(file);
  try {
    let w = bitmap.width, h = bitmap.height;
    if (maxWidth && w > maxWidth) {
      h = Math.max(1, Math.round(h * (maxWidth / w)));
      w = maxWidth;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha channel; flatten onto white instead of black.
    if (format.mime === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, format.mime, format.lossy ? quality : undefined));
    if (!blob) throw new Error("encoding failed");
    return blob;
  } finally {
    bitmap.close();
  }
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// ---- zip (store-only, no compression; images are already compressed) ----

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

  const enc = new TextEncoder();
  const used = new Set();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { result } of done) {
    // Make names unique inside the archive.
    let name = result.name, n = 1;
    while (used.has(name)) name = result.name.replace(/(\.[^.]+)$/, `-${n++}$1`);
    used.add(name);

    const nameBytes = enc.encode(name);
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
  const a = document.createElement("a");
  a.href = url;
  a.download = "offlip-converted.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
