/* Neku main process: window, settings store, IPC surface, mock/real Drive switch.

   OAuth credentials resolve in priority order:
     1. Settings the user typed in-app (electron-store)
     2. neku.config.json sitting next to the portable exe (no-rebuild handoff)
     3. Values baked in at build time from oauth.config.json (single-file handoff)
   The friend receiving a baked/sidecar build never sees a setup screen. */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import Store from 'electron-store';
import * as auth from './auth.js';
import * as realDrive from './drive.js';
import * as mockDrive from './drive-mock.js';
import { runAutopilot } from './autopilot.js';
import { startGifWatch, stopGifWatch, wasAnnounced, watchIsActive } from './gif-watch.js';
import { hideNotice, showNotice } from './notice.js';

const MOCK = process.env.NEKU_MOCK === '1';
const driveOps = MOCK ? mockDrive : realDrive;

const BAKED = typeof __NEKU_BAKED__ !== 'undefined' ? __NEKU_BAKED__ : {};

function readSidecarConfig() {
  try {
    // portable builds run from a temp unpack dir; this env var points at the real exe
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
    const raw = fs.readFileSync(path.join(exeDir, 'neku.config.json'), 'utf8');
    // tolerate a UTF-8 BOM from Notepad / Windows PowerShell
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return {};
  }
}
const SIDECAR = readSidecarConfig();

const FALLBACKS = { stagingName: 'Sprite Staging', rootName: 'Commissions' };

const store = new Store({ name: MOCK ? 'neku-mock' : 'neku' });

// autopilot runs must be reproducible: always start at the batch menu, never in
// whatever batch the last run happened to leave open
if (process.env.NEKU_SHOT_DIR) store.delete('currentBatch');

function effectiveSettings() {
  const pick = (key) => store.get(key) || SIDECAR[key] || BAKED[key] || FALLBACKS[key] || '';
  return {
    clientId: pick('clientId'),
    clientSecret: pick('clientSecret'),
    stagingName: pick('stagingName'),
    rootName: pick('rootName'),
  };
}

let win = null;

// thumbnails cost ~1-15 KB each in neku.json; the newest 20 is plenty to
// recognise recent work without the settings file growing
const HISTORY_THUMBS = 20;

const PRELOAD = () => path.join(__dirname, '../preload/index.js');

/* The gif Downloads-watching last spotted, held until he uses it or a newer one
   arrives. Kept in main because the notice is a main-process window. */
let latestGif = null;

/* Whether the packing slip already holds a gif. That is the only thing worth
   suppressing a notice for. An earlier version also required the workbench to be
   open, which made the notice silently do nothing whenever he happened to be on
   the batch menu — a shortcut that quietly fails to appear is worse than one
   that occasionally appears when it wasn't needed, so the gate stays this loose. */
let gifAttached = false;

// which folder the watcher settled on, so the settings sheet can show it
let watchedFolder = '';

/* What the corner card is currently about: {kind:'gif',path} or
   {kind:'sprite',id}. The card asks main for its own preview bytes, and what to
   do when he clicks the primary button depends on which arrived. */
let pendingNotice = null;

// a gif big enough to choke the preview is still perfectly deliverable
const PREVIEW_MAX_BYTES = 12 * 1024 * 1024;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    backgroundColor: '#0a0a0a',
    title: 'Neku',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD(),
      // keep polling + UI live while he's off animating in the browser
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // the notice is a second window, so it would otherwise hold the app open for
  // its full display time after he closes the workbench
  win.on('closed', () => {
    win = null;
    hideNotice();
  });

  // external links go to the system browser, never to a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  if (process.env.NEKU_SHOT_DIR) {
    win.webContents.once('did-finish-load', () => {
      const shotDir = path.resolve(process.env.NEKU_SHOT_DIR);
      runAutopilot(win, shotDir, MOCK).catch((err) => {
        console.error('[autopilot]', err);
        // a packaged run has no console attached, so the reason has to land on
        // disk or a failure there is just an exit code with nothing behind it
        try {
          fs.appendFileSync(
            path.join(shotDir, 'autopilot.log'),
            `[autopilot] FAILED: ${err && err.stack ? err.stack : err}\n`
          );
        } catch {
          /* nothing further to try */
        }
        app.exit(1);
      });
    });
  }
}

