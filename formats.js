"use strict";

// Every converter is written here from scratch, so nothing is fetched from a
// third party and the whole app works offline once loaded.
//
// A "kind" groups input files that share a set of output formats:
//   kind.detect(file)                    -> does this file belong to the kind?
//   kind.convert(file, fmt, opts)        -> Promise<Blob>
// and each format is { id, ext, label, lossy?, flatten?, probe?, encode }.

const TEXT_ENC = new TextEncoder();

const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();

// ---------------------------------------------------------------- images ---

const nativeImage = (mime, lossy) => ({
  lossy,
  probe: mime,
  encode: (canvas, o) => new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encoding failed"))),
      mime, lossy ? o.quality : undefined)),
});

function pixels(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

async function encodeBMP(canvas) {
  const w = canvas.width, h = canvas.height, data = pixels(canvas);
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf), u = new Uint8Array(buf);
  u[0] = 0x42; u[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, -h, true); // negative height: rows stored top-down
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      u[o++] = data[i + 2]; u[o++] = data[i + 1]; u[o++] = data[i];
    }
  }
  return new Blob([buf], { type: "image/bmp" });
}

async function encodeICO(canvas) {
  // ICO entries are square and at most 256px; fit the image inside one.
  const size = Math.min(256, Math.max(canvas.width, canvas.height));
  const sq = document.createElement("canvas");
  sq.width = sq.height = size;
  const s = Math.min(size / canvas.width, size / canvas.height);
  const dw = Math.round(canvas.width * s), dh = Math.round(canvas.height * s);
  sq.getContext("2d").drawImage(canvas, (size - dw) / 2, (size - dh) / 2, dw, dh);
  const png = await new Promise((r) => sq.toBlob(r, "image/png"));
  const bytes = new Uint8Array(await png.arrayBuffer());

  const head = new DataView(new ArrayBuffer(22));
  head.setUint16(2, 1, true);   // type: icon
  head.setUint16(4, 1, true);   // one image
  head.setUint8(6, size === 256 ? 0 : size);
  head.setUint8(7, size === 256 ? 0 : size);
  head.setUint16(12, 1, true);  // planes
  head.setUint16(14, 32, true); // bits per pixel
  head.setUint32(16, bytes.length, true);
  head.setUint32(18, 22, true); // data offset
  return new Blob([head.buffer, bytes], { type: "image/x-icon" });
}

async function encodeTIFF(canvas) {
  // Uncompressed 8-bit RGBA, little endian, a single strip.
  const w = canvas.width, h = canvas.height, data = pixels(canvas);
  const SHORT = 3, LONG = 4;
  const entries = [
    [256, LONG, w], [257, LONG, h], [258, SHORT, 146], // BitsPerSample -> array below
    [259, SHORT, 1], [262, SHORT, 2], [273, LONG, 154], // no compression, RGB, strip offset
    [277, SHORT, 4], [278, LONG, h], [279, LONG, w * h * 4],
    [284, SHORT, 1], [338, SHORT, 2],                   // chunky, unassociated alpha
  ];
  const buf = new ArrayBuffer(154 + data.length);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, value], i) => {
    const o = 10 + i * 12;
    v.setUint16(o, tag, true);
    v.setUint16(o + 2, type, true);
    // Tag 258 holds four SHORTs, stored out of line.
    v.setUint32(o + 4, tag === 258 ? 4 : 1, true);
    if (type === SHORT && tag !== 258) v.setUint16(o + 8, value, true);
    else v.setUint32(o + 8, value, true);
  });
  for (let i = 0; i < 4; i++) v.setUint16(146 + i * 2, 8, true);
  new Uint8Array(buf, 154).set(data);
  return new Blob([buf], { type: "image/tiff" });
}

// Median-cut palette, then LZW: a small GIF89a writer (single frame).
function medianCut(data, maxColors) {
  const step = Math.max(1, Math.floor(data.length / 4 / 50000));
  const px = [];
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!px.length) return [[0, 0, 0]];

  const range = (box) => {
    let best = 0, ch = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
      if (hi - lo > best) { best = hi - lo; ch = c; }
    }
    return { best, ch };
  };

  const boxes = [px];
  while (boxes.length < maxColors) {
    let pick = -1, score = 0, channel = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const { best, ch } = range(b);
      const s = best * Math.sqrt(b.length);
      if (s > score) { score = s; pick = i; channel = ch; }
    });
    if (pick < 0) break;
    const box = boxes[pick].sort((a, b) => a[channel] - b[channel]);
    const mid = box.length >> 1;
    boxes.splice(pick, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((b) => {
    const sum = [0, 0, 0];
    for (const p of b) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
    return sum.map((s) => Math.round(s / b.length));
  });
}

function lzwEncode(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let cur = 0, shift = 0, size = minCode + 1, next = eoi + 1;
  let table = new Map();
  const emit = (code) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minCode + 1;
    } else {
      if (next >= (1 << size)) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) out.push(cur & 255);
  return out;
}

