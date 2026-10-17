# Offlip

Convert files right in your browser. Nothing is uploaded.

Offlip is a static site with no build step, no backend and no third-party libraries. Files are decoded and re-encoded on your device, and every encoder is written in this repo (`formats.js`).

Drop files anywhere on the page (or click, or paste). They convert instantly; pick a different format and they convert again.

## What it converts

| Kind  | In | Out |
| ----- | -- | --- |
| Image | PNG, JPG, WebP, GIF, BMP, AVIF, SVG, ICO (whatever your browser can decode) | PNG, JPG, WebP, AVIF*, GIF, BMP, ICO, TIFF, PDF |
| Audio | MP3, WAV, OGG, M4A, FLAC, AAC, Opus... and the sound of MP4/WebM/MOV video (whatever your browser can decode) | WAV |
| Data  | CSV, TSV, JSON | JSON, CSV, TSV, HTML table, Markdown table, XML |

\* AVIF output only appears in browsers that can encode it.

Also: quality slider for lossy formats, max width for images, batch convert, download one by one or as a .zip, optional automatic download. Your choices are remembered.

Notes: ICO is a single square icon of at most 256px. GIF is a single frame with a 256 colour palette. PDF holds one image per file.

## Run locally

```bash
python -m http.server 8765
```

Then open http://localhost:8765. Any static file server works.

## Roadmap

- MP3 output and video conversion (ffmpeg.wasm)
- HEIC input
- Merge several images into one PDF
