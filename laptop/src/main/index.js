/* Sendoff main process: window, settings store, IPC surface, mock/real Drive switch.

   OAuth credentials resolve in priority order:
     1. Settings the user typed in-app (electron-store)
     2. sendoff.config.json sitting next to the portable exe (no-rebuild handoff)
     3. Values baked in at build time from oauth.config.json (single-file handoff)
   The friend receiving a baked/sidecar build never sees a setup screen. */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import Store from 'electron-store';
import * as auth from './auth.js';
import * as realDrive from './drive.js';
import * as mockDrive from './drive-mock.js';
import * as localStorage from './storage-local.js';
import { runAutopilot } from './autopilot.js';
import { startGifWatch, stopGifWatch, wasAnnounced, watchIsActive } from './gif-watch.js';
import { matchPreset, presetById, resolveNaming, validateNaming } from './naming.mjs';
import { hideNotice, showNotice } from './notice.js';

const MOCK = process.env.SENDOFF_MOCK === '1';

const BAKED = typeof __SENDOFF_BAKED__ !== 'undefined' ? __SENDOFF_BAKED__ : {};

function readSidecarConfig() {
  try {
    // portable builds run from a temp unpack dir; this env var points at the real exe
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
    const raw = fs.readFileSync(path.join(exeDir, 'sendoff.config.json'), 'utf8');
    // tolerate a UTF-8 BOM from Notepad / Windows PowerShell
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return {};
  }
}
const SIDECAR = readSidecarConfig();

const FALLBACKS = { stagingName: 'Sprite Staging', rootName: 'Commissions' };

const store = new Store({ name: MOCK ? 'sendoff-mock' : 'sendoff' });

/* This app shipped once under an earlier name. If an install from that era
   updates to this build, its saved sign-in and delivery history sit under the
   old userData directory; import them once so nothing the user relied on is
   lost. This is the only place the previous name survives, purely as a path to
   that old data. Guarded off mock and wizard runs so it can't touch a test. */
if (!MOCK && !process.env.SENDOFF_FORCE_SETUP && store.size === 0) {
  try {
    const legacy = path.join(app.getPath('appData'), 'Neku', 'neku.json');
    const raw = fs.readFileSync(legacy, 'utf8');
    const data = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    for (const [key, value] of Object.entries(data)) store.set(key, value);
  } catch {
    /* nothing to import: a fresh install, which is the common case */
  }
}

// autopilot runs must be reproducible: always start at the project menu, never in
// whatever project the last run happened to leave open
if (process.env.SENDOFF_SHOT_DIR) {
  store.delete('currentProject');
  store.delete('currentBatch');
}

// a wizard run has to start with nothing chosen, every time
if (process.env.SENDOFF_FORCE_SETUP === '1') {
  store.delete('storage');
  store.delete('localRoot');
}

/* SENDOFF_PRESET=photo boots as a different trade, so the same self-driving run can
   prove the flow is not tied to one set of names. Unset means the default. */
if (process.env.SENDOFF_PRESET) {
  const preset = presetById(process.env.SENDOFF_PRESET);
  if (preset) store.set('naming', resolveNaming(preset.naming));
  else store.delete('naming');
} else if (process.env.SENDOFF_SHOT_DIR) {
  // a shot run that names no preset must not inherit the last run's naming
  store.delete('naming');
}

/* The naming templates, merged the same way credentials are: a build can ship
   preconfigured for a trade, and anything typed in-app wins over that. Missing
   pieces fall back to the defaults, so a settings file written by an older
   version still resolves to a complete set. */
function effectiveNaming() {
  return resolveNaming({
    ...(BAKED.naming || {}),
    ...(SIDECAR.naming || {}),
    ...(store.get('naming') || {}),
  });
}

const pickSetting = (key) => store.get(key) || SIDECAR[key] || BAKED[key] || FALLBACKS[key] || '';

/* Where deliveries go. Two real backends: a Google Drive account, or a folder on
   this computer (no account, no Cloud project, nothing to set up).

   An empty answer means nobody has chosen yet, which is what puts the first-run
   wizard on screen. A build that shipped WITH credentials is a Drive build by
   definition, so it never asks: the person who packaged it already answered. */