async function encodeGIF(canvas) {
  const w = canvas.width, h = canvas.height, data = pixels(canvas);
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) { transparent = true; break; }

  const palette = medianCut(data, transparent ? 255 : 256);
  const transIndex = transparent ? palette.length : -1;

  // Nearest palette entry, cached per 5-5-5 colour.
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (cache[key] >= 0) return cache[key];
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = palette[i][0] - r, dg = palette[i][1] - g, db = palette[i][2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return (cache[key] = best);
  };

  const indices = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
    indices[i] = data[p + 3] < 128 ? transIndex : nearest(data[p], data[p + 1], data[p + 2]);
  }

  const bytes = [];
  const u16 = (n) => bytes.push(n & 255, (n >> 8) & 255);
  for (const c of "GIF89a") bytes.push(c.charCodeAt(0));
  u16(w); u16(h);
  bytes.push(0xf7, 0, 0); // global palette of 256 entries
  for (let i = 0; i < 256; i++) bytes.push(...(palette[i] ?? [0, 0, 0]));
  if (transparent) bytes.push(0x21, 0xf9, 4, 1, 0, 0, transIndex, 0);
  bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
  bytes.push(8);
  const lzw = lzwEncode(indices, 8);
  for (let i = 0; i < lzw.length; i += 255) {
    const chunk = lzw.slice(i, i + 255);
    bytes.push(chunk.length, ...chunk);
  }
  bytes.push(0, 0x3b);
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