/* ---------- helpers ---------- */

/** The batch he picked from the menu, remembered across restarts so reopening
    Neku mid-batch drops him straight back into it. */
function currentBatch() {
  const batch = store.get('currentBatch');
  return batch && batch.name ? batch : null;
}

function currentState() {
  return {
    mock: MOCK,
    configured: MOCK || auth.hasCreds(effectiveSettings()),
    loggedIn: MOCK || auth.isLoggedIn(store),
    settings: effectiveSettings(),
    batch: currentBatch(),
  };
}

function getDriveOrThrow() {
  if (MOCK) return mockDrive.getDrive();
  const client = auth.getAuthedClient(store, effectiveSettings());
  if (!client) {
    const err = new Error('Not connected to Google Drive.');
    err.code = 401;
    throw err;
  }
  return realDrive.getDrive(client);
}

function friendlyMessage(err) {
  const raw =
    (err.errors && err.errors[0] && err.errors[0].message) || err.message || String(err);
  if (/getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network/i.test(raw)) {
    return 'No connection to Google Drive. Check the internet and retry.';
  }
  return raw;
}

/* ---------- watching Downloads for the finished gif ---------- */

/** He animates on ezgif with Neku behind the browser, so the moment the gif
    lands is the moment he is looking somewhere else. Neku's own corner notice
    (not a Windows one) carries the offer over to wherever he is. */
function onGifFound(gif) {
  if (gifAttached) return;
  latestGif = gif;
  if (win && !win.isDestroyed()) win.webContents.send('gif:found', gif);
  pendingNotice = { kind: 'gif', path: gif.path };
  showNotice({ kind: 'gif', name: gif.name, size: gif.size }, PRELOAD());
}

function beginGifWatch() {
  if (process.env.NEKU_WATCH_DIR) {
    // the autopilot drops a real gif in to prove the whole chain; pointing it at
    // a temp folder keeps the test out of the actual Downloads folder
    watchedFolder = path.resolve(process.env.NEKU_WATCH_DIR);
    fs.mkdirSync(watchedFolder, { recursive: true });
  } else {
    watchedFolder = app.getPath('downloads');
  }
  startGifWatch(watchedFolder, onGifFound);
}

/** Only a gif this app announced is worth reading off disk for the renderer. */
async function readAnnouncedGif(filePath) {
  if (!wasAnnounced(filePath)) throw new Error('That gif is no longer available.');
  const bytes = await fs.promises.readFile(filePath);
  return { name: path.basename(filePath), size: bytes.length, bytes };
}

/** Every handler returns { ok, data | code+message } so errors cross IPC cleanly. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      const authExpired = auth.isAuthError(err);
      return {
        ok: false,
        code: authExpired ? 'auth' : 'error',
        message: authExpired
          ? 'Google Drive connection expired. Reconnect to continue.'
          : friendlyMessage(err),
      };
    }
  });
}

/* ---------- IPC surface ---------- */

handle('state:get', () => currentState());

handle('settings:save', (_e, partial) => {
  const allowed = ['clientId', 'clientSecret', 'stagingName', 'rootName'];
  const before = effectiveSettings().clientId;
  for (const key of allowed) {
    if (key in partial) {
      const value = String(partial[key] ?? '').trim();
      // an empty value clears the override so sidecar/baked config shows through
      if (value) store.set(key, value);
      else store.delete(key);
    }
  }
  // a different OAuth client invalidates the old grant
  if (effectiveSettings().clientId !== before) {
    store.delete('tokens');
  }
  return currentState();
});

