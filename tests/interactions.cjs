// Run: NODE_PATH=/path/to/node_modules node tests/interactions.cjs
// Uses isolated browser storage and synthetic images; requires Playwright and Chrome.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.resolve(__dirname, '../figure-builder.html')).href;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cpf-interactions-'));
const checks = [], errors = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }
async function ready(page) { await page.waitForFunction(() => typeof initializing !== 'undefined' && !initializing); }
async function project(page) { return page.evaluate(() => JSON.parse(projectJSON())); }
async function panelPoint(page, index) {
 return page.evaluate(i => {
  const r = stage.getBoundingClientRect(), c = cells[i];
  return { x: r.left + (c.x + c.w / 2) * displayScale, y: r.top + (c.y + c.h / 2) * displayScale };
 }, index);
}
async function selectPanel(page, index) {
 const point = await panelPoint(page, index);
 await page.mouse.click(point.x, point.y);
 await page.waitForFunction(i => selCell === i, index);
}
async function arrowEndpoint(page, cellIndex, arrowIndex) {
 return page.evaluate(([ci, ai]) => {
  const r = stage.getBoundingClientRect(), c = cells[ci], a = c.arrows[ai];
  return { x: r.left + (c.x + a.x1 * c.w) * displayScale, y: r.top + (c.y + a.y1 * c.h) * displayScale };
 }, [cellIndex, arrowIndex]);
}
async function dropThumbnail(page, imageIndex, cellIndex) {
 const position = await page.evaluate(i => ({ x: (cells[i].x + cells[i].w / 2) * displayScale, y: (cells[i].y + cells[i].h / 2) * displayScale }), cellIndex);
 await page.locator('.thumb').nth(imageIndex).dragTo(page.locator('#stage'), { targetPosition: position });
}
async function editState(page) {
 return page.evaluate(() => ({ revision: saveRevision, historyIndex, selCell, selArrow }));
}
async function withDialog(page, accept, action) {
 let observed;
 const handler = async dialog => {
  observed = { type: dialog.type(), message: dialog.message() };
  await (accept ? dialog.accept() : dialog.dismiss());
 };
 page.once('dialog', handler);
 try { await action(); }
 finally { page.off('dialog', handler); }
 return observed;
}

