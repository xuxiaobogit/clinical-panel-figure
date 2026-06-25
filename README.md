# Clinical Panel Figure Builder

A single-file, offline, browser-based tool for assembling **multi-panel figures for journal
submission** — especially clinical/medical composites where several sub-images (ultrasound, CT,
MRI, MRCP, endoscopy, intra-op photos, etc.) are tiled into one labelled figure. Grid layout,
per-panel crop/zoom/rotate, customizable panel frames, burned-in letter labels, colored arrows,
and a **print-ready PNG export with honest, verifiable DPI**.

No install, no server, no upload — your images never leave your computer.

> **Status: provided as-is, not actively maintained.** A self-contained single HTML file with no
> dependencies and no backend. MIT-licensed — feel free to fork and modify.

## Use it

- **Online:** https://xuxiaobogit.github.io/clinical-panel-figure/
- **Offline:** download **`figure-builder.html`** and double-click it. Works fully offline; your
  images stay on your computer.

## Features

- **Load images** — file picker or drag-drop anywhere. Thumbnails show pixel dimensions.
- **Layouts** — *By level A–I (2·1·2·2·2)*, grids 3×3 / 2×4 / 2×3 / 2×2, row of 2/3, or custom R×C.
- **Per-panel crop** — drag to pan, wheel/slider to zoom, rotate 90°, reset. Cover-fit, never distorts.
- **Place images two ways** — drag a thumbnail straight onto a panel, or select a panel then click a thumbnail.
- **Panel frames** — global border style (color · width · corner radius) applied to all panels, with a
  **per-panel override**: turn a panel's border on/off or give it its own color. Width and corner are in
  figure units, so they scale correctly with the export.
- **Labels** — auto A–I (upper/lower case, size, color, optional chip background) + per-panel text override.
- **Arrows** — add, drag endpoints, recolor, width. Set your own color legend for the figure.
- **Gutter** and **background** color.
- **Two-page export** — flag panels as *page-2 only* → *Export page-1 subset* drops those rows and
  re-letters, while *Export complete* renders everything.
- **Export** — width (mm) × DPI → PNG, with a correct **pHYs** chunk so the file genuinely reports the
  chosen DPI. Quick presets for column width (85 / 114 / 174 mm) and DPI (300 / 600 / 1200).
- **Live output readout** — shows exact output pixels, physical size (mm), and the **effective DPI of your
  lowest-resolution placed image**. Turns amber when that image is being upscaled, so you know *before*
  submitting whether a panel will look soft.
- **Save / Open project** — self-contained JSON (images + all transforms/frames/arrows), plus autosave so
  you don't lose work on refresh. The **New** button clears it to start fresh.

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

## License

MIT — see [LICENSE](LICENSE). Provided as-is, without warranty.