handle('auth:login', async () => {
  if (!MOCK) await auth.login(store, effectiveSettings());
  return currentState();
});

handle('auth:logout', async () => {
  if (!MOCK) await auth.logout(store, effectiveSettings());
  return currentState();
});

handle('batch:list', async () => {
  const drive = getDriveOrThrow();
  return driveOps.listBatches(drive, effectiveSettings().rootName);
});

handle('batch:create', async () => {
  const drive = getDriveOrThrow();
  return driveOps.createBatch(drive, effectiveSettings().rootName);
});

/** Pick a batch to work in, or pass null to go back to the batch menu. */
handle('batch:select', (_e, batch) => {
  if (batch && batch.name) {
    store.set('currentBatch', {
      id: batch.id || null,
      name: String(batch.name),
      number: batch.number ?? null,
    });
  } else {
    store.delete('currentBatch');
  }
  return currentState();
});

handle('staging:list', async () => {
  const drive = getDriveOrThrow();
  const listing = await driveOps.listStaging(drive, effectiveSettings().stagingName);
  // seeing it here is what "the laptop has it" means, so stamp it now and let
  // the tablet stop wondering. Swallows its own errors.
  await driveOps.markStagedSeen(drive, listing.files);
  return listing;
});

/** The X on the light table: a wrong sprite came off the tablet. Goes to Drive's
    trash, so this is recoverable — see discardStaged. */
handle('staging:discard', async (_e, fileId) => {
  const drive = getDriveOrThrow();
  return driveOps.discardStaged(drive, String(fileId));
});

handle('file:bytes', async (_e, fileId) => {
  const drive = getDriveOrThrow();
  return driveOps.getFileBytes(drive, fileId);
});

/** Drop the parts of a name Windows will not accept in a file name, and make
    sure what comes back still ends in .png. */