function effectiveStorage() {
  /* Capturing or driving the first-run screens on a machine that is already set
     up. Same purpose as SENDOFF_MOCK_EMPTY: reach a state that only exists on
     somebody else's day one. It stops applying the moment the wizard saves a
     choice, or finishing the wizard would just show it again. */
  if (process.env.SENDOFF_FORCE_SETUP === '1' && !store.get('storage')) return '';
  const chosen = store.get('storage') || SIDECAR.storage || BAKED.storage || '';
  if (chosen === 'local' || chosen === 'drive') return chosen;
  return auth.hasCreds({
    clientId: pickSetting('clientId'),
    clientSecret: pickSetting('clientSecret'),
  })
    ? 'drive'
    : '';
}

function effectiveSettings() {
  const naming = effectiveNaming();
  const preset = matchPreset(naming);
  return {
    clientId: pickSetting('clientId'),
    clientSecret: pickSetting('clientSecret'),
    stagingName: pickSetting('stagingName'),
    rootName: pickSetting('rootName'),
    storage: effectiveStorage(),
    localRoot: pickSetting('localRoot'),
    naming,
    // null means the templates have been hand-edited away from every preset
    presetId: preset ? preset.id : null,
  };
}

/** Mock beats everything (npm run mock/shots); otherwise the chosen backend. */
function storageMode() {
  if (MOCK) return 'mock';
  return effectiveStorage() === 'local' ? 'local' : 'drive';
}

/** The backend module in force. Every one of these exports the same shapes. */
function ops() {
  const mode = storageMode();
  if (mode === 'mock') return mockDrive;
  if (mode === 'local') return localStorage;
  return realDrive;
}

let win = null;

// thumbnails cost ~1-15 KB each in sendoff.json; the newest 20 is plenty to
// recognise recent work without the settings file growing
const HISTORY_THUMBS = 20;

const PRELOAD = () => path.join(__dirname, '../preload/index.js');

/* The gif Downloads-watching last spotted, held until he uses it or a newer one
   arrives. Kept in main because the notice is a main-process window. */
let latestGif = null;

/* Whether the packing slip already holds a gif. That is the only thing worth
   suppressing a notice for. An earlier version also required the workbench to be
   open, which made the notice silently do nothing whenever he happened to be on
   the project menu — a shortcut that quietly fails to appear is worse than one
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
    title: 'Sendoff',
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

  if (process.env.SENDOFF_SHOT_DIR) {
    win.webContents.once('did-finish-load', () => {
      const shotDir = path.resolve(process.env.SENDOFF_SHOT_DIR);
      runAutopilot(win, shotDir, MOCK, effectiveNaming()).catch((err) => {
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

/** The project he picked from the menu, remembered across restarts so reopening
    Sendoff mid-project drops him straight back into it.

    Reads the pre-rename key too: an install that was mid-project when it updated
    must land back in that project, not be dumped at the menu. */
function currentProject() {
  const project = store.get('currentProject') || store.get('currentBatch');
  return project && project.name ? project : null;
}

/* "configured" means the app knows where deliveries go; "loggedIn" means it may
   actually put them there. A local folder collapses the two: once a folder is
   picked there is nothing left to sign in to. */
function currentState() {
  const settings = effectiveSettings();
  const mode = storageMode();
  return {
    mock: MOCK,
    storage: mode,
    configured:
      MOCK ||
      (mode === 'local' ? Boolean(settings.localRoot) : settings.storage === 'drive' && auth.hasCreds(settings)),
    loggedIn: MOCK || mode === 'local' || auth.isLoggedIn(store),
    settings,
    project: currentProject(),
  };
}