async function encodePDF(canvas, o) {
  const jpeg = await new Promise((r) => canvas.toBlob(r, "image/jpeg", o.quality));
  const img = new Uint8Array(await jpeg.arrayBuffer());
  const w = canvas.width, h = canvas.height;
  const pw = (w * 0.75).toFixed(2), ph = (h * 0.75).toFixed(2); // 96 dpi -> points
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;

  const chunks = [], offsets = [];
  let pos = 0;
  const push = (x) => {
    const b = typeof x === "string" ? TEXT_ENC.encode(x) : x;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (n, dict, stream) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${dict}\n`);
    if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
    push("endobj\n");
  };

  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  obj(4, `<< /Length ${content.length} >>`, content);
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>`, img);

  const xref = pos;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n++) table += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  push(table + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

async function convertImage(file, fmt, o) {
  const bitmap = await createImageBitmap(file);
  try {
    let w = bitmap.width, h = bitmap.height;
    if (o.maxWidth && w > o.maxWidth) {
      h = Math.max(1, Math.round(h * (o.maxWidth / w)));
      w = o.maxWidth;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (fmt.flatten) { // no alpha channel in this format: use white, not black
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await fmt.encode(canvas, o);
  } finally {
    bitmap.close();
  }
}

// ----------------------------------------------------------------- audio ---

async function decodeAudio(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  try {
    return await new Ctx(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("this browser cannot decode the audio in this file");
  }
}

function encodeWAV(ab) {
  const ch = ab.numberOfChannels, len = ab.length, rate = ab.sampleRate;
  const dataBytes = len * ch * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataBytes, true);
  const chans = Array.from({ length: ch }, (_, c) => ab.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

// ------------------------------------------------------------------ data ---

function parseDelimited(text, delim) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function guessType(s) {
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) return Number(s);
  if (s === "true") return true;
  if (s === "false") return false;
  return s;
}

function tableFromRows(rows) {
  if (!rows.length) throw new Error("the file is empty");
  const headers = rows[0].map((h, i) => (h === "" ? `column ${i + 1}` : h));
  const body = rows.slice(1).map((r) => headers.map((_, i) => guessType(r[i] ?? "")));
  return { headers, rows: body };
}

function tableFromJson(v) {
  if (!Array.isArray(v)) throw new Error("JSON must be a list to become a table");
  if (v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
    const headers = [...new Set(v.flatMap((x) => Object.keys(x)))];
    return { headers, rows: v.map((x) => headers.map((h) => x[h] ?? "")) };
  }
  if (v.every(Array.isArray)) {
    const width = Math.max(0, ...v.map((r) => r.length));
    return { headers: Array.from({ length: width }, (_, i) => `column ${i + 1}`), rows: v.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) };
  }
  return { headers: ["value"], rows: v.map((x) => [x]) };
}

const cellText = (c) => (c === null || c === undefined ? "" : typeof c === "object" ? JSON.stringify(c) : String(c));
const tableOf = (src) => (src.table ??= src.json !== undefined ? tableFromJson(src.json) : null);
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textBlob = (s, type) => new Blob([s], { type: type + ";charset=utf-8" });

function delimited(src, delim) {
  const { headers, rows } = tableOf(src);
  const esc = (c) => {
    const s = cellText(c);
    if (delim === "\t") return s.replace(/[\t\r\n]+/g, " ");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(delim)).join("\r\n") + "\r\n";
}

function xmlName(s) {
  const n = s.replace(/[^\w.-]+/g, "_");
  return /^[A-Za-z_]/.test(n) ? n : "_" + n;
}

const DATA_FORMATS = [
  { id: "json", ext: "json", label: "JSON", encode: (src) => textBlob(
    JSON.stringify(src.json !== undefined ? src.json : tableOf(src).rows.map((r) =>
      Object.fromEntries(src.table.headers.map((h, i) => [h, r[i]]))), null, 2) + "\n", "application/json") },
  { id: "csv", ext: "csv", label: "CSV", encode: (src) => textBlob("﻿" + delimited(src, ","), "text/csv") },
  { id: "tsv", ext: "tsv", label: "TSV", encode: (src) => textBlob(delimited(src, "\t"), "text/tab-separated-values") },
  { id: "html", ext: "html", label: "HTML table", encode: (src) => {
    const { headers, rows } = tableOf(src);
    const tr = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${escapeHtml(cellText(c))}</${tag}>`).join("")}</tr>`;
    return textBlob(`<!doctype html>\n<meta charset="utf-8">\n<table border="1" cellpadding="4" cellspacing="0">\n<thead>${tr(headers, "th")}</thead>\n<tbody>\n${rows.map((r) => tr(r, "td")).join("\n")}\n</tbody>\n</table>\n`, "text/html");
  } },
  { id: "md", ext: "md", label: "Markdown table", encode: (src) => {
    const { headers, rows } = tableOf(src);
    const esc = (c) => cellText(c).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
    const line = (cells) => `| ${cells.map(esc).join(" | ")} |`;
    return textBlob([line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n") + "\n", "text/markdown");
  } },
  { id: "xml", ext: "xml", label: "XML", encode: (src) => {
    const { headers, rows } = tableOf(src);
    const names = headers.map(xmlName);
    const body = rows.map((r) => `  <row>\n${r.map((c, i) => `    <${names[i]}>${escapeHtml(cellText(c))}</${names[i]}>`).join("\n")}\n  </row>`).join("\n");
    return textBlob(`<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n${body}\n</rows>\n`, "application/xml");
  } },
];

async function convertData(file, fmt) {
  const text = await file.text();
  const ext = extOf(file.name);
  let src;
  if (ext === "json" || file.type === "application/json") {
    src = { json: JSON.parse(text) };
  } else {
    const first = text.split(/\r?\n/, 1)[0];
    const delim = ext === "tsv" ? "\t"
      : [",", ";", "\t"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    src = { table: tableFromRows(parseDelimited(text, delim)) };
  }
  return fmt.encode(src);
}

// ----------------------------------------------------------------- kinds ---

const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "webm", "mp4", "mov", "m4v"];
const DATA_EXT = ["csv", "tsv", "json"];

const KINDS = {
  image: {
    label: "Image",
    detect: (f) => f.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg", "ico"].includes(extOf(f.name)),
    formats: [
      { id: "png", ext: "png", label: "PNG", ...nativeImage("image/png", false) },
      { id: "jpg", ext: "jpg", label: "JPG", flatten: true, ...nativeImage("image/jpeg", true) },
      { id: "webp", ext: "webp", label: "WebP", ...nativeImage("image/webp", true) },
      { id: "avif", ext: "avif", label: "AVIF", ...nativeImage("image/avif", true) },
      { id: "gif", ext: "gif", label: "GIF", encode: encodeGIF },
      { id: "bmp", ext: "bmp", label: "BMP", flatten: true, encode: encodeBMP },
      { id: "ico", ext: "ico", label: "ICO", encode: encodeICO },
      { id: "tiff", ext: "tiff", label: "TIFF", encode: encodeTIFF },
      { id: "pdf", ext: "pdf", label: "PDF", lossy: true, flatten: true, encode: encodePDF },
    ],
    convert: convertImage,
  },
  audio: {
    label: "Audio",
    detect: (f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || AUDIO_EXT.includes(extOf(f.name)),
    formats: [{ id: "wav", ext: "wav", label: "WAV", encode: encodeWAV }],
    convert: async (file, fmt) => fmt.encode(await decodeAudio(file)),
  },
  data: {
    label: "Data",
    detect: (f) => DATA_EXT.includes(extOf(f.name)) || f.type === "application/json" || f.type === "text/csv",
    formats: DATA_FORMATS,
    convert: convertData,
  },
};

// Data first: a .json file must not be mistaken for anything else.
function detectKind(file) {
  for (const key of ["data", "image", "audio"]) if (KINDS[key].detect(file)) return key;
  return null;
}

// Drop formats this browser cannot produce (e.g. AVIF in some browsers).
async function probeFormats() {
  const canEncode = (mime) => new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    c.toBlob((b) => resolve(!!b && b.type === mime), mime);
  });
  for (const kind of Object.values(KINDS)) {
    const ok = await Promise.all(kind.formats.map((f) => (f.probe ? canEncode(f.probe) : true)));
    kind.formats = kind.formats.filter((_, i) => ok[i]);
  }
}
