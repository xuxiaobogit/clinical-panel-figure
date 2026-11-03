// Real input gestures: long typing, slider drags and wheel zoom must not consume
// the entire undo history. Run with the Playwright / Chrome setup in README.md.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const checks = [], errors = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }
async function project(page) { return page.evaluate(() => JSON.parse(projectJSON())); }
async function selectPanel(page, index) {
  const point = await page.evaluate(i => {
    const r = stage.getBoundingClientRect(), c = cells[i];
    return { x: r.left + (c.x + c.w / 2) * displayScale, y: r.top + (c.y + c.h / 2) * displayScale };
  }, index);
  await page.mouse.click(point.x, point.y);
  return point;
}
(async () => {
  const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../figure-builder.html')).href);
    await page.waitForFunction(() => !initializing);
    await page.locator('#previewZoom').selectOption('fit');
    await page.locator('#preset').selectOption('r2');
    const source = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
      const g = canvas.getContext('2d'); g.fillStyle = '#6392ab'; g.fillRect(0, 0, 600, 400);
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('#file').setInputFiles({ name: 'history.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') });
    await page.waitForFunction(() => images.length === 1 && !ioBusy);
    await selectPanel(page, 0); await page.locator('.thumb').click();
    const beforeTyping = await project(page);
    await page.locator('#lblText').focus();
    await page.locator('#lblText').pressSequentially('A long scientific panel label. '.repeat(4));
    const afterTyping = await project(page);
    await page.waitForFunction(() => saveRevision === storedRevision);
    check('A long label is still autosaved before leaving the field', await page.evaluate(() =>
      document.activeElement.id === 'lblText' && JSON.parse(storeBasePayload).cells[0].labelText === cells[0].labelText));
    await page.locator('#undo').click(); assert.deepEqual(await project(page), beforeTyping);
    check('One Undo removes a whole typing session of more than 100 characters', true);
    await page.locator('#undo').click();
    check('Earlier image placement remains undoable after a long typing session', await page.evaluate(() => cells[0].imgId === null && images.length === 1));
    await page.locator('#redo').click(); await page.locator('#redo').click(); assert.deepEqual(await project(page), afterTyping);
    check('Redo restores both the earlier image and the complete label', true);

    await page.locator('#lblText').press('End'); await page.locator('#lblText').pressSequentially(' next session');
    const separateSession = await project(page);
    await page.locator('#undo').click(); assert.deepEqual(await project(page), afterTyping);
    await page.locator('#redo').click(); assert.deepEqual(await project(page), separateSession);
    check('Returning to the same text field starts a separate undo step', true);
    await page.locator('#lblText').focus(); await page.locator('#lblText').press('End');
    await page.locator('#lblText').pressSequentially(' before Enter'); await page.locator('#lblText').press('Enter');
    const atEnter = await project(page);
    await page.locator('#lblText').pressSequentially(' after Enter');
    await page.locator('#undo').click(); assert.deepEqual(await project(page), atEnter);
    check('Enter separates two edits even when the text field stays focused', true);

    const beforeSlider = await project(page);
    await page.locator('#zoom').scrollIntoViewIfNeeded();
    let slider = await page.locator('#zoom').boundingBox();
    await page.mouse.move(slider.x + 8, slider.y + slider.height / 2); await page.mouse.down();
    await page.mouse.move(slider.x + slider.width * 0.85, slider.y + slider.height / 2, { steps: 80 }); await page.mouse.up();
    const afterSlider = await project(page);
    assert.notEqual(afterSlider.cells[0].zoom, beforeSlider.cells[0].zoom);
    await page.locator('#undo').click(); assert.deepEqual(await project(page), beforeSlider);
    await page.locator('#redo').click(); assert.deepEqual(await project(page), afterSlider);
    check('A continuous slider drag is exactly one undo and redo step', true);
    await page.locator('#zoom').scrollIntoViewIfNeeded(); slider = await page.locator('#zoom').boundingBox();
    await page.mouse.click(slider.x + slider.width * 0.3, slider.y + slider.height / 2);
    await page.locator('#undo').click(); assert.deepEqual(await project(page), afterSlider);
    check('A second slider gesture stays separate from the first', true);

    const point = await selectPanel(page, 0);
    const beforeWheel = await project(page);
    await page.mouse.move(point.x, point.y); await page.keyboard.down('Alt');
    for (let i = 0; i < 65; i++) await page.mouse.wheel(0, 2);
    await page.keyboard.up('Alt');
    await page.waitForFunction(zoom => cells[0].zoom < zoom, beforeWheel.cells[0].zoom);
    const afterWheel = await project(page);
    await page.locator('#undo').click(); assert.deepEqual(await project(page), beforeWheel);
    await page.locator('#redo').click(); assert.deepEqual(await project(page), afterWheel);
    check('A wheel zoom gesture retains its starting crop in one undo step', true);

    await page.locator('#lblPt').fill('12'); await page.locator('#lblPt').press('Enter');
    const beforeNumber = await project(page);
    await page.locator('#lblPt').press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.locator('#lblPt').pressSequentially('10.25');
    assert.ok(Math.abs(await page.evaluate(() => physicalValue(labelOpts.size, true)) - 10.25) < 1e-9);
    await page.locator('#undo').click(); assert.deepEqual(await project(page), beforeNumber);
    check('Typing a multi-digit physical size undoes to the value before typing', true);

    const beforeBranch = await project(page);
    await page.locator('#lblText').fill('Discarded branch'); await page.locator('#undo').click();
    await page.locator('#lblText').fill('Replacement branch');
    check('Editing after Undo clears the old redo branch', await page.locator('#redo').isDisabled());
    await page.locator('#undo').click(); assert.deepEqual(await project(page), beforeBranch);
    check('A new input session after Undo preserves the earlier project', true);
    check('No JavaScript errors during grouped history workflows', errors.length === 0);
    console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