function getDriveOrThrow() {
  const mode = storageMode();
  if (mode === 'mock') return mockDrive.getDrive();
  if (mode === 'local') return localStorage.getDrive(effectiveSettings().localRoot);
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

/** He animates on ezgif with Sendoff behind the browser, so the moment the gif
    lands is the moment he is looking somewhere else. Sendoff's own corner notice
    (not a Windows one) carries the offer over to wherever he is. */
function onGifFound(gif) {
  if (gifAttached) return;
  latestGif = gif;
  if (win && !win.isDestroyed()) win.webContents.send('gif:found', gif);
  pendingNotice = { kind: 'gif', path: gif.path };
  showNotice({ kind: 'gif', name: gif.name, size: gif.size }, PRELOAD());
}

/* The watcher looks for whatever the attachment is going to be. A template with
   a fixed extension ("bouncy.gif") makes that exact, so nothing else in
   Downloads raises a card; an open-ended one falls back to the general set. */
function watchedExtensions() {
  const template = String(effectiveNaming().attachedTemplate || '');
  if (template.includes('{ext}')) return null;
  const ext = path.extname(template).toLowerCase();
  return ext ? [ext] : null;
}

function beginGifWatch() {
  if (process.env.SENDOFF_WATCH_DIR) {
    // the autopilot drops a real gif in to prove the whole chain; pointing it at
    // a temp folder keeps the test out of the actual Downloads folder
    watchedFolder = path.resolve(process.env.SENDOFF_WATCH_DIR);
    fs.mkdirSync(watchedFolder, { recursive: true });
  } else {
    watchedFolder = app.getPath('downloads');
  }
  startGifWatch(watchedFolder, onGifFound, watchedExtensions());
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
  const allowed = ['clientId', 'clientSecret', 'stagingName', 'rootName', 'storage', 'localRoot'];
  const before = effectiveSettings().clientId;

  /* Naming is validated before anything is written: a template that fills in to
     an empty string would fail at the worst possible moment, mid-delivery, with
     the client already waiting. */
  if (partial && partial.naming) {
    const naming = resolveNaming(partial.naming);
    const errors = validateNaming(naming);
    if (errors) throw new Error(Object.values(errors)[0]);
    store.set('naming', naming);
  }

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
  // changing the attachment's name changes what is worth watching Downloads for
  if (partial && partial.naming) beginGifWatch();
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

handle('project:list', async () => {
  const drive = getDriveOrThrow();
  const settings = effectiveSettings();
  return ops().listProjects(drive, settings.rootName, settings.naming);
});

handle('project:create', async () => {
  const drive = getDriveOrThrow();
  const settings = effectiveSettings();
  return ops().createProject(drive, settings.rootName, settings.naming);
});

/** Pick a project to work in, or pass null to go back to the project menu. */
handle('project:select', (_e, project) => {
  if (project && project.name) {
    store.set('currentProject', {
      id: project.id || null,
      name: String(project.name),
      number: project.number ?? null,
    });
  } else {
    store.delete('currentProject');
  }
  // the pre-rename key is read as a fallback, so leaving it behind would let an
  // old project reappear the moment he tried to go back to the menu
  store.delete('currentBatch');
  return currentState();
});

handle('staging:list', async () => {
  const drive = getDriveOrThrow();
  const listing = await ops().listStaging(drive, effectiveSettings().stagingName);
  // seeing it here is what "the laptop has it" means, so stamp it now and let
  // the tablet stop wondering. Swallows its own errors.
  await ops().markStagedSeen(drive, listing.files);
  return listing;
});

/** The X on the light table: a wrong sprite came off the tablet. Goes to Drive's
    trash, so this is recoverable — see discardStaged. */
handle('staging:discard', async (_e, fileId) => {
  const drive = getDriveOrThrow();
  return ops().discardStaged(drive, String(fileId));
});

handle('file:bytes', async (_e, fileId) => {
  const drive = getDriveOrThrow();
  return ops().getFileBytes(drive, fileId);
});

/** Drop the parts of a name Windows will not accept in a file name, keeping
    whatever extension it already had. */
function safeSaveFileName(name) {
  const base = String(name || 'artwork.png')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'artwork.png';
  return path.extname(base) ? base : `${base}.png`;
}

/** Put the selected file on this machine's disk, so he can work on it locally.
    This is the point of the whole two-surface arrangement, not a convenience.
    sprite = { kind:'drive', id, name } | { kind:'local', bytes, name } */
handle('sprite:save', async (_e, sprite) => {
  const bytes =
    sprite.kind === 'drive'
      ? await ops().getFileBytes(getDriveOrThrow(), sprite.id)
      : Buffer.from(sprite.bytes);
  // reopen wherever he saved last: the editing tool's folder, most likely
  const dir = store.get('lastSaveDir') || app.getPath('downloads');
  const fileName = safeSaveFileName(sprite.name);
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const res = await dialog.showSaveDialog(win, {
    title: 'Save file',
    defaultPath: path.join(dir, fileName),
    filters: ext
      ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'All files', extensions: ['*'] }],
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
  const settings = effectiveSettings();
  return ops().checkClientFolder(drive, settings.rootName, clientName, settings.naming);
});

handle('deliver', async (event, payload) => {
  const drive = getDriveOrThrow();
  // the store is the authority on which project is open, not the renderer payload
  const project = currentProject();
  if (!project) throw new Error('No project is open. Pick a project first.');
  const sprite =
    payload.sprite.kind === 'drive'
      ? payload.sprite
      : { kind: 'local', name: payload.sprite.name, bytes: Buffer.from(payload.sprite.bytes) };
  const settings = effectiveSettings();
  const result = await ops().deliver(
    drive,
    {
      rootName: settings.rootName,
      stagingName: settings.stagingName,
      naming: settings.naming,
      projectName: project.name,
      projectNumber: project.number ?? null,
      stagingId: payload.stagingId,
      sprite,
      clientName: payload.clientName,
      gifBytes: Buffer.from(payload.gifBytes),
      // the dragged file's own name, so {name} and {ext} have something to read
      gifName: payload.gifName || '',
      /* Which revision, decided before the first attempt and passed in, so a
         retry after a partial failure reuses the same number instead of
         stacking a v3 next to the v2 it already made. */
      revision: Number.isInteger(payload.revision) && payload.revision > 1 ? payload.revision : null,
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
    projectName: result.projectName,
    revisionName: result.revisionName || null,
    link: result.link,
    // a local delivery's "link" is a folder path, which opens differently
    isPath: Boolean(result.isPath),
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

/* Everyone this Drive has ever been delivered to, newest first, derived from the
   delivery history rather than from Drive: it is already on disk, it is already
   the record of what actually shipped, and it costs no API call while he types.

   Point of it: stop retyping a name he has used before, and let a repeat client
   be recognised as a repeat client instead of read as a typo. */
handle('clients:list', () => {
  const byName = new Map();
  for (const en of store.get('history') || []) {
    const name = String(en.clientName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const seen = byName.get(key);
    if (seen) {
      seen.deliveries += 1;
      continue;
    }
    // history is newest first, so the first sighting is the most recent delivery
    byName.set(key, {
      name,
      deliveries: 1,
      lastDeliveredAt: en.deliveredAt || null,
      lastProjectName: en.projectName || en.batchName || null,
      lastLink: en.link || null,
    });
  }
  return [...byName.values()];
});

/* Deliveries recorded before the batch/project rename carry batchName. They are
   the record of real work and old links have to stay findable, so they are read
   forward rather than migrated in place. */
handle('history:list', () =>
  (store.get('history') || []).map((en) =>
    en.projectName || !en.batchName ? en : { ...en, projectName: en.batchName }
  )
);

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

/** A delivered folder in local mode: there is no link, so open the folder. */
handle('shell:openPath', async (_e, target) => {
  if (typeof target !== 'string' || !target) return false;
  const message = await shell.openPath(target);
  if (message) throw new Error(message);
  return true;
});

/** Pick the folder deliveries go into. The only setup local mode needs. */
handle('folder:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose where deliveries go',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: effectiveSettings().localRoot || app.getPath('documents'),
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  return { canceled: false, path: res.filePaths[0] };
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
   telling. Suppressed while Sendoff is the focused window: the sprite lands on the
   light table right in front of him there, and a card repeating that would be
   noise. (The gif notice has no such check — a downloaded gif shows up nowhere
   in Sendoff on its own, so there is nothing for it to be redundant with.) */
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
      return await ops().getFileBytes(getDriveOrThrow(), pendingNotice.id);
    }
    if (!latestGif || latestGif.size > PREVIEW_MAX_BYTES) return null;
    return await fs.promises.readFile(pendingNotice.path);
  } catch {
    return null; // no preview is survivable; the filename still identifies it
  }
});

/** The primary button. Both kinds bring Sendoff forward, because clicking is him
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
