/* Drives the mock-mode UI end-to-end and captures window screenshots.
   Only runs when NEKU_SHOT_DIR is set (npm run shots). Used to verify the
   real renderer + IPC + mock-drive pipeline without Google credentials. */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog } from 'electron';
import { makeBouncyGif } from './test-gif.mjs';
import { discardStaged, seedStaged } from './drive-mock.js';
import { projectFolderName, resolveNaming } from './naming.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param naming the templates the app booted with. The run asserts against the
 *   names those produce rather than against "Batch 5"/"Batch 6", so the same
 *   script verifies the flow under any preset (see NEKU_PRESET).
 */
export async function runAutopilot(win, dir, mock = true, namingIn = null) {
  await fs.mkdir(dir, { recursive: true });

  const naming = resolveNaming(namingIn);
  // the mock seeds one project at the starting number, so the one the run opens
  // is always the next after it
  const seededProject = projectFolderName(naming.projectTemplate, naming.firstProjectNumber);
  const openProject = projectFolderName(naming.projectTemplate, naming.firstProjectNumber + 1);

  /* A packaged exe is a GUI app with nothing attached to stdout, so when the
     run is driven from release\ the console output goes nowhere. The transcript
     on disk is then the only way to see how far it got and what it saw. */
  const logPath = path.join(dir, 'autopilot.log');
  await fs.writeFile(logPath, '');
  const log = (...parts) => {
    const line = parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ');
    console.log(line);
    try {
      fsSync.appendFileSync(logPath, `${line}\n`);
    } catch {
      /* the console copy above is still there in a dev run */
    }
  };

  win.show();
  win.moveTop();
  win.focus();

  const shot = async (name) => {
    win.webContents.invalidate(); // force a fresh composite before capturing
    await sleep(250);
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(dir, name), image.toPNG());
    log(`[autopilot] wrote ${name}`);
  };
  const js = (code) => win.webContents.executeJavaScript(code, true);

  // real-mode cold check: no Drive calls possible, just verify which first-run
  // screen a build lands on (Connect for baked/sidecar builds, setup otherwise)
  if (!mock) {
    await sleep(1800);
    const heading = await js(`(document.querySelector('.panel h2') || {}).textContent || ''`);
    log(`[autopilot] cold boot screen: "${heading}"`);
    await shot('cold-boot.png');
    const expected = process.env.NEKU_COLD_EXPECT;
    if (expected && heading !== expected) {
      throw new Error(`expected cold boot screen "${expected}", got "${heading}"`);
    }
    log('[autopilot] cold check complete');
    app.quit();
    return;
  }

  // day one on the friend's machine: no batches exist yet, so the menu must offer
  // to start at Batch 5 rather than Batch 1 (he already did four by hand)
  if (process.env.NEKU_MOCK_EMPTY === '1') {
    await sleep(2200);
    const rows = await js(`document.querySelectorAll('.batch-menu .batch-row').length`);
    const cta = await js(
      `(document.querySelector('.batch-menu .btn.primary') || {}).textContent || ''`
    );
    const empty = await js(
      `(document.querySelector('.batch-menu .aside') || {}).textContent || ''`
    );
    log(`[autopilot] first run: ${rows} batches, cta "${cta}", note "${empty}"`);
    if (rows !== 0 || cta !== `Start ${seededProject}`) {
      throw new Error(
        `first run should offer Start ${seededProject}, offered "${cta}" with ${rows} rows`
      );
    }
    await shot('first-run.png');
    log('[autopilot] first-run check complete');
    app.quit();
    return;
  }

  // a session starts at the batch menu; the mock drive seeds one finished batch
  await sleep(2200);
  const batchRows = await js(`document.querySelectorAll('.batch-menu .batch-row').length`);
  const firstRow = await js(
    `(document.querySelector('.batch-menu .batch-row .fname') || {}).textContent || ''`
  );
  log(`[autopilot] batch menu: ${batchRows} existing batch(es), first: "${firstRow}"`);
  if (batchRows < 1 || firstRow !== seededProject) {
    throw new Error(`batch menu did not list the existing batch "${seededProject}"`);
  }
  await shot('0-batches.png');

  // start the next batch and land in the workbench inside it
  await js(`window.__nekuBatchTest.startNew()`);
  await sleep(1600);
  const chip = await js(
    `(document.querySelector('.bar .batch-chip') || {}).textContent || ''`
  );
  log(`[autopilot] header batch chip: "${chip}"`);
  if (!chip.startsWith(openProject)) {
    throw new Error(`expected to be working in ${openProject}, header says "${chip}"`);
  }

  // let the first staging poll land
  await sleep(1200);
  await shot('1-lighttable.png');

  // getting the sprite onto this machine is the reason the tablet exists, so the
  // save button must be live as soon as a sprite is selected. The dialog itself
  // is modal, so this asserts the offer, not the click.
  const saveBtn = await js(
    `(() => { const b = document.querySelector('.zone-left .foot-row .btn:not(.ghost)');
       return b ? JSON.stringify({ text: b.textContent, off: b.disabled }) : 'null'; })()`
  );
  log(`[autopilot] save-sprite button: ${saveBtn}`);
  if (saveBtn === 'null' || JSON.parse(saveBtn).off) {
    throw new Error('save-sprite button missing or disabled with a sprite selected');
  }

  // and that it really puts bytes on disk. The file picker is native and modal,
  // so stub it for the length of this one click.
  const savePath = path.join(dir, 'saved-sprite.png');
  const realShowSave = dialog.showSaveDialog;
  let offeredName = '';
  dialog.showSaveDialog = async (_win, opts) => {
    offeredName = path.basename(opts.defaultPath);
    return { canceled: false, filePath: savePath };
  };
  try {
    await js(`document.querySelector('.zone-left .foot-row .btn:not(.ghost)').click()`);
    let strip = '';
    const saveDeadline = Date.now() + 8000;
    while (Date.now() < saveDeadline) {
      strip = await js(`(document.querySelector('.savedstrip .fname') || {}).textContent || ''`);
      if (strip) break;
      await sleep(200);
    }
    const bytes = (await fs.stat(savePath).catch(() => ({ size: 0 }))).size;
    /* What matters is that the sprite reached disk whole, so compare against the
       source rather than against a size. A packaged mock run serves the 1x1
       fallback (resources/mock-sprite.png is not inside the asar), and a fixed
       byte floor would fail there on the fixture instead of on the feature. */
    const sourceBytes = await js(
      `window.neku.getFileBytes('mock-sprite-1').then((r) => (r.ok ? r.data.length : -1))`
    );
    log(
      `[autopilot] saved sprite: offered "${offeredName}", ${bytes} of ${sourceBytes} bytes,` +
        ` strip "${strip}"`
    );
    if (offeredName !== 'aiko_final_v2.png') {
      throw new Error(`save dialog offered "${offeredName}", expected the staged sprite's name`);
    }
    if (bytes === 0) throw new Error('save wrote no sprite bytes to disk');
    if (bytes !== sourceBytes) {
      throw new Error(`save wrote ${bytes} bytes, but the sprite is ${sourceBytes}`);
    }
    if (!strip.includes('saved-sprite.png')) {
      throw new Error(`UI did not confirm where the sprite landed: "${strip}"`);
    }
  } finally {
    dialog.showSaveDialog = realShowSave;
    await fs.rm(savePath, { force: true });
  }

  /* ---- a sprite arriving from the tablet ----
     The card only earns its keep when he is NOT looking at Neku, and it is
     deliberately suppressed when he is, so the window has to be blurred here or
     the test would be checking the wrong branch. */
  /* blur() alone is a request, not a guarantee: on Windows, with no other window
     for the OS to hand focus to, Neku can simply stay focused and the card is
     then correctly suppressed, failing the test for the wrong reason. Hiding is
     the one state the window cannot be focused in, and "Show me" brings it back
     the same way it would from the tray. */
  win.blur();
  await sleep(400);
  if (win.isFocused()) {
    win.hide();
    for (let i = 0; i < 20 && win.isFocused(); i += 1) await sleep(100);
  }
  log(`[autopilot] window focused while testing sprite arrival: ${win.isFocused()}`);
  if (win.isFocused()) {
    throw new Error('could not blur the window, so the sprite-notice test would check the suppressed branch');
  }

  seedStaged({ id: 'mock-sprite-arrival', name: 'kaito_final.png' });
  await js(`window.__nekuTest.refresh()`);

  let arrivalCard = null;
  const arrivalDeadline = Date.now() + 12000;
  while (Date.now() < arrivalDeadline) {
    arrivalCard = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed()) || null;
    if (arrivalCard) break;
    await sleep(200);
  }
  if (!arrivalCard) throw new Error('no corner notice when a sprite arrived from the tablet');
  await sleep(900); // let it lay out and pull the sprite bytes across

  const arrivalJs = (code) => arrivalCard.webContents.executeJavaScript(code, true);
  const arrivalTag = await arrivalJs(`(document.querySelector('.notice-tag')||{}).textContent||''`);
  const arrivalName = await arrivalJs(`(document.getElementById('name')||{}).textContent||''`);
  const arrivalCta = await arrivalJs(`(document.getElementById('btn-use')||{}).textContent||''`);
  const arrivalPreview = await arrivalJs(`Boolean(document.querySelector('#thumb img'))`);
  log(
    `[autopilot] sprite notice: "${arrivalTag}" / "${arrivalName}" / cta "${arrivalCta}",` +
      ` preview ${arrivalPreview}`
  );
  if (!arrivalTag.includes('tablet')) {
    throw new Error(`sprite notice should say where it came from, said "${arrivalTag}"`);
  }
  if (arrivalName !== 'kaito_final.png') {
    throw new Error(`sprite notice named "${arrivalName}", expected kaito_final.png`);
  }
  if (!arrivalPreview) throw new Error('sprite notice rendered no preview of the drawing');
  const arrivalShot = await arrivalCard.webContents.capturePage();
  await fs.writeFile(path.join(dir, '1b-sprite-notice.png'), arrivalShot.toPNG());
  log('[autopilot] wrote 1b-sprite-notice.png');

  // the primary button's whole job is to put Neku back in front of him
  await arrivalJs(`document.getElementById('btn-use').click()`);
  await sleep(800);
  log(`[autopilot] Neku focused after "Show me": ${win.isFocused()}`);
  if (!win.isFocused()) throw new Error('"Show me" did not bring Neku forward');

  // put staging back to one sprite so the rest of the run is unchanged
  await discardStaged(null, 'mock-sprite-arrival');
  await js(`window.__nekuTest.refresh()`);
  await sleep(600);

  /* ---- taking a wrong sprite back off the table ----
     Two steps on purpose, so run both: the X must ask before anything leaves,
     and "Keep it" must genuinely leave the sprite alone. */
  await js(`document.querySelector('.table .discard-x').click()`);
  await sleep(300);
  const askedBefore = await js(
    `(document.querySelector('.discard-confirm .discard-ask') || {}).textContent || ''`
  );
  const warnsTrash = await js(
    `(document.querySelector('.discard-confirm .hint-sub') || {}).textContent || ''`
  );
  log(`[autopilot] discard confirm: "${askedBefore}" / "${warnsTrash}"`);
  if (!askedBefore) throw new Error('the X removed a sprite without asking first');
  if (!warnsTrash.includes('trash')) {
    throw new Error(`confirm must say where the sprite goes, said "${warnsTrash}"`);
  }
  await shot('1a-discard-confirm.png');

  await js(`document.querySelectorAll('.discard-confirm .btn')[1].click()`); // Keep it
  await sleep(400);
  const keptName = await js(
    `(document.querySelector('.table .filecard .fname') || {}).textContent || ''`
  );
  log(`[autopilot] after "Keep it": "${keptName}"`);
  if (keptName !== 'aiko_final_v2.png') {
    throw new Error(`"Keep it" lost the sprite, table shows "${keptName}"`);
  }

  await js(`window.__nekuTest.setName('Aiko')`);
  await sleep(1200); // folder-exists debounce

  /* ---- the gif arriving in Downloads ----
     He animates in the browser with Neku behind it, so the whole point is that
     the offer reaches him over there. NEKU_WATCH_DIR keeps this test out of the
     real Downloads folder; with no safe folder to drop into, attach one directly
     instead and leave the watcher untested rather than litter his downloads. */
  const watchDir = process.env.NEKU_WATCH_DIR;
  if (watchDir) {
    const gifName = 'ezgif-4-b2a91c.gif';
    await fs.mkdir(path.resolve(watchDir), { recursive: true });
    await fs.writeFile(path.join(path.resolve(watchDir), gifName), makeBouncyGif());

    // Neku's own notice window, not a Windows toast, so it is a window we can find
    let notice = null;
    const noticeDeadline = Date.now() + 12000;
    while (Date.now() < noticeDeadline) {
      notice = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed()) || null;
      if (notice) break;
      await sleep(200);
    }
    if (!notice) throw new Error('no corner notice appeared when a gif landed in Downloads');
    await sleep(900); // let it lay out and pull its preview across

    const noticeJs = (code) => notice.webContents.executeJavaScript(code, true);
    const noticed = await noticeJs(`(document.getElementById('name') || {}).textContent || ''`);
    // the preview is the point: he has to see it is the right export
    const previewed = await noticeJs(`Boolean(document.querySelector('#thumb img'))`);
    log(`[autopilot] corner notice: "${noticed}", preview rendered: ${previewed}`);
    if (noticed !== gifName) {
      throw new Error(`notice named "${noticed}", expected "${gifName}"`);
    }
    if (!previewed) throw new Error('corner notice rendered no preview of the gif');

    const noticeShot = await notice.webContents.capturePage();
    await fs.writeFile(path.join(dir, '2a-notice.png'), noticeShot.toPNG());
    log('[autopilot] wrote 2a-notice.png');

    // the packing slip must also carry the offer, for when the notice times out
    const strip = await js(`window.__nekuTest.foundGif()`);
    log(`[autopilot] packing-slip fallback offer: "${strip}"`);
    if (strip !== gifName) {
      throw new Error(`packing slip did not offer the found gif, saw "${strip}"`);
    }

    await noticeJs(`document.getElementById('btn-use').click()`);
    let attached = '';
    const attachDeadline = Date.now() + 8000;
    while (Date.now() < attachDeadline) {
      attached = await js(`window.__nekuTest.gifName()`);
      if (attached) break;
      await sleep(200);
    }
    log(`[autopilot] attached from the notice: "${attached}"`);
    if (attached !== gifName) {
      throw new Error(`"Use it" did not attach the gif, packing slip holds "${attached}"`);
    }
    // taken: the offer must not linger into the next commission
    const cleared = await js(`window.__nekuTest.foundGif()`);
    if (cleared) throw new Error(`found-gif offer still showing "${cleared}" after use`);
  } else {
    await js(`window.__nekuTest.setGif()`);
  }
  await sleep(500);

  // the destination the artist reads before committing must name the batch
  const preview = await js(
    `(document.querySelector('.zone-right .note.mono') || {}).textContent || ''`
  );
  log(`[autopilot] destination preview: "${preview}"`);
  if (!preview.endsWith(`/${openProject}/Aiko`)) {
    throw new Error(`destination preview does not point into the batch: "${preview}"`);
  }
  await shot('2-packed.png');

  log('[autopilot] pre-deliver probe:', await js(`window.__nekuTest.probe()`));
  await js(`window.__nekuTest.deliver()`);
  log('[autopilot] post-deliver probe:', await js(`window.__nekuTest.probe()`));
  const deadline = Date.now() + 20000;
  let finished = false;
  while (Date.now() < deadline) {
    const phase = await js(`window.__nekuTest.phase()`);
    if (phase === 'done') {
      finished = true;
      break;
    }
    if (phase === 'error') {
      await shot('x-error.png');
      throw new Error('deliver ended in error state');
    }
    await sleep(300);
  }
  if (!finished) {
    log('[autopilot] timeout probe:', await js(`window.__nekuTest.probe()`));
    await shot('x-timeout.png');
    throw new Error('deliver never reached done state');
  }
  await sleep(400);

  // assert against the DOM, not the pixels
  const sealed = await js(`Boolean(document.querySelector('.sealed'))`);
  const link = await js(
    `(document.querySelector('.linktext') || {}).textContent || ''`
  );
  log(`[autopilot] sealed card: ${sealed}, link: ${link}`);
  if (!sealed || !link.startsWith('https://drive.google.com/')) {
    throw new Error('done state did not render the sealed card with a Drive link');
  }
  let stagingCleared = false;
  const clearDeadline = Date.now() + 4000;
  while (Date.now() < clearDeadline) {
    stagingCleared = await js(`!document.querySelector('.zone-left .filecard')`);
    if (stagingCleared) break;
    await sleep(250);
  }
  log(`[autopilot] staging cleared: ${stagingCleared}`);
  if (!stagingCleared) {
    throw new Error('delivered sprite still shown in staging after deliver');
  }

  const history = JSON.parse(
    await js(`window.neku.getHistory().then((r) => JSON.stringify(r))`)
  );
  const latest = history.ok && history.data[0];
  log(
    `[autopilot] history: ${history.ok ? history.data.length : 'ERR'} entries, latest: ${latest && latest.clientName}`
  );
  if (!latest || latest.clientName !== 'Aiko' || !latest.link) {
    throw new Error('finished delivery was not recorded in history');
  }
  if (latest.batchName !== openProject) {
    throw new Error(`delivery was recorded under "${latest.batchName}", expected ${openProject}`);
  }

  await shot('3-sealed.png');

  // the history sheet must list the delivery that just finished
  await js(`document.querySelector('.bar .btn.ghost').click()`);
  await sleep(500);
  const historyName = await js(
    `(document.querySelector('.history-card .fname') || {}).textContent || ''`
  );
  log(`[autopilot] history sheet lists: "${historyName}"`);
  if (historyName !== 'Aiko') {
    throw new Error('history sheet did not list the delivered client');
  }
  // the card must carry a sprite thumbnail, that is the whole point of the card
  const thumbSrc = await js(
    `((document.querySelector('.history-card .history-thumb img') || {}).src || '').slice(0, 22)`
  );
  log(`[autopilot] history thumbnail: "${thumbSrc}"`);
  if (thumbSrc !== 'data:image/png;base64,') {
    throw new Error('history card has no sprite thumbnail');
  }
  await shot('4-history.png');

  // ---- the typo guard has to see across batches, not just the open one ----
  await js(`document.querySelector('.sheet .btn-row .btn').click()`); // close history
  await sleep(400);
  await js(`document.querySelector('.sealed .btn.ghost').click()`); // next commission
  await sleep(500);
  // this client lives in Batch 5 while we are working in Batch 6
  await js(`window.__nekuTest.setName('OldClientFromMarch')`);
  await sleep(1500); // debounce + mock latency
  const warn = await js(
    `(document.querySelector('.zone-right .warnstrip') || {}).textContent || ''`
  );
  log(`[autopilot] cross-batch typo warning: "${warn}"`);
  if (!warn.includes(seededProject)) {
    throw new Error('typo guard did not report the batch the existing client is in');
  }

  // ---- switching back to an earlier batch ----
  await js(`window.__nekuTest.setName('')`);
  await js(`document.querySelector('.bar .batch-chip').click()`);
  await sleep(1400);
  const rows = await js(`document.querySelectorAll('.batch-menu .batch-row').length`);
  log(`[autopilot] batch menu after one delivery: ${rows} batches`);
  if (rows !== 2) {
    throw new Error(`expected ${seededProject} and ${openProject} in the menu, saw ${rows}`);
  }
  await shot('5-batch-switch.png');
  await js(`document.querySelectorAll('.batch-menu .batch-row')[1].click()`); // Batch 5
  await sleep(1400);
  const backChip = await js(
    `(document.querySelector('.bar .batch-chip') || {}).textContent || ''`
  );
  log(`[autopilot] reopened batch: "${backChip}"`);
  if (!backChip.startsWith(seededProject)) {
    throw new Error(`selecting an existing batch failed, header says "${backChip}"`);
  }

  /* ---- Remove really removes ----
     Its own sprite, because this path destroys what it acts on. Staging is empty
     by now, so the one seeded here is the only thing on the table. */
  seedStaged({ id: 'mock-sprite-wrong', name: 'wrong_upload.png' });
  await js(`window.__nekuTest.refresh()`);
  let onTable = '';
  const seedDeadline = Date.now() + 8000;
  while (Date.now() < seedDeadline) {
    onTable = await js(`(document.querySelector('.table .filecard .fname') || {}).textContent || ''`);
    if (onTable) break;
    await sleep(250);
  }
  if (onTable !== 'wrong_upload.png') {
    throw new Error(`seeded sprite never reached the light table, saw "${onTable}"`);
  }

  await js(`document.querySelector('.table .discard-x').click()`);
  await sleep(300);
  await js(`document.querySelectorAll('.discard-confirm .btn')[0].click()`); // Remove
  let cleared = false;
  const removeDeadline = Date.now() + 10000;
  while (Date.now() < removeDeadline) {
    cleared = await js(`!document.querySelector('.table .filecard')`);
    if (cleared) break;
    await sleep(250);
  }
  const stillStaged = await js(
    `window.neku.listStaging().then((r) => (r.ok ? r.data.files.length : -1))`
  );
  log(`[autopilot] after Remove: table cleared ${cleared}, ${stillStaged} left in staging`);
  if (!cleared) throw new Error('Remove left the sprite on the light table');
  if (stillStaged !== 0) {
    throw new Error(`Remove left ${stillStaged} sprite(s) in staging`);
  }
  await shot('6-after-remove.png');

  /* ---- the naming settings ----
     This screen is where the app stops being about one trade, so the run has to
     prove it opens, shows the templates actually in force, and previews what
     they produce before anyone commits a real delivery to them. */
  await js(`document.querySelector('.bar .iconbtn[aria-label="Settings"]').click()`);
  await sleep(700);
  const presetCount = await js(`document.querySelectorAll('.sheet .preset-row .btn').length`);
  const projectTemplate = await js(`(document.getElementById('s-project')||{}).value||''`);
  const stagedTemplate = await js(`(document.getElementById('s-staged')||{}).value||''`);
  const attachedTemplate = await js(`(document.getElementById('s-attached')||{}).value||''`);
  const example = await js(
    `Array.from(document.querySelectorAll('.sheet .note.mono')).map(n=>n.textContent).join(' | ')`
  );
  log(
    `[autopilot] settings: ${presetCount} presets, project "${projectTemplate}",` +
      ` staged "${stagedTemplate}", attached "${attachedTemplate}"`
  );
  log(`[autopilot] settings example: "${example}"`);
  if (presetCount < 2) throw new Error('settings offered no presets to switch between');
  if (projectTemplate !== naming.projectTemplate || stagedTemplate !== naming.stagedTemplate) {
    throw new Error('settings did not show the templates actually in force');
  }
  if (!example.includes(seededProject)) {
    throw new Error(`settings preview did not show a real example, showed "${example}"`);
  }
  await shot('7-settings.png');

  log('[autopilot] complete');
  app.quit();
}