function safeSpriteFileName(name) {
  const base = String(name || 'sprite.png')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'sprite.png';
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`;
}

/** Put the selected sprite on this machine's disk, so he can animate it.
    sprite = { kind:'drive', id, name } | { kind:'local', bytes, name } */
handle('sprite:save', async (_e, sprite) => {
  const bytes =
    sprite.kind === 'drive'
      ? await driveOps.getFileBytes(getDriveOrThrow(), sprite.id)
      : Buffer.from(sprite.bytes);
  // reopen wherever he saved last: the animation tool's folder, most likely
  const dir = store.get('lastSaveDir') || app.getPath('downloads');
  const res = await dialog.showSaveDialog(win, {
    title: 'Save sprite',
    defaultPath: path.join(dir, safeSpriteFileName(sprite.name)),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fs.promises.writeFile(res.filePath, bytes);
  store.set('lastSaveDir', path.dirname(res.filePath));
  return { canceled: false, path: res.filePath };
});

handle('shell:reveal', (_e, filePath) => {
  if (typeof filePath === 'string' && filePath) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

handle('client:check', async (_e, clientName) => {
  const drive = getDriveOrThrow();
  return driveOps.checkClientFolder(drive, effectiveSettings().rootName, clientName);
});

handle('deliver', async (event, payload) => {
  const drive = getDriveOrThrow();
  // the store is the authority on which batch is open, not the renderer payload
  const batch = currentBatch();
  if (!batch) throw new Error('No batch is open. Pick a batch first.');
  const sprite =
    payload.sprite.kind === 'drive'
      ? payload.sprite
      : { kind: 'local', name: payload.sprite.name, bytes: Buffer.from(payload.sprite.bytes) };
  const settings = effectiveSettings();
  const result = await driveOps.deliver(
    drive,
    {
      rootName: settings.rootName,
      stagingName: settings.stagingName,
      batchName: batch.name,
      stagingId: payload.stagingId,
      sprite,
      clientName: payload.clientName,
      gifBytes: Buffer.from(payload.gifBytes),
    },
    (step) => event.sender.send('deliver:step', step)
  );
  // every finished delivery is remembered so old client links stay reachable
  const history = store.get('history') || [];
  const thumb =
    typeof payload.thumb === 'string' && payload.thumb.startsWith('data:image/png;base64,')
      ? payload.thumb
      : null;
  history.unshift({
    clientName: result.folderName,
    batchName: result.batchName,
    link: result.link,
    files: `${result.spriteName} + ${result.gifName}`,
    thumb,
    deliveredAt: new Date().toISOString(),
  });
  // links are kept for 500 deliveries; thumbnails only for the recent ones, so the
  // settings file stays small
  store.set(
    'history',
    history.slice(0, 500).map((en, i) => (i < HISTORY_THUMBS ? en : { ...en, thumb: null }))
  );
  return result;
});

handle('history:list', () => store.get('history') || []);

handle('clipboard:copy', (_e, text) => {
  clipboard.writeText(String(text));
  return true;
});

handle('shell:open', (_e, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

/* ---------- the found gif ---------- */

handle('gif:latest', () => latestGif);

/** The workbench reports whether the slip already holds a gif. Once one is in
    there the offer is stale, so an open notice comes down with it. */
handle('gif:attached', (_e, attached) => {
  gifAttached = Boolean(attached);
  if (gifAttached && pendingNotice && pendingNotice.kind === 'gif') hideNotice();
  return gifAttached;
});

/* The workbench's staging poll is what notices a sprite arriving, so it does the
   telling. Suppressed while Neku is the focused window: the sprite lands on the
   light table right in front of him there, and a card repeating that would be
   noise. (The gif notice has no such check — a downloaded gif shows up nowhere
   in Neku on its own, so there is nothing for it to be redundant with.) */
handle('sprite:arrived', (_e, sprite) => {
  if (!sprite || !sprite.id) return false;
  if (win && !win.isDestroyed() && win.isFocused()) return false;
  pendingNotice = { kind: 'sprite', id: String(sprite.id) };
  showNotice({ kind: 'sprite', name: sprite.name, size: Number(sprite.size) || 0 }, PRELOAD());
  return true;
});

/** What the watcher is looking at, so the settings sheet can say so out loud. */
handle('gif:watching', () => ({
  folder: watchedFolder,
  active: watchIsActive(),
}));

handle('gif:read', async (_e, filePath) => {
  const gif = await readAnnouncedGif(filePath);
  // it is his now: stop offering it, so "next commission" starts clean
  if (latestGif && latestGif.path === filePath) latestGif = null;
  return gif;
});

/* ---------- corner notice ---------- */

handle('notice:preview', async () => {
  if (!pendingNotice) return null;
  try {
    if (pendingNotice.kind === 'sprite') {
      return await driveOps.getFileBytes(getDriveOrThrow(), pendingNotice.id);
    }
    if (!latestGif || latestGif.size > PREVIEW_MAX_BYTES) return null;
    return await fs.promises.readFile(pendingNotice.path);
  } catch {
    return null; // no preview is survivable; the filename still identifies it
  }
});

/** The primary button. Both kinds bring Neku forward, because clicking is him
    saying "yes, I want to deal with this now"; only the gif also has something
    to hand to the packing slip. */
handle('notice:use', () => {
  const notice = pendingNotice;
  const gif = latestGif;
  hideNotice();
  pendingNotice = null;
  if (win && !win.isDestroyed()) {
    if (notice && notice.kind === 'gif' && gif) win.webContents.send('gif:use', gif);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  return Boolean(notice);
});

handle('notice:dismiss', () => {
  hideNotice();
  pendingNotice = null;
  return true;
});

/* ---------- lifecycle ---------- */

app.whenReady().then(() => {
  createWindow();
  beginGifWatch();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopGifWatch();
  hideNotice();
});

// the corner notice is a second window, so "all windows closed" has to mean the
// main one is gone, not just that a notice timed out
app.on('window-all-closed', () => {
  app.quit();
});
