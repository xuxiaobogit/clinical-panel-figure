# Clinical Panel Figure Builder

A single-file, offline, browser-based tool for assembling **multi-panel figures for journal
submission** — especially clinical/medical composites where several sub-images (ultrasound, CT,
MRI, MRCP, endoscopy, intra-op photos, etc.) are tiled into one labelled figure. Grid layout,
per-panel crop/zoom/rotate, customizable panel frames, burned-in letter labels, colored arrows,
and a **print-ready PNG export with honest, verifiable DPI**.

No install, no server, no upload — your images never leave your computer.

> **Status: provided as-is, not actively maintained.** It's a self-contained single HTML file with no
> dependencies and no backend, so it should keep working on its own. MIT-licensed — feel free to fork,
> modify, or take over maintenance. Issues may not be answered, but pull requests/forks are welcome.

## Run

Just open **`figure-builder.html`** in any modern browser (double-click). That's it.

For a live-reload dev preview (optional): `.claude/launch.json` serves the folder via
`python -m http.server 8731`; `index.html` redirects to the app.

## Features

- **Load images** — file picker or drag-drop anywhere. Thumbnails show pixel dimensions.
- **Layouts** — *By level A–I (2·1·2·2·2)*, grids 3×3 / 2×4 / 2×3 / 2×2, row of 2/3, or custom R×C.
- **Per-panel crop** — drag to pan, wheel/slider to zoom, rotate 90°, reset. Cover-fit, never distorts.
- **Place images two ways** — drag a thumbnail straight onto a panel, or select a panel then click a thumbnail.
- **Panel frames** (new) — global border style (color · width · corner radius) applied to all panels,
  with **per-panel override**: turn a panel's border on/off or give it its own color. Width and corner
  are in figure units, so they scale correctly with the export.
- **Labels** — auto A–I (upper/lower case, size, color, optional chip background) + per-panel text override.
- **Arrows** — add, drag endpoints, recolor, width. (Example convention: red = pus/debris, yellow = stone,
  white = distractor — fully editable.)
- **Gutter** and **background** color.
- **Page-2-only flag** per panel → *Export page-1 subset* drops fully-page-2 rows and re-letters, while
  *Export complete* renders everything (the quiz/answer superset model).
- **Export** — width (mm) × DPI → PNG, with a correct **pHYs** chunk so the file genuinely reports the
  chosen DPI. Quick presets for column width (85 / 114 / 174 mm) and DPI (300 / 600 / 1200).
- **Live output readout** — shows exact output pixels, physical size (mm), and the **effective DPI of your
  lowest-resolution placed image**. Turns amber when that image is being upscaled, so you know *before*
  submitting whether a panel will look soft.
- **Save / Open project** — self-contained JSON (images as data-URLs + all transforms/frames/arrows),
  plus autosave to `localStorage`.

## About the DPI (is it real?)

Yes. Two independent things are both correct:

1. **The file is actually that many pixels.** `pixels = width_mm / 25.4 × DPI`. At 174 mm × 600 dpi the
   canvas is rendered at a true **4110 px** wide — labels, arrows and geometry are vector-drawn at the
   target size, not upscaled from the screen preview.
2. **The embedded DPI tag matches.** The PNG `pHYs` chunk stores pixels-per-metre = `DPI / 0.0254`
   (600 dpi → 23 622 ppm). Photoshop / journal systems read this and report exactly 600 dpi at 174 mm.

The one thing DPI metadata *can't* fix: a low-resolution **source image** stretched across a large panel.
The figure is still 600 dpi, but that image's real detail isn't. The readout's *"src ≈ N dpi"* value
exposes exactly this — if it's amber, swap in a higher-resolution source or make the panel smaller.

(These claims are checked automatically: the export's IHDR dimensions, the pHYs ppm value, and the
effective-DPI warning are all verified against the formulas.)

## Architecture (one file: `figure-builder.html`)

- No dependencies; vanilla HTML/CSS/JS, `<canvas>` for both preview and export.
- Logical coordinate space: composite width = `LOGICAL_W` (1000) units; everything scales by a single
  factor `c` — `displayScale` for the screen, `pxW/1000` for export. Aspect is fixed per layout; mm × DPI
  only scales.
- **One renderer.** `paint(targetCtx, c, opts)` draws background → images → frames → arrows → labels and
  is the single source of truth for *both* the on-screen preview and the export (no more drift between two
  copies). Helpers: `drawImageInto` / `drawBorderInto` / `drawArrowInto` / `drawLabelInto`, `roundRectPath`,
  `effBorder`.
- Geometry: `PRESETS` → `buildLayout()` (rects, preserves per-cell data) · `subsetGeom()` (page-1 reflow).
- DPI: `outputInfo()` (pixels / physical size / min effective source DPI) · `withPhys()` + `crc32()` (PNG metadata).
- State: `images[]`, `cells[]` (imgId, zoom, ox, oy, rot, page2, labelText, **bd, bdColor**, arrows[]),
  `labelOpts`, `frameOpts`.

## Publishing / sharing this tool

It's a single HTML file, which makes distribution easy:

- **GitHub + GitHub Pages (recommended).** Push the repo, then enable *Settings → Pages → Deploy from
  branch → `main` / root*. `index.html` redirects to the app, so people just open
  `https://<user>.github.io/clinical-panel-figure/`. Works offline once loaded; no backend needed.
- **WeChat 公众号.** A 公众号 article can't run HTML directly, so don't paste the code into the editor.
  Instead, host it on GitHub Pages (above) and put the **link** in the article (e.g. as a 阅读原文 link or a
  QR code to the Pages URL). Readers open it in their browser. Tip: also attach the `.html` file itself so
  people can save and use it fully offline. (公众号 in-app browsers can be restrictive; if a reader hits
  trouble, tell them to tap *open in external browser*.)
- **Plain file share.** Because nothing is uploaded and there are no dependencies, you can also just send
  `figure-builder.html` over email / WeChat file transfer; double-clicking it works.

## Backlog / ideas

- [ ] Caption strip under each panel (text, optional).
- [ ] TIFF / vector (SVG) export alongside PNG (journals sometimes require TIFF).
- [ ] Cell merge/span in the UI (currently only the preset's wide row spans).
- [ ] Drag-to-reorder panels.
- [ ] Undo/redo.
- [ ] Explicit crop-rectangle handles as an alternative to pan/zoom.
- [ ] Per-figure scale bar.

## Origin / context

Extracted from an ICM "Imaging in Intensive Care Medicine" pyonephrosis submission, generalized into a
reusable tool for any multi-panel clinical/scientific figure.
