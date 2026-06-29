# Clinical Panel Figure Builder

A **local-first, privacy-preserving, DPI-audited** single-file tool for assembling **multi-panel
figures for biomedical publication** — especially clinical/medical composites where several
sub-images (ultrasound, CT, MRI, MRCP, endoscopy, intra-op photos, etc.) are tiled into one
labelled figure. Grid layout, per-panel crop/zoom/rotate, customizable panel frames, burned-in
letter labels, colored arrows, and a **print-ready PNG export with honest, verifiable DPI**.

It runs entirely in your browser from one HTML file. No install, no server, no upload — and a
Content-Security-Policy baked into the file forbids the page from opening *any* network
connection, so your images physically cannot leave your computer.

> **Status: v0.1.0 — first public release.** A self-contained single HTML file with no
> dependencies and no backend. MIT-licensed — free to use, fork, and modify.

## Use it

- **Online:** https://xuxiaobogit.github.io/clinical-panel-figure/
- **Offline:** download **`figure-builder.html`** and double-click it. Works fully offline; your
  images stay on your computer.

## Features

- **Load images** — file picker or drag-drop anywhere. Thumbnails show pixel dimensions.
- **Layouts** — *By level A–I (2·1·2·2·2)*, grids 3×3 / 2×4 / 2×3 / 2×2, row of 2/3, or custom R×C.
- **Per-panel crop** — drag to pan, wheel/slider to zoom, rotate (90° steps **or any angle** via the
  slider), reset. Cover-fit at any rotation: the panel stays filled, the image is never distorted.
- **Place images two ways** — drag a thumbnail straight onto a panel, or select a panel then click a thumbnail.
- **Panel frames** — global border style (color · width · corner radius) applied to all panels, with a
  **per-panel override**: turn a panel's border on/off or give it its own color. Width and corner are in
  figure units, so they scale correctly with the export.
- **Labels** — auto A–I (upper/lower case, size, color, optional chip background) + per-panel text override.
- **Arrows** — add, drag endpoints, recolor, width, and a one-click **show/hide** for all arrows so you
  can export a clean, annotation-free version of the same figure. Set your own color legend for the figure.
- **Alignment grid** — toggle a grid + center-cross overlay to line panels, labels and arrows up by eye.
  It is a screen-only guide and is **never** drawn into the exported PNG.
- **Publisher presets** — one click sets width × DPI to common journal conventions (single column
  85 mm / 1.5 column 114 mm / double column 174 mm, at 300 / 600 / 1200 dpi). Always confirm the
  exact numbers in your target journal's author guidelines.
- **De-identification checklist** — a built-in pre-export reminder of the identifiers this tool
  *cannot* scrub for you (names/MRN/dates burned into pixels, faces, DICOM overlays, embedded metadata).
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

## Privacy

Your images never leave your machine, and that is enforced two independent ways:

- **No network code.** The file contains no `fetch` / `XMLHttpRequest`, and loads no remote scripts,
  styles, fonts, or images. Images you add are read locally as `data:` URLs; exports are local
  `blob:` downloads.
- **Browser-enforced.** A `Content-Security-Policy` meta tag sets `connect-src 'none'` (with
  `default-src 'none'`), so even a *modified* copy of the file cannot open a connection — the
  browser blocks it outright.

The tool cannot, however, remove identifiers already *inside* your source images. The in-app
**de-identification checklist** lists what you remain responsible for.

## About the DPI (is it real?) — and how to check it yourself

Yes. Two independent things are both correct:

1. **The file is actually that many pixels.** `pixels = width_mm / 25.4 × DPI`. At 174 mm × 600 dpi the
   canvas is rendered at a true **4110 px** wide — labels, arrows and geometry are vector-drawn at the
   target size, not upscaled from the screen preview.
2. **The embedded DPI tag matches.** The PNG `pHYs` chunk stores pixels-per-metre = `DPI / 0.0254`
   (600 dpi → 23 622 ppm). Photoshop / journal systems read this and report exactly 600 dpi at 174 mm.

**Don't take my word for it — audit any exported PNG** with the included script (Python 3, standard
library only, no dependencies):

```sh
python validate_dpi.py Figure-complete-600dpi.png --width-mm 174 --expect-dpi 600
```

It decodes the raw PNG bytes and reports the true pixel size (from IHDR), the embedded resolution
(from pHYs) converted to DPI, the physical size those imply, and whether the metadata CRC is valid —
then verifies the round trip `pixels == round(width_mm / 25.4 × dpi)`. Exit code `0` means the file
is self-consistent; `1` flags any mismatch.

The one thing DPI metadata *can't* fix: a low-resolution **source image** stretched across a large panel.
The figure is still 600 dpi, but that image's real detail isn't. The readout's *"src ≈ N dpi"* value
exposes exactly this — if it's amber, swap in a higher-resolution source or make the panel smaller.

## License

MIT — see [LICENSE](LICENSE). Provided as-is, without warranty.