(async () => {
 const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
 try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await ready(page);

  // A tall fixed-size preview must remain scrollable without changing image crops.
  const first = await panelPoint(page, 0);
  await page.mouse.move(first.x, first.y);
  const initialZoom = await page.evaluate(() => cells[0].zoom);
  await page.mouse.wheel(0, 250);
  await page.waitForFunction(() => document.getElementById('main').scrollTop > 0);
  check('Ordinary wheel scrolls the figure without changing crop', await page.evaluate(() => cells[0].zoom) === initialZoom);
  await page.evaluate(() => document.getElementById('main').scrollTop = 0);
  await selectPanel(page, 0);
  await page.locator('#zoom').fill('200');
  const zoomPoint = await panelPoint(page, 0); await page.mouse.move(zoomPoint.x, zoomPoint.y);
  await page.keyboard.down('Alt'); await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => Math.abs(cells[0].zoom - 2.16) < 1e-9);
  const scrollDuringZoom = await page.evaluate(() => document.getElementById('main').scrollTop);
  await page.mouse.wheel(0, 100); await page.keyboard.up('Alt');
  await page.waitForFunction(() => Math.abs(cells[0].zoom - 2) < 1e-9);
  check('Alt-wheel zoom reverses exactly without scrolling', scrollDuringZoom === 0 && await page.evaluate(() => document.getElementById('main').scrollTop) === 0);
  check('Ctrl/pinch gestures are not intercepted as crop zoom', await page.evaluate(() => {
   const before = cells[0].zoom, r = stage.getBoundingClientRect(), c = cells[0];
   return [false, true].every(altKey => {
    const event = new WheelEvent('wheel', { clientX: r.left + (c.x + c.w / 2) * displayScale, clientY: r.top + (c.y + c.h / 2) * displayScale, deltaY: -100, ctrlKey: true, altKey, bubbles: true, cancelable: true });
    stage.dispatchEvent(event); return cells[0].zoom === before && !event.defaultPrevented;
   });
  }));

  await page.locator('#addArrow').click();
  await page.locator('#addArrow').click(); await page.locator('[data-c="#19d36b"]').click();
  const originalArrow = await page.evaluate(() => structuredClone(cells[0].arrows[0]));
  const overlap = await arrowEndpoint(page, 0, 1);
  await page.mouse.move(overlap.x, overlap.y); await page.mouse.down(); await page.mouse.move(overlap.x - 35, overlap.y - 25); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => cells[0].arrows[0]), originalArrow);
  check('Dragging overlapping handles moves the selected arrow first', await page.evaluate(() => selArrow === 1 && cells[0].arrows[1].x1 !== cells[0].arrows[0].x1));
  const redEndpoint = await arrowEndpoint(page, 0, 0); await page.mouse.click(redEndpoint.x, redEndpoint.y);
  check('Selecting an older arrow synchronizes preset and custom color controls', await page.evaluate(() =>
   selArrow === 0 && document.querySelector('#arrowColors .swatch.sel')?.dataset.c === '#ff3b30' && document.getElementById('arrowCustom').value === '#ff3b30'));
  await page.locator('[data-c="#ffcc00"]').click();
  await page.locator('#arrowCustom').evaluate(input => { input.value = '#1177aa'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  check('Custom arrow colors clear an unrelated preset selection', await page.evaluate(() => cells[0].arrows[0].color === '#1177aa' && !document.querySelector('#arrowColors .swatch.sel')));
  await page.locator('#undo').click();
  check('Undo restores the arrow color and both color controls together', await page.evaluate(() =>
   cells[0].arrows[selArrow].color === '#ffcc00' && document.querySelector('#arrowColors .swatch.sel')?.dataset.c === '#ffcc00' && document.getElementById('arrowCustom').value === '#ffcc00'));
  const greenEndpoint = await arrowEndpoint(page, 0, 1); await page.mouse.click(greenEndpoint.x, greenEndpoint.y);
  await page.locator('#arrowsShow').uncheck();
  await page.mouse.move(greenEndpoint.x, greenEndpoint.y); await page.mouse.down();
  check('Hidden arrow handles cannot intercept a pan gesture', await page.evaluate(() => drag?.type === 'pan'));
  await page.mouse.up(); await page.locator('#arrowsShow').check(); await page.locator('#delArrow').click();
  const edgeStart = await arrowEndpoint(page, 0, 0);
  const edge = await page.evaluate(() => { const r = stage.getBoundingClientRect(), c = cells[0]; return { x: r.left + (c.x + c.w) * displayScale - 2, y: r.top + (c.y + c.h * .7) * displayScale }; });
  await page.mouse.move(edgeStart.x, edgeStart.y); await page.mouse.down(); await page.mouse.move(edge.x, edge.y); await page.mouse.up();
  const neighbour = await page.evaluate(() => { const r = stage.getBoundingClientRect(), c = cells[1]; return { x: r.left + c.x * displayScale + 2, y: r.top + (c.y + c.h * .7) * displayScale }; });
  await page.mouse.click(neighbour.x, neighbour.y);
  check('A nearby arrow handle does not steal clicks inside another panel', await page.evaluate(() => selCell === 1));
  await selectPanel(page, 0);
  const endpoint = await arrowEndpoint(page, 0, 0);
  await page.mouse.move(endpoint.x, endpoint.y); await page.mouse.down();
  await page.keyboard.press('Delete'); await page.mouse.move(endpoint.x + 20, endpoint.y + 20); await page.mouse.up();
  check('Deleting an arrow during a drag cancels that drag without an exception', errors.length === 0 && await page.evaluate(() => drag === null && cells[0].arrows.length === 0));
  const panPoint = await panelPoint(page, 0); await page.mouse.move(panPoint.x, panPoint.y); await page.mouse.down();
  assert.equal(await page.evaluate(() => drag.type), 'pan');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('Losing window focus ends an in-progress drag', await page.evaluate(() => drag === null));
  await page.mouse.move(panPoint.x + 10, panPoint.y + 10); await page.mouse.up();

  // OS drag events cannot be generated by Playwright's mouse API; exercise their DOM boundary contract.
  check('File-drag overlay clears at all window edges and ignores non-file drags', await page.evaluate(() => {
   const overlay = document.getElementById('drop'), dataTransfer = new DataTransfer();
   dataTransfer.items.add(new File(['synthetic'], 'test.png', { type: 'image/png' }));
   for (const [x, y] of [[innerWidth + 1, 250], [500, innerHeight + 1], [500, -1], [-1, 250]]) {
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer, clientX: 100, clientY: 100, bubbles: true }));
    if (overlay.style.display !== 'flex') return false;
    window.dispatchEvent(new DragEvent('dragleave', { dataTransfer, clientX: x, clientY: y, bubbles: true }));
    if (overlay.style.display !== 'none') return false;
   }
   window.dispatchEvent(new DragEvent('dragenter', { clientX: 100, clientY: 100, bubbles: true }));
   return overlay.style.display === 'none';
  }));
  await context.close();

  // Start a separate document history for the destructive-layout and undo workflows.
  const historyContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const editor = await historyContext.newPage();
  editor.on('pageerror', e => errors.push(e.message));
  await editor.goto(url); await ready(editor);
  check('A new workspace has no undo or redo steps', await editor.locator('#undo').isDisabled() && await editor.locator('#redo').isDisabled());
  await editor.locator('#previewZoom').selectOption('fit');
  await editor.locator('#preset').selectOption('g33');
  const fixtures = await editor.evaluate(() => ['#365f84', '#82512f'].map((color, i) => {
   const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600;
   const g = canvas.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 900, 600);
   g.fillStyle = 'white'; g.font = '36px sans-serif'; g.fillText('SYNTHETIC ' + (i + 1), 50, 80);
   return canvas.toDataURL().split(',')[1];
  }));
  await editor.locator('#file').setInputFiles(fixtures.map((data, i) => ({ name: `history-source-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await editor.waitForFunction(() => images.length === 2 && !ioBusy);
  await selectPanel(editor, 8); await editor.locator('.thumb').first().click();
  await editor.locator('#imageFit').selectOption('contain');
  await editor.locator('#zoom').fill('175'); await editor.locator('#rotF').fill('33');
  const lastPoint = await panelPoint(editor, 8);
  await editor.mouse.move(lastPoint.x, lastPoint.y); await editor.mouse.down(); await editor.mouse.move(lastPoint.x + 12, lastPoint.y - 7); await editor.mouse.up();
  await editor.locator('#lblText').fill('Retain panel I'); await editor.locator('#page2').check();
  await editor.locator('#cellBd').selectOption('on'); await editor.locator('#addArrow').click();
  await editor.locator('#arrowWidthMm').fill('0.8'); await editor.locator('[data-c="#ffcc00"]').click();
  await editor.locator('#grid').check();
  const complete = await project(editor);
  assert.equal(complete.cells[8].fit, 'contain'); assert.equal(complete.cells[8].zoom, 1.75);
  assert.equal(complete.cells[8].arrows.length, 1); assert.equal(complete.images.length, 2);

  const beforeRepeat = await editState(editor);
  const repeatedDialog = await withDialog(editor, false, () => editor.locator('.thumb').first().click());
  assert.deepEqual(await project(editor), complete); assert.deepEqual(await editState(editor), beforeRepeat);
  check('Clicking the same source again preserves crop, annotations and history', repeatedDialog === undefined);

  const cancelledReplacement = await withDialog(editor, false, () => editor.locator('.thumb').nth(1).click());
  assert.deepEqual(await project(editor), complete); assert.deepEqual(await editState(editor), beforeRepeat);
  check('Cancelling image replacement changes neither the figure nor autosave state', cancelledReplacement?.type === 'confirm' && /arrows/.test(cancelledReplacement.message));
  await withDialog(editor, true, () => editor.locator('.thumb').nth(1).click());
  check('Replacing an annotated image clears old arrows and arrow selection', await editor.evaluate(() => cells[8].imgId === images[1].id && !cells[8].arrows.length && selArrow === -1));
  assert.equal((await project(editor)).cells[8].labelText, complete.cells[8].labelText);
  assert.equal((await project(editor)).cells[8].bd, complete.cells[8].bd);
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), complete);
  check('Undo after image replacement restores the previous image, crop and arrows', true);

  const beforeDrop = await editState(editor);
  const cancelledDrop = await withDialog(editor, false, () => dropThumbnail(editor, 1, 8));
  assert.deepEqual(await project(editor), complete); assert.deepEqual(await editState(editor), beforeDrop);
  check('Cancelling drag-and-drop replacement does not alter selection or autosave', cancelledDrop?.type === 'confirm');
  await withDialog(editor, true, () => dropThumbnail(editor, 1, 8));
  assert.equal(await editor.evaluate(() => cells[8].imgId), complete.images[1].id);
  assert.equal(await editor.evaluate(() => cells[8].arrows.length), 0);
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), complete);
  check('Drag-and-drop replacement shares annotation cleanup and remains undoable', true);

  const beforeClear = await editState(editor);
  const cancelledClear = await withDialog(editor, false, () => editor.locator('#clearImg').click());
  assert.deepEqual(await project(editor), complete); assert.deepEqual(await editState(editor), beforeClear);
  check('Cancelling Clear image preserves image annotations and history', cancelledClear?.type === 'confirm');
  await withDialog(editor, true, () => editor.locator('#clearImg').click());
  check('Clear image removes its arrows and selection but retains the panel label and frame', await editor.evaluate(() =>
   cells[8].imgId === null && !cells[8].arrows.length && selArrow === -1 && cells[8].labelText === 'Retain panel I' && cells[8].bd === 'on'));
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), complete);
  check('Undo after Clear image restores the image and its annotations', true);

  const cancelled = await withDialog(editor, false, () => editor.locator('#preset').selectOption('g22'));
  assert.deepEqual(await project(editor), complete);
  check('Cancelling a smaller layout preserves every panel and setting', cancelled?.type === 'confirm' && await editor.locator('#preset').inputValue() === 'g33');
  const accepted = await withDialog(editor, true, () => editor.locator('#preset').selectOption('g22'));
  check('Reducing a populated layout requires confirmation', accepted?.type === 'confirm' && await editor.evaluate(() => cells.length === 4));
  const reduced = await project(editor);
  await editor.locator('#undo').click();
  assert.deepEqual(await project(editor), complete);
  check('Undo restores removed panels, fit, crop, text, arrows and source images', true);
  await editor.locator('#redo').click(); assert.deepEqual(await project(editor), reduced);
  check('Redo reapplies the reduced layout', true);
  await editor.locator('#undo').click();

  await withDialog(editor, true, () => editor.locator('#newp').click());
  assert.equal(await editor.evaluate(() => images.length), 0);
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), complete);
  check('Undo after New restores placed and unused source images and the complete figure', true);
  await editor.locator('#delArrow').click(); assert.equal(await editor.evaluate(() => cells[8].arrows.length), 0);
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), complete);
  check('Deleting an arrow is reversible with Undo', true);

  // Test both supported shortcut modifiers, independently of the host OS's native bindings.
  for (const modifier of ['Control', 'Meta']) {
   const baseline = await project(editor);
   await editor.locator('#wmm').fill('85'); const changed = await project(editor);
   await editor.locator('#previewZoom').focus();
   await editor.keyboard.press(`${modifier}+z`); assert.deepEqual(await project(editor), baseline);
   await editor.keyboard.press(`${modifier}+Shift+z`); assert.deepEqual(await project(editor), changed);
   check(`${modifier}+Z and ${modifier}+Shift+Z undo and redo figure edits`, true);
   await editor.locator('#undo').click(); assert.deepEqual(await project(editor), baseline);
  }

  // Native editing undo must remain inside the focused text field.
  await editor.locator('#lblText').fill('Native label');
  await editor.locator('#lblText').press('End'); await editor.locator('#lblText').pressSequentially('!');
  const beforeNativeUndo = await project(editor);
  await editor.evaluate(() => {
   window.nativeUndoPrevented = null;
   window.addEventListener('keydown', function inspect(event) {
    if (event.key.toLowerCase() === 'z') { window.nativeUndoPrevented = event.defaultPrevented; window.removeEventListener('keydown', inspect); }
   });
  });
  await editor.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  const afterNativeUndo = await project(editor);
  assert.equal(await editor.evaluate(() => window.nativeUndoPrevented), false, 'The editor must not prevent native text undo');
  assert.equal(await editor.locator('#lblText').inputValue(), 'Native label', 'Native undo removes the typed suffix');
  assert.equal(afterNativeUndo.cells[8].imgId, beforeNativeUndo.cells[8].imgId);
  assert.deepEqual(afterNativeUndo.cells[8].arrows, beforeNativeUndo.cells[8].arrows);
  check('Focused text fields keep native undo instead of triggering figure history', true);

  await selectPanel(editor, 0); await editor.locator('.thumb').first().click(); await editor.locator('#addArrow').click();
  await selectPanel(editor, 1); await editor.locator('.thumb').nth(1).click(); await editor.locator('#addArrow').click();
  await selectPanel(editor, 8);
  const restoredEndpoint = await arrowEndpoint(editor, 8, 0); await editor.mouse.click(restoredEndpoint.x, restoredEndpoint.y);
  const beforeImageRemoval = await project(editor), beforeRemovalState = await editState(editor);
  const cancelledRemoval = await withDialog(editor, false, () => editor.locator('.thumb .rm').first().click());
  assert.deepEqual(await project(editor), beforeImageRemoval); assert.deepEqual(await editState(editor), beforeRemovalState);
  check('Cancelling source-image removal preserves all placements and annotations', cancelledRemoval?.type === 'confirm' && /arrows/.test(cancelledRemoval.message));
  await withDialog(editor, true, () => editor.locator('.thumb .rm').first().click());
  assert.equal(await editor.evaluate(() => images.length), 1);
  assert.equal(await editor.evaluate(() => cells[8].imgId), null);
  check('Source removal clears arrows on all affected panels and preserves unrelated panels', await editor.evaluate(() =>
   cells[0].imgId === null && !cells[0].arrows.length && !cells[8].arrows.length && selArrow === -1 && cells[1].imgId === images[0].id && cells[1].arrows.length === 1));
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), beforeImageRemoval);
  check('Undo restores a deleted source image and every panel using it', true);

  // A different project can reuse numeric image IDs; undo must still restore the right image bytes.
  const replacement = await editor.evaluate(() => {
   const data = JSON.parse(projectJSON()), canvas = document.createElement('canvas');
   canvas.width = 900; canvas.height = 600;
   const g = canvas.getContext('2d'); g.fillStyle = '#1f8650'; g.fillRect(0, 0, 900, 600);
   g.fillStyle = 'white'; g.font = '36px sans-serif'; g.fillText('DIFFERENT SOURCE, SAME ID', 40, 80);
   data.images[0].src = canvas.toDataURL(); data.images[0].name = 'replacement-source.png';
   data.cells[8].labelText = 'Replacement project'; data.hmm = 100;
   return data;
  });
  await withDialog(editor, true, () => editor.locator('#pfile').setInputFiles({
   name: 'replacement-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement))
  }));
  await editor.waitForFunction(() => images[0]?.name === 'replacement-source.png' && !ioBusy);
  const afterProjectLoad = await project(editor);
  assert.equal(afterProjectLoad.images[0].id, beforeImageRemoval.images[0].id);
  assert.notEqual(afterProjectLoad.images[0].src, beforeImageRemoval.images[0].src);
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), beforeImageRemoval);
  await editor.locator('#redo').click(); assert.deepEqual(await project(editor), afterProjectLoad);
  check('Undo and Redo across project loading preserve distinct image bytes with reused IDs', true);

  await editor.locator('#hmm').fill('250');
  const changedHeight = await project(editor);
  assert.ok(Math.abs(await editor.evaluate(() => outputInfo().physH) - 250) < 1e-8);
  await editor.locator('#undo').click(); assert.deepEqual(await project(editor), afterProjectLoad);
  assert.ok(Math.abs(await editor.evaluate(() => outputInfo().physH) - 100) < 1e-8);
  await editor.locator('#redo').click(); assert.deepEqual(await project(editor), changedHeight);
  assert.ok(Math.abs(await editor.evaluate(() => outputInfo().physH) - 250) < 1e-8);
  check('Custom figure height and geometry survive Undo and Redo', true);

  await editor.waitForFunction(() => saveRevision > 0 && saveRevision === storedRevision);
  const revisionBeforeTyping = await editor.evaluate(() => saveRevision);
  await editor.locator('#lblPt').fill('8');
  check('Typing a valid point size updates the model before the field loses focus', await editor.evaluate(before =>
   document.activeElement.id === 'lblPt' && document.getElementById('lblPt').value === '8' &&
   Math.abs(physicalValue(labelOpts.size, true) - 8) < 1e-9 && saveRevision > before, revisionBeforeTyping));
  await editor.waitForFunction(() => saveRevision === storedRevision);
  assert.equal(await editor.evaluate(() => document.activeElement.id), 'lblPt');
  const storedPointSize = await editor.evaluate(async () => JSON.parse(await storeAccess()).labelOpts.size);
  assert.equal(storedPointSize, (await project(editor)).labelOpts.size);
  await editor.reload(); await ready(editor);
  check('An unblurred point-size edit is autosaved and survives reload',
   await editor.locator('#lblPt').inputValue() === '8' &&
   await editor.evaluate(() => Math.abs(physicalValue(labelOpts.size, true) - 8) < 1e-9 && images[0].name === 'replacement-source.png'));

  check('All interaction and history workflows have no JavaScript errors', errors.length === 0);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: await browser.version(), checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2));
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
