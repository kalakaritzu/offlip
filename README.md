# Offlip

Convert files right in your browser. Nothing is uploaded.

Offlip is a static site with no build step and no backend. Files are decoded and re-encoded locally with the browser's own canvas APIs, so they never leave your device.

## Features (v0)

- Images in: PNG, JPG, WebP, GIF, BMP, AVIF, SVG (whatever your browser can decode)
- Images out: PNG, JPG, WebP, and AVIF where the browser can encode it
- Quality slider for lossy formats, optional max width
- Batch convert, download one by one or as a .zip
- Drag and drop, file picker, or paste

## Run locally

```bash
python -m http.server 8765
```

Then open http://localhost:8765. Any static file server works.

## Roadmap

- Audio and video (ffmpeg.wasm)
- HEIC input
- Documents
