// Run: NODE_PATH=/path/to/node_modules node tests/editor.cjs
// Requires Playwright and Chrome. Uses synthetic images and an isolated profile.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cpf-editor-v051-'));
const url = pathToFileURL(path.resolve(__dirname, '../figure-builder.html')).href;
const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }
const closeTo = (a, b, tolerance = 1e-7) => Math.abs(a - b) <= tolerance;
async function ready(page) {
  await page.waitForFunction(() => typeof initializing !== 'undefined' && !initializing && !document.querySelector('.app').inert);
}
async function selectPanel(page, index) {
  const position = await page.evaluate(i => ({
    x: (cells[i].x + cells[i].w / 2) * displayScale,
    y: (cells[i].y + cells[i].h / 2) * displayScale,
  }), index);
  await page.locator('#stage').click({ position });
}
async function physical(page, id, value) {
  await page.locator('#' + id).fill(String(value));
  await page.locator('#' + id).press('Tab'); // Physical fields commit on change, as when used normally.
}
async function download(page, selector, filename) {
  const [item] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
  const destination = path.join(output, filename);
  await item.saveAs(destination);
  return destination;
}
function pngSize(filename) {
  const bytes = fs.readFileSync(filename);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.goto(url); await ready(page);
    await page.locator('#preset').selectOption('g22');
    await page.locator('#previewZoom').selectOption('fit');
    await page.locator('#wmm').fill('85'); await page.locator('#dpi').fill('300');

    // A wide source with four distinct corner markers exposes accidental cropping.
    const fixture = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 1200, 300);
      for (const [x, y, color] of [[0, 0, '#ff0000'], [1160, 0, '#00ff00'], [0, 260, '#0000ff'], [1160, 260, '#ffff00']]) {
        g.fillStyle = color; g.fillRect(x, y, 40, 40);
      }
      return c.toDataURL().split(',')[1];
    });
    await page.locator('#file').setInputFiles({ name: 'synthetic-corners.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64') });
    await page.waitForFunction(() => images.length === 1 && !document.querySelector('.app').inert);
    await selectPanel(page, 0); await page.locator('.thumb').click();
    await page.locator('#lblShow').uncheck();
    check('New panels default to Fill', await page.locator('#imageFit').inputValue() === 'cover');

    for (const mode of ['contain', 'cover']) {
      await page.locator('#imageFit').selectOption(mode);
      for (const angle of [0, 33, 90, -127]) {
        await page.locator('#rotF').fill(String(angle));
        const samples = await page.evaluate(() => {
          const cell = cells[0], im = images[0], results = [];
          for (const [panX, panY] of [[0, 0], [-1e6, -1e6], [1e6, 1e6]]) {
            cell.ox = panX; cell.oy = panY; drawScreen();
            const off = renderOffscreen(true), g = off.getContext('2d'), outputScale = off.width / LOGICAL_W;
            if (cell.fit === 'contain') {
              const scale = imageScaleFor(cell, im, cell.rot), radians = cell.rot * Math.PI / 180;
              const co = Math.cos(radians), si = Math.sin(radians);
              const transform = (x, y) => ({
                x: cell.w / 2 + cell.ox + (co * x - si * y) * scale,
                y: cell.h / 2 + cell.oy + (si * x + co * y) * scale,
              });
              const corners = [[-600, -150], [600, -150], [-600, 150], [600, 150]].map(([x, y]) => transform(x, y));
              const inside = corners.every(p => p.x >= -1e-7 && p.y >= -1e-7 && p.x <= cell.w + 1e-7 && p.y <= cell.h + 1e-7);
              const markers = [[-580, -130, [255, 0, 0]], [580, -130, [0, 255, 0]], [-580, 130, [0, 0, 255]], [580, 130, [255, 255, 0]]];
              const visible = markers.every(([x, y, rgb]) => {
                const point = transform(x, y);
                if (point.x < 0 || point.y < 0 || point.x >= cell.w || point.y >= cell.h) return false;
                const rgba = g.getImageData(Math.floor((cell.x + point.x) * outputScale), Math.floor((cell.y + point.y) * outputScale), 1, 1).data;
                return rgb.every((value, i) => Math.abs(value - rgba[i]) < 5) && rgba[3] === 255;
              });
              results.push(inside && visible);
            } else {
              // Fill must cover every panel corner, including after a large pan at a free angle.
              results.push([[2, 2], [cell.w - 2, 2], [2, cell.h - 2], [cell.w - 2, cell.h - 2]].every(([x, y]) => {
                const pixel = g.getImageData(Math.floor((cell.x + x) * outputScale), Math.floor((cell.y + y) * outputScale), 1, 1).data;
                return pixel[0] + pixel[1] + pixel[2] > 200 && pixel[3] === 255;
              }));
            }
          }
          return results;
        });
        check(`${mode === 'contain' ? 'Fit keeps all four source markers' : 'Fill covers all panel corners'} at ${angle} degrees and extreme pans`, samples.every(Boolean));
      }
    }
    await page.locator('#imageFit').selectOption('contain');
    await page.locator('#rotF').fill('33'); await page.locator('#zoom').fill('200');
    check('Fit permits zoomed cropping with bounded panning', await page.evaluate(() => {
      const c = cells[0], im = images[0]; c.ox = 1e6; c.oy = -1e6; drawScreen();
      const s = imageScaleFor(c, im, c.rot) * c.zoom, r = c.rot * Math.PI / 180;
      const width = s * (im.w * Math.abs(Math.cos(r)) + im.h * Math.abs(Math.sin(r)));
      const height = s * (im.w * Math.abs(Math.sin(r)) + im.h * Math.abs(Math.cos(r)));
      return (width > c.w || height > c.h) && Math.abs(c.ox) <= Math.abs(c.w - width) / 2 + 1e-7 && Math.abs(c.oy) <= Math.abs(c.h - height) / 2 + 1e-7;
    }));
    await page.locator('#imageFit').selectOption('cover');
    check('Changing fit mode resets crop while preserving rotation', await page.evaluate(() => cells[0].zoom === 1 && cells[0].ox === 0 && cells[0].oy === 0 && cells[0].rot === 33));
    await page.locator('#imageFit').selectOption('contain'); await page.locator('#rotF').fill('0');

    // The neighboring empty slot must remain empty in both preview and PNG.
    await page.locator('#lblShow').check();
    await page.locator('#lblText').fill('PREOPERATIVE SAGITTAL MAGNETIC RESONANCE IMAGE');
    await page.locator('#lblChip').check();
    await page.locator('#bg').evaluate(input => { input.value = '#8babc4'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    const clipping = await page.evaluate(() => {
      const countUnexpected = (canvas, scale, background) => {
        const d = canvas.getContext('2d').getImageData(Math.floor(560 * scale), Math.floor(30 * scale), Math.floor(380 * scale), Math.floor(45 * scale)).data;
        let changed = 0; for (let i = 0; i < d.length; i += 4) if (background.some((value, channel) => d[i + channel] !== value) || d[i + 3] !== 255) changed++;
        return changed;
      };
      const off = renderOffscreen(true);
      cells[1].page2 = true; const subset = renderOffscreen(false); cells[1].page2 = false;
      return { screen: countUnexpected(stage, displayScale, [16, 19, 25]), complete: countUnexpected(off, off.width / LOGICAL_W, [139, 171, 196]), subset: countUnexpected(subset, subset.width / LOGICAL_W, [139, 171, 196]) };
    });
    check('Long labels and chips stay inside their panel in preview, complete PNG and subset PNG', Object.values(clipping).every(n => n === 0));
    await page.locator('#lblText').fill('A'); await page.locator('#lblChip').uncheck();

    await page.locator('#wmm').fill('174'); await page.locator('#addArrow').click();
    const measurements = [
      ['gutterMm', 2], ['lblPt', 8], ['frWidthMm', 0.25], ['frRadiusMm', 2], ['arrowWidthMm', 0.4],
    ];
    for (const [id, value] of measurements) await physical(page, id, value);
    const printSizes = await page.evaluate(() => ({
      gutterMm: (cells[1].x - cells[0].x - cells[0].w) / LOGICAL_W * 174,
      lblPt: labelOpts.size / LOGICAL_W * 174 / 25.4 * 72,
      frWidthMm: frameOpts.width / LOGICAL_W * 174,
      frRadiusMm: frameOpts.radius / LOGICAL_W * 174,
      arrowWidthMm: cells[0].arrows[0].width / LOGICAL_W * 174,
    }));
    check('Committed pt/mm controls produce the requested print measurements', measurements.every(([id, value]) => closeTo(printSizes[id], value)));
    check('Physical gutter changes preserve the image fit choice', await page.evaluate(() => cells[0].fit === 'contain'));
    await page.locator('#wmm').fill('85');
    const scaledFields = await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, +document.getElementById(id).value])), measurements.map(([id]) => id));
    check('Print readouts follow figure width while stored figure geometry scales proportionally', measurements.every(([id, value]) => closeTo(scaledFields[id], value * 85 / 174, 0.001)));
    await page.locator('#dpi').fill('600');
    assert.deepEqual(await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, +document.getElementById(id).value])), measurements.map(([id]) => id)), scaledFields);
    check('DPI changes leave all print measurements unchanged', true);
    await page.locator('#dpi').fill('300');

    // Independent page height must survive width changes and constrain actual downloads.
    await page.locator('#previewZoom').selectOption('100');
    await page.locator('#wmm').fill('174'); await page.locator('#hmm').fill('100');
    const full174 = pngSize(await download(page, '#expFull', '174x100mm.png'));
    const height174 = await page.locator('#stage').evaluate(c => c.getBoundingClientRect().height);
    check('174 by 100 mm exports as 2055 by 1181 pixels at 300 dpi', full174.width === 2055 && full174.height === 1181);
    await page.locator('#wmm').fill('85');
    const full85 = pngSize(await download(page, '#expFull', '85x100mm.png'));
    const height85 = await page.locator('#stage').evaluate(c => c.getBoundingClientRect().height);
    check('Changing width to 85 mm keeps the 100 mm height in the preview and PNG', full85.width === 1004 && full85.height === 1181 && Math.abs(height85 - height174) <= 1 && await page.locator('#hmm').inputValue() === '100');
    const firstRowHeight = await page.evaluate(() => cells[0].h);
    for (const index of [2, 3]) { await selectPanel(page, index); await page.locator('#page2').check(); }
    const subsetFile = await download(page, '#expQuiz', '85mm-first-row.png');
    const subsetSize = pngSize(subsetFile);
    const subsetGeometry = await page.evaluate(() => ({ height: subsetGeom().list[0].cell.h, expectedPixels: Math.round((2 * MARGIN + cells[0].h) * outputInfo().pxW / LOGICAL_W) }));
    check('Subset export preserves full-figure row height instead of stretching remaining rows', closeTo(subsetGeometry.height, firstRowHeight) && subsetSize.width === full85.width && subsetSize.height === subsetGeometry.expectedPixels && subsetSize.height < full85.height);
    await page.locator('#hmm').fill('19'); check('Custom heights below 20 mm block export', await page.locator('#expFull').isDisabled());
    await page.locator('#hmm').fill('1001'); check('Custom heights above 1000 mm block export', await page.locator('#expFull').isDisabled());
    await page.locator('#autoHeight').click();
    check('Auto height clears the fixed height and restores natural row proportions', await page.locator('#hmm').inputValue() === '' && await page.evaluate(() => cells[0].h === UNIT && JSON.parse(projectJSON()).hmm === null));
    await page.locator('#hmm').fill('100');

    const beforeFile = await download(page, '#expFull', 'project-before.png');
    const projectFile = await download(page, '#save', 'editor-v4.json');
    const original = JSON.parse(fs.readFileSync(projectFile));
    check('Project v4 stores custom height and per-panel Fit', original.v === 4 && original.hmm === 100 && original.cells[0].fit === 'contain');
    await page.locator('#wmm').fill('174'); await page.locator('#autoHeight').click();
    page.once('dialog', dialog => dialog.accept()); await page.locator('#pfile').setInputFiles(projectFile);
    await page.waitForFunction(() => document.getElementById('wmm').value === '85' && document.getElementById('hmm').value === '100' && !document.querySelector('.app').inert);
    assert.deepEqual(await page.evaluate(() => JSON.parse(projectJSON())), original);
    const afterFile = await download(page, '#expFull', 'project-restored.png');
    check('Project v4 round-trip restores all editor settings and identical PNG output', fs.readFileSync(beforeFile).equals(fs.readFileSync(afterFile)));

    const legacy = structuredClone(original); legacy.v = 3; delete legacy.hmm;
    for (const cell of legacy.cells) delete cell.fit;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#pfile').setInputFiles({ name: 'legacy-v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    await page.waitForFunction(() => document.getElementById('hmm').value === '' && !document.querySelector('.app').inert);
    check('Project v3 migration defaults to Fill and Auto height while retaining source images', await page.evaluate(() => {
      const restored = JSON.parse(projectJSON());
      return restored.v === 4 && restored.hmm === null && restored.cells.every(c => c.fit === 'cover') && restored.images.length === 1 && restored.cells[0].imgId === restored.images[0].id;
    }));
    check('Unsupported fit modes are rejected before replacing the current project', await page.evaluate(async () => {
      const before = projectJSON(), bad = JSON.parse(before); bad.cells[0].fit = 'invalid';
      try { await loadProject(bad); return false; } catch (_) { return before === projectJSON(); }
    }));
    const beforeInvalidImage = await page.evaluate(() => projectJSON());
    await page.locator('#file').setInputFiles({
      name: 'zero-size.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><rect width="10" height="10" fill="red"/></svg>'),
    });
    await page.waitForFunction(() => !ioBusy && document.getElementById('actionStatus').textContent.includes('zero-size.svg'));
    check('Importing a zero-size SVG reports failure and preserves all current images and panels',
      await page.evaluate(() => projectJSON()) === beforeInvalidImage &&
      (await page.locator('#actionStatus').textContent()).startsWith('Could not load:'));

    // Real typing passes through temporary widths/heights/gutters. Those previews
    // must not permanently clamp a crop before the final number has been entered.
    const geometryContext = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    const geometryPage = await geometryContext.newPage();
    geometryPage.on('pageerror', e => errors.push(e.message));
    geometryPage.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await geometryPage.goto(url); await ready(geometryPage);
    await geometryPage.locator('#hmm').fill('100'); await geometryPage.locator('#dpi').fill('300');
    await geometryPage.locator('#previewZoom').selectOption('50');
    const portrait = await geometryPage.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 800;
      const g = c.getContext('2d'), gradient = g.createLinearGradient(0, 0, 0, 800);
      gradient.addColorStop(0, 'red'); gradient.addColorStop(1, 'blue');
      g.fillStyle = gradient; g.fillRect(0, 0, 200, 800); return c.toDataURL().split(',')[1];
    });
    await geometryPage.locator('#file').setInputFiles({ name: 'synthetic-portrait.png', mimeType: 'image/png', buffer: Buffer.from(portrait, 'base64') });
    await geometryPage.waitForFunction(() => images.length === 1 && !ioBusy);
    await selectPanel(geometryPage, 0); await geometryPage.locator('.thumb').click();
    const panToEdge = async () => {
      const start = await geometryPage.evaluate(() => {
        const r = stage.getBoundingClientRect(), c = cells[0];
        return { x: r.left + (c.x + c.w / 2) * displayScale, y: r.top + (c.y + c.h / 2) * displayScale };
      });
      await geometryPage.mouse.move(start.x, start.y); await geometryPage.mouse.down();
      await geometryPage.mouse.move(start.x, start.y + 500, { steps: 8 }); await geometryPage.mouse.up();
    };
    const rememberCrop = () => geometryPage.evaluate(() => {
      window.cropBeforeTyping = { ox: cells[0].ox, oy: cells[0].oy, png: renderOffscreen(true).toDataURL() };
    });
    const cropUnchanged = () => geometryPage.evaluate(() =>
      Math.abs(cells[0].ox - window.cropBeforeTyping.ox) < 1e-7 && Math.abs(cells[0].oy - window.cropBeforeTyping.oy) < 1e-7 &&
      renderOffscreen(true).toDataURL() === window.cropBeforeTyping.png);
    for (const [field, value] of [['hmm', '100'], ['wmm', '500'], ['gutterMm', '12.5']]) {
      await geometryPage.locator('#' + field).fill(value); await geometryPage.locator('#' + field).press('Tab');
      await panToEdge(); await rememberCrop();
      await geometryPage.locator('#' + field).click();
      await geometryPage.locator('#' + field).press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await geometryPage.locator('#' + field).pressSequentially(value);
      check(`Retyping the same ${field} preserves the crop and exact PNG through intermediate digits`, await cropUnchanged());
      await geometryPage.locator('#' + field).press('Tab');
    }
    await panToEdge(); await rememberCrop();
    await geometryPage.locator('#hmm').fill('400'); await geometryPage.locator('#hmm').fill('100');
    check('Changing size and changing it back in one edit restores the original crop', await cropUnchanged());
    await geometryPage.locator('#hmm').press('Tab');
    await geometryPage.locator('#wmm').fill('85');
    const focusedDownload = async (selector, filename) => {
      const pending = geometryPage.waitForEvent('download');
      await geometryPage.locator(selector).dispatchEvent('click');
      const item = await pending, destination = path.join(output, filename); await item.saveAs(destination); return destination;
    };
    const liveProject = JSON.parse(fs.readFileSync(await focusedDownload('#save', 'size-edit-current.json')));
    const liveExport = pngSize(await focusedDownload('#expFull', 'size-edit-current.png'));
    check('Save and export use the current valid size even before the input loses focus',
      liveProject.wmm === 85 && liveProject.hmm === 100 && liveExport.width === 1004 && liveExport.height === 1181 &&
      await geometryPage.locator('#wmm').evaluate(input => document.activeElement === input));
    await geometryPage.locator('#wmm').press('Tab');
    const committedPan = await geometryPage.evaluate(() => cells[0].oy);
    await geometryPage.locator('#wmm').fill('500');
    check('A later size edit starts from the committed crop instead of an older editing session', closeTo(await geometryPage.evaluate(() => cells[0].oy), committedPan));

    check('No page JavaScript errors in editor regressions', errors.length === 0);
    check('Editor tests remain entirely offline', requests.length === 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: await browser.version(), checks, errors, requests }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
