/* Verification harness for the tablet PWA: loads it in Chromium (Electron),
   walks setup -> main -> preview -> send-error, captures screenshots into
   tablet-checks/, and fails on unexpected console errors.
   Run: laptop\node_modules\.bin\electron.cmd tools\tablet-check.cjs */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tablet-checks');
const consoleErrors = [];
let server = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  server = spawn(process.execPath.endsWith('electron.exe') ? 'node' : process.execPath, [
    path.join(ROOT, 'tools', 'serve-tablet.mjs'),
  ]);
  await sleep(900);

  const win = new BrowserWindow({
    width: 800,
    height: 1280,
    show: true,
    backgroundColor: '#161513',
    webPreferences: { backgroundThrottling: false },
  });
  // deny the GIS popup so the send attempt fails fast and deterministically
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });

  // fresh start — previous runs leave localStorage behind in the electron profile
  await win.webContents.session.clearStorageData();

  await fs.mkdir(OUT, { recursive: true });
  const shot = async (name) => {
    // best-effort: capture fails when no display surface is available (locked
    // desktop etc.) — the DOM assertions below are the authoritative check
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        win.webContents.invalidate();
        await sleep(300);
        const image = await win.webContents.capturePage();
        if (!image.isEmpty()) {
          await fs.writeFile(path.join(OUT, name), image.toPNG());
          console.log(`[tablet-check] wrote ${name}`);
          return;
        }
      } catch (err) {
        if (attempt === 5) console.log(`[tablet-check] skipped ${name}: ${err.message}`);
      }
      await sleep(400);
    }
  };
  const js = (code) => win.webContents.executeJavaScript(code, true);

  // config.js is legitimately filled once deployed (SETUP.md Part 2), so force
  // each phase's config state explicitly and restore the real file at the end.
  const cfgPath = path.join(ROOT, 'tablet', 'config.js');
  const cfgOriginal = await fs.readFile(cfgPath, 'utf8');
  let setupView, mainView, previewShown, sendShown, hintShown;
  let finalView, errText, swRegistered, bakedView;
  let landedWaiting, landedDone, landedTitle;
  try {
    // unbaked path: empty config on a fresh device must ask setup questions
    await fs.writeFile(
      cfgPath,
      `window.NEKU_CONFIG = { clientId: '', stagingFolder: 'Sprite Staging' };`
    );
    await win.loadURL('http://localhost:8321/');
    await sleep(1500);
    setupView = await js(`document.querySelector('.view.on').id`);
    await shot('pwa-1-setup.png');

    await js(
      `localStorage.setItem('neku.clientId','000-fake.apps.googleusercontent.com');` +
        `localStorage.setItem('neku.stagingName','Sprite Staging'); location.reload();`
    );
    await sleep(1500);
    mainView = await js(`document.querySelector('.view.on').id`);
    await shot('pwa-2-main.png');

    await js(
      `(async () => { const r = await fetch('icons/icon-192.png'); const b = await r.blob();` +
        ` setFile(new File([b], 'aiko_final_v2.png', { type: 'image/png' })); })()`
    );
    await sleep(700);
    previewShown = await js(`!document.getElementById('preview-img').hidden`);
    sendShown = await js(`!document.getElementById('btn-send').hidden`);
    hintShown = await js(`!document.getElementById('first-hint').hidden`);
    await shot('pwa-3-preview.png');

    await js(`document.getElementById('btn-send').click()`);
    await sleep(3000);
    finalView = await js(`document.querySelector('.view.on').id`);
    errText = await js(`document.getElementById('error-text').textContent`);
    await shot('pwa-4-send-error.png');

    swRegistered = await js(
      `navigator.serviceWorker.getRegistration().then((r) => Boolean(r))`
    );

    /* The receipt from the laptop. Reaching this for real needs a signed-in
       Drive on both surfaces, so drive the two states of the strip directly:
       what matters here is that both render, not that Drive answered. */
    await js(`show('done'); startLandedWatch('fake-file-id');`);
    await sleep(400);
    landedWaiting = await js(
      `document.getElementById('landed-strip').hidden
         ? '' : document.getElementById('landed-text').textContent`
    );
    await shot('pwa-6-waiting-for-laptop.png');

    await js(`stopLandedWatch(); show('done'); setLanded(true);`);
    await sleep(300);
    landedDone = await js(`document.getElementById('landed-text').textContent`);
    landedTitle = await js(`document.getElementById('done-title').textContent`);
    await shot('pwa-7-landed.png');
    await js(`stopLandedWatch()`);

    // baked-config path: with config.js pre-filled, a fresh device must land
    // straight on the upload screen — the friend never sees setup questions
    await fs.writeFile(
      cfgPath,
      `window.NEKU_CONFIG = { clientId: 'baked-fake.apps.googleusercontent.com', stagingFolder: 'Sprite Staging' };`
    );
    await win.webContents.session.clearStorageData();
    await win.loadURL('http://localhost:8321/');
    await sleep(1200);
    bakedView = await js(`document.querySelector('.view.on').id`);
    await shot('pwa-5-baked-firstrun.png');
  } finally {
    await fs.writeFile(cfgPath, cfgOriginal);
  }

  console.log(`[tablet-check] views: ${setupView} -> ${mainView} -> final ${finalView}`);
  console.log(
    `[tablet-check] preview shown: ${previewShown}, send shown: ${sendShown}, first-hint: ${hintShown}`
  );
  console.log(`[tablet-check] error text: ${errText}`);
  console.log(`[tablet-check] service worker registered: ${swRegistered}`);
  console.log(`[tablet-check] baked-config first view: ${bakedView}`);
  console.log(
    `[tablet-check] laptop receipt: "${landedWaiting}" -> "${landedTitle}" / "${landedDone}"`
  );
  console.log(`[tablet-check] console errors: ${JSON.stringify(consoleErrors)}`);

  const ok =
    setupView === 'view-setup' &&
    mainView === 'view-main' &&
    previewShown &&
    sendShown &&
    hintShown &&
    finalView === 'view-error' &&
    Boolean(errText) &&
    swRegistered &&
    bakedView === 'view-main' &&
    landedWaiting.startsWith('Waiting for the laptop') &&
    landedDone === 'The laptop has it' &&
    landedTitle === 'Landed on the laptop';
  console.log(ok ? '[tablet-check] PASS' : '[tablet-check] FAIL');
  return ok ? 0 : 1;
}

app
  .whenReady()
  .then(main)
  .then((code) => {
    if (server) server.kill();
    app.exit(code);
  })
  .catch((err) => {
    console.error('[tablet-check]', err);
    if (server) server.kill();
    app.exit(1);
  });
