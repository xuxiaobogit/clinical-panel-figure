# Clinical Panel Figure Builder

A single-file browser tool for preparing multipanel clinical research figures. Images are processed locally, with no remote dependencies or upload feature. It supports panel layout, crop/zoom/rotation, labels, arrows, frames, portable projects, and PNG export at a specified physical width and resolution.

**Version: v0.4.1.** This version makes figure-width changes visible in the editor, alongside the saving, recovery, export validation and DPI auditing improvements in v0.4.0.

## Open the tool

- Download or copy `figure-builder.html` and open it in a desktop browser.
- Existing online deployment: [Clinical Panel Figure](https://xuxiaobogit.github.io/clinical-panel-figure/).
- Use **Load images**, select a panel, then click a thumbnail; dragging a thumbnail onto a panel also works.
- Adjust the figure, choose width and DPI, and select **Export complete**.
- Use **Save project** to download an editable JSON backup containing the source images and figure settings.

The current release exports **PNG only**, not TIFF, SVG or PDF. It is a figure preparation tool, not a diagnostic image viewer, image-analysis system, or automatic de-identification service.

## What changed in v0.4.1

- Figure width now changes the preview size at the default fixed 100% zoom. Previously, the preview always fitted the window, hiding the difference between 85 mm and 174 mm even though PNG export used the selected width correctly.
- A separate **Preview** zoom offers 50–200% and **Fit to window**, with the complete figure's physical width and height shown beside it. Large previews scroll without squeezing or clipping the canvas's left edge.
- Width presets identify single- and double-column figure widths. They do not change the number of panels; use **Layout** for panel rows and columns.

## What changed in v0.4.0

- Autosave uses IndexedDB to accommodate image projects that exceed the former localStorage quota. The header displays saving, saved, or failure status; pending or failed saves trigger a warning when leaving. Old browser saves migrate after a successful write. If browser storage is blocked, the editor and manual project downloads still work.
- Project loading validates the full project and decodes all images before replacing the current figure. Damaged projects leave the current work intact. Imported image order is stable, and unsupported files are reported.
- Export checks physical width, DPI, and canvas size before allocation, handles PNG encoding failures, and replaces existing PNG pHYs metadata instead of creating duplicate resolution tags.
- Grid labels consistently mean rows × columns. **2 × 4** now has two rows; old project files retain their original four-row geometry on import.
- Automatic panel labels continue from Z to AA, AB, and so on. Custom layouts support 1–10 rows and 1–10 columns. Up to 200 source images can be loaded in one project.
- Effective-source-resolution warnings now cover every value below the chosen target; values at 90% of the target are no longer described as meeting it.
- The independent PNG auditor rejects missing/invalid absolute resolution, inconsistent axes, duplicate metadata, corrupt or incomplete image streams, and handles normal metadata quantization.

## Figure controls

Layouts include the clinical A–I arrangement, 3×3, 2×4, 2×3, 2×2, two/three-panel rows and custom grids. Images use a uniform scale with cover-fit cropping; zoom, free rotation and panning retain panel coverage. Check the crop yourself to ensure the intended ROI remains visible.

**Figure width** sets the physical width of the entire exported figure. Height follows the selected layout's proportions. At a fixed **Preview** zoom, changing 174 mm to 85 mm makes the preview narrower and shorter while preserving the arrangement and crops. Changing **Resolution** changes PNG pixel dimensions without changing the preview's physical proportions.

Preview 100% uses 96 CSS pixels per inch as a screen reference; actual on-screen millimetres depend on the monitor and browser zoom. **Fit to window** automatically changes the preview magnification to keep the whole figure visible, so different widths can look the same in that mode. Preview zoom affects only the editor view, is not saved in project files, and does not affect PNG output. The selected figure width and resolution are saved and restored with the project.

For very large or tall figures, the preview reduces its magnification to stay within 8,192 pixels per side and 16 megapixels, and displays the resulting zoom. This preview limit does not change the figure's export settings.

Labels support upper/lower case, custom text, size, color and an optional background. Arrows have draggable endpoints, color and width. Frames have global settings and per-panel overrides. The alignment grid is a screen guide and is excluded from PNG export.

Panels marked **page-2 only** are omitted from **Export page-1 subset**. Entire excluded rows collapse; excluded panels within a retained row leave empty slots. The subset re-letters remaining panels. An entirely excluded figure cannot be exported as a subset.

There is currently no general undo/redo history. Save separate project files before major revisions.

## Saving and recovery

**Saved in this browser** means the latest autosave transaction completed. Browser data can still be cleared or evicted, private sessions can discard it, and moving the HTML file or using a different browser can change which workspace is available. Keep explicit JSON project backups, especially before an experiment session.

If **Autosave unavailable — use Save project** appears, download a project before closing. The application does not claim it can verify that a browser download was actually retained. **New** replaces the current browser workspace after confirmation; existing downloaded projects are unchanged.

Projects and autosaves contain original image bytes and filenames. They can therefore retain source metadata and identifying information. Treat them with the same care as the source images.

## Export resolution

Output width is `round(width_mm / 25.4 × dpi)` pixels. At 174 mm and 600 dpi, the PNG is 4110 pixels wide. Geometry, text and arrows render at the output size. PNG pHYs stores an integer pixels-per-metre value: 600 dpi is represented by 23622 ppm, or 599.9988 dpi. That tiny difference is normal quantization.

The interface supports widths of 20–500 mm and resolutions of 72–2400 dpi, subject to a combined export limit of **16,384 pixels per side and 100 megapixels**. Reduce DPI, width or row count if a figure exceeds those limits. These limits avoid excessive allocation; they do not guarantee every device has enough memory for the largest supported export.

The `src ≈ N dpi` readout estimates the sampling density of the lowest-resolution placed source after crop, rotation and zoom at the final width. A large 600-dpi canvas does not restore detail to a low-resolution source. Source images can also already have been upscaled or compressed before import. Check source provenance and output quality independently.

Publisher presets are convenient dimensions, not verified compliance with every journal. Confirm the target journal's current requirements.

## Audit an exported PNG

Python 3, standard library only:

```sh
python validate_dpi.py Figure-complete-600dpi.png --width-mm 174 --expect-dpi 600
```

The audit checks PNG structure, checksums and supported pixel-stream structure, resolution units and both axes, and the relationship between physical width and pixel width. Exit code 0 indicates these checks passed. It does not evaluate ROI retention, clinical information, source-image detail, image manipulation, or all possible publication requirements. Also open the image in an independent image viewer before submission.

## Local processing and privacy

The current HTML contains no upload code and no remotely loaded scripts, fonts or styles. A Content Security Policy restricts page connections and resource loads. In the tested local workflow, no page HTTP(S) requests were observed.

These application-level controls do not govern browser extensions, operating-system synchronization, where downloads are stored, or modified copies of the software. The de-identification checklist is a **reminder**, not an export gate and not an automatic identifier detector. It does not remove names, dates, faces or annotations already embedded in image pixels.

## Development checks

Browser regressions require Node.js, Playwright and an installed Chrome (or set `CHROME_BIN` to an executable):

```sh
node tests/browser.cjs
```

If Playwright is in a shared runtime, set `NODE_PATH` to its `node_modules` directory. The test creates synthetic images in a temporary directory and verifies physical-width preview changes, preview zoom and hit testing, export, metadata replacement, project recovery, large-image autosave, legacy migration, denied storage and error handling. It prints the result directory. It uses isolated browser profiles.

Run the PNG auditor regressions from this directory:

```sh
python -m unittest discover -s tests -p 'test_*.py'
```

Browser checks establish behavior only in the tested browser/OS; repeat on the environments used in the study. System fonts and browser rendering may differ across machines.

## License

MIT — see [LICENSE](LICENSE). Provided as-is, without warranty.
