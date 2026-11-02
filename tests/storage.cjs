// Run with the same Playwright / Chrome setup as tests/browser.cjs.
// These tests use isolated browser profiles and synthetic images only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.resolve(__dirname, '../figure-builder.html')).href;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cpf-storage-'));
const checks = [];
const pageErrors = [];
function check(name, value) { assert.ok(value, name); checks.push(name); }
async function ready(page) { await page.waitForFunction(() => !initializing); }
async function saved(page) { await page.waitForFunction(() => saveRevision > 0 && storedRevision === saveRevision && !lastSaveError); }
async function open(context) { const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message)); await page.goto(url); await ready(page); return page; }
async function download(page, selector, name) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
  const destination = path.join(output, name); await file.saveAs(destination); return JSON.parse(fs.readFileSync(destination));
}
(async () => {
  const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    const a = await open(context);
    const png = await a.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
      const g = canvas.getContext('2d'); g.fillStyle = '#8242c4'; g.fillRect(0, 0, 160, 120);
      return canvas.toDataURL().split(',')[1];
    });
    const fixture = name => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await a.locator('#file').setInputFiles(fixture('base.png')); await saved(a);
    const firstRevision = await a.evaluate(() => storeBaseRevision);
    const b = await open(context); await saved(b);
    check('Opening a second tab does not write a new project revision', await b.evaluate(() => storeBaseRevision) === firstRevision);
    check('Opening a second tab leaves the first editor writable', !await a.evaluate(() => saveConflict));
    await a.locator('#file').setInputFiles(fixture('new-important.png')); await saved(a);
    await a.locator('#wmm').fill('120'); await saved(a);
    await b.waitForFunction(() => saveConflict);
    await b.locator('#wmm').fill('85');
    const persisted = await a.evaluate(async () => JSON.parse(await storeAccess()));
    check('A stale tab cannot overwrite new images or output settings', persisted.images.length === 2 && persisted.wmm === 120);
    check('A stale tab displays conflict recovery controls', await b.locator('#loadLatest').isVisible() && await b.locator('#storageConflict').isVisible());
    const copy = await download(b, '#saveCurrentCopy', 'conflicting-tab.json');
    check('A conflicting tab can still download its own project', copy.images.length === 1 && copy.wmm === 85);
    b.once('dialog', dialog => dialog.accept()); await b.locator('#loadLatest').click();
    await b.waitForFunction(() => !ioBusy && !saveConflict && images.length === 2 && document.getElementById('wmm').value === '120');
    await saved(b); await b.locator('#wmm').fill('85'); await saved(b);
    check('Loading the latest save accepts the new base and permits later edits', await b.evaluate(async () => JSON.parse(await storeAccess()).wmm === 85));
    await context.close();

    // Without notifications, simultaneous writers must still be serialized by IDB.
    const raceContext = await browser.newContext(); const raceA = await open(raceContext);
    await raceA.locator('#wmm').fill('100'); await saved(raceA);
    const raceB = await open(raceContext); await saved(raceB);
    const results = await Promise.all([[raceA, 101], [raceB, 102]].map(([page, width]) => page.evaluate(async width => {
      saveChannel?.close(); document.getElementById('wmm').value = width; saveLocal(); await flushLocal();
      return { conflict: lastSaveError?.code === 'AUTOSAVE_CONFLICT', revision: storeBaseRevision };
    }, width)));
    check('The write transaction rejects exactly one simultaneous stale writer', results.filter(result => result.conflict).length === 1);
    await raceContext.close();

    const historyContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const history = await open(historyContext);
    await history.locator('#file').setInputFiles(fixture('history-image.png')); await saved(history);
    for (let width = 90; width < 115; width++) {
      await history.locator('#wmm').fill(String(width)); await history.locator('#keepRecovery').click();
      await history.waitForFunction(width => storedRevision === saveRevision && !lastSaveError && JSON.parse(storeBasePayload).wmm === width, width);
    }
    const inventory = await history.evaluate(async () => {
      const db = await openStore();
      const keys = await new Promise((resolve, reject) => {
        const tx = db.transaction('projects'), request = tx.objectStore('projects').getAllKeys();
        tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
      });
      return { points: recoveryIndex.length, assets: keys.filter(key => key.startsWith('recovery-image:')).length,
        compact: await new Promise((resolve, reject) => {
          const tx = db.transaction('projects'), request = tx.objectStore('projects').get('recovery:' + recoveryIndex[0].id);
          tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
        }), target: recoveryIndex[0].id };
    });
    check('Recovery rotates old points while retaining at least ten versions', inventory.points >= 10 && inventory.points <= 20);
    check('Unchanged source images are stored once across all saved versions', inventory.assets === 1 && !inventory.compact.includes('data:image/'));
    const selected = await history.evaluate(id => readRecoveryProject(id), inventory.target);
    await history.locator('#recoveryList').selectOption(inventory.target);
    history.once('dialog', dialog => dialog.accept()); await history.locator('#restoreRecovery').click();
    await history.waitForFunction(width => !ioBusy && document.getElementById('wmm').value === String(width), selected.wmm); await saved(history);
    check('A saved version restores its state and original image bytes', await history.evaluate(source => images.length === 1 && images[0].img.src.endsWith(source), png));
    check('Restoring also retains the previously current project', await history.evaluate(async () => {
      for (const entry of recoveryIndex) if ((await readRecoveryProject(entry.id)).wmm === 114) return true;
      return false;
    }));
    await history.reload(); await ready(history); await saved(history);
    check('Saved versions survive reloading the application', await history.evaluate(() => recoveryIndex.length >= 10));
    const originalProject = await history.evaluate(() => JSON.parse(projectJSON()));
    // This mimics the previous release's existing current-only database format.
    await history.evaluate(async project => {
      const db = await openStore(); await new Promise((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
        store.clear(); store.put(JSON.stringify(project), 'current');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    }, originalProject);
    await history.reload(); await ready(history); await saved(history);
    check('The old plain-string current record migrates without losing images', await history.evaluate(async () => {
      const data = await storeAccess(); return typeof data === 'string' && JSON.parse(data).images.length === 1 && recoveryIndex.length >= 1;
    }));
    await history.evaluate(async () => {
      const legacy = JSON.parse(projectJSON()); legacy.layoutName = 'g33'; legacy.cells[8].labelText = 'keep-before-migration';
      const db = await openStore(); await new Promise((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
        store.clear(); store.put(JSON.stringify(legacy), 'current'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    });
    await history.reload(); await ready(history);
    history.once('dialog', dialog => dialog.accept()); await history.locator('#preset').selectOption('g22'); await saved(history);
    check('Editing immediately after loading a legacy save preserves its original panels in recovery', await history.evaluate(async () => {
      for (const entry of recoveryIndex) {
        const previous = await readRecoveryProject(entry.id);
        if (previous.cells.length === 9 && previous.cells[8].labelText === 'keep-before-migration') return true;
      }
      return false;
    }));
    // Storage failures must remain visible, and manual JSON backups must still work.
    await history.evaluate(() => { storeAccess = async () => { throw new Error('synthetic storage failure'); }; });
    await history.locator('#wmm').fill('125');
    await history.waitForFunction(() => !!lastSaveError);
    check('A failed autosave remains visibly unsaved', await history.evaluate(() => saveRevision > storedRevision && document.getElementById('saveStatus').classList.contains('warn')));
    const failedCopy = await download(history, '#saveCurrentCopy', 'failed-storage-copy.json');
    check('Manual backups remain available after autosave failure', failedCopy.wmm === 125 && failedCopy.images.length === 1);
    await historyContext.close();
    const deniedContext = await browser.newContext();
    await deniedContext.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get() { throw new Error('storage denied'); } });
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage denied'); } });
    });
    const denied = await open(deniedContext); const deniedCopy = await download(denied, '#saveCurrentCopy', 'denied-storage-copy.json');
    check('The recovery panel does not prevent manual saving when storage is denied', Array.isArray(deniedCopy.cells));
    const noCryptoContext = await browser.newContext();
    await noCryptoContext.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined }));
    const noCrypto = await open(noCryptoContext); await noCrypto.locator('#wmm').fill('140'); await saved(noCrypto);
    check('Autosave still works when secure-context hashing is unavailable', await noCrypto.evaluate(async () => !recoveryAvailable && JSON.parse(await storeAccess()).wmm === 140));
    check('Unsupported recovery actions are disabled with a clear explanation', await noCrypto.locator('#keepRecovery').isDisabled() && await noCrypto.locator('#restoreRecovery').isDisabled() && (await noCrypto.locator('#recoveryStatus').textContent()).includes('HTTPS'));
    const noCryptoOther = await open(noCryptoContext); await saved(noCryptoOther);
    await noCrypto.locator('#wmm').fill('145'); await saved(noCrypto);
    await noCryptoOther.waitForFunction(() => saveConflict); await noCryptoOther.locator('#wmm').fill('150');
    check('Cross-tab protection also works without secure-context hashing', await noCrypto.evaluate(async () => JSON.parse(await storeAccess()).wmm === 145));
    const noCryptoCopy = await download(noCryptoOther, '#saveCurrentCopy', 'no-crypto-copy.json');
    check('An unsupported recovery environment can still download project backups', noCryptoCopy.wmm === 150);
    await noCryptoContext.close();
    const retainedContext = await browser.newContext(); const retained = await open(retainedContext);
    await retained.locator('#file').setInputFiles(fixture('retained-version.png')); await saved(retained);
    const retainedPoint = await retained.evaluate(() => ({ id: recoveryIndex[0].id, count: recoveryIndex.length }));
    await retainedContext.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined }));
    await retained.reload(); await ready(retained); await saved(retained);
    await retained.locator('#wmm').fill('135'); await saved(retained);
    check('Falling back to ordinary autosave preserves existing history and its image assets', await retained.evaluate(async point => recoveryIndex.length === point.count && (await readRecoveryProject(point.id)).images.length === 1, retainedPoint));
    await retainedContext.close();
    const gcContext = await browser.newContext(); const gc = await open(gcContext);
    await gc.locator('#file').setInputFiles(fixture('old-source.png')); await saved(gc);
    gc.once('dialog', dialog => dialog.accept()); await gc.locator('#newp').click(); await saved(gc);
    for (let width = 130; width < 152; width++) {
      await gc.locator('#wmm').fill(String(width)); await gc.locator('#keepRecovery').click();
      await gc.waitForFunction(width => storedRevision === saveRevision && !lastSaveError && JSON.parse(storeBasePayload).wmm === width, width);
    }
    check('Images no longer referenced by any saved version are removed from history storage', await gc.evaluate(async () => {
      const db = await openStore(); return new Promise((resolve, reject) => {
        const tx = db.transaction('projects'), request = tx.objectStore('projects').getAllKeys();
        tx.oncomplete = () => resolve(!request.result.some(key => key.startsWith('recovery-image:')));
        tx.onerror = () => reject(tx.error);
      });
    }));
    check('The recovery and conflict workflows do not produce page errors', pageErrors.length === 0);
    console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
