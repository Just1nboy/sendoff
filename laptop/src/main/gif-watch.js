/* Watches the Downloads folder for a finished .gif.

   He animates on ezgif in the browser and hits download, which means the gif
   lands while Neku is sitting behind the browser window. Rather than make him
   find the window and drag the file across, Neku notices it arriving and offers
   it. Dragging still works exactly as before; this is a shortcut, not a
   replacement.

   Chrome writes a .crdownload placeholder first and renames it once the transfer
   finishes, so an event carrying a .gif name usually means it is already whole.
   The settle check afterwards covers the browsers that write in place instead —
   offering a half-written gif would put a broken animation in front of a client. */
import fs from 'node:fs';
import path from 'node:path';

const SETTLE_POLL_MS = 220;
const SETTLE_MAX_MS = 15000;
const EVENT_DEBOUNCE_MS = 150;

let watcher = null;
let watchedDir = null;
let startedAt = 0;
const announced = new Set(); // "name@mtimeMs", so a re-download of the same name still counts

/** Wait for the file to stop growing. Returns its final size, or null if it
    never settled (still downloading after 15s, or deleted mid-flight). */
async function settledSize(filePath) {
  const deadline = Date.now() + SETTLE_MAX_MS;
  let last = -1;
  let stableFor = 0;
  while (Date.now() < deadline) {
    let size;
    try {
      size = (await fs.promises.stat(filePath)).size;
    } catch {
      return null; // vanished mid-download
    }
    if (size > 0 && size === last) {
      stableFor += SETTLE_POLL_MS;
      if (stableFor >= 2 * SETTLE_POLL_MS) return size;
    } else {
      stableFor = 0;
    }
    last = size;
    await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
  }
  return null;
}

async function consider(name, onGif) {
  const filePath = path.join(watchedDir, name);
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return; // renamed away between the event and now
  }
  if (!stat.isFile()) return;

  /* A gif that was already sitting in Downloads before Neku opened is not news;
     fs.watch fires for plenty of reasons other than a fresh arrival. "Arrived"
     means the newest of the three stamps: a file moved in from elsewhere keeps
     its old mtime, and dropping one into Downloads by hand should still count. */
  const arrivedAt = Math.max(stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs);
  if (arrivedAt < startedAt - 1000) return;

  const key = `${name}@${stat.mtimeMs}`;
  if (announced.has(key)) return;

  const size = await settledSize(filePath);
  if (!size) return;
  if (announced.has(key)) return; // a second event won the race while we waited
  announced.add(key);

  onGif({ path: filePath, name, size, foundAt: new Date().toISOString() });
}

/**
 * Start watching `dir` for gifs. `onGif({ path, name, size, foundAt })` fires
 * once per arrival. Returns false when the folder cannot be watched at all, in
 * which case the drag-and-drop path is simply the only way in.
 */
export function startGifWatch(dir, onGif) {
  stopGifWatch();
  watchedDir = dir;
  startedAt = Date.now();
  const pending = new Map();

  try {
    watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      const name = String(filename);
      if (!name.toLowerCase().endsWith('.gif')) return;
      // one arrival produces a burst of events; act on the last one
      clearTimeout(pending.get(name));
      pending.set(
        name,
        setTimeout(() => {
          pending.delete(name);
          consider(name, onGif).catch(() => {
            /* a missed gif is a missed shortcut, never a failed session */
          });
        }, EVENT_DEBOUNCE_MS)
      );
    });
    // the folder being renamed or removed under us must not take the app down
    watcher.on('error', () => stopGifWatch());
  } catch {
    watcher = null;
  }
  return Boolean(watcher);
}

/** Whether a watcher is currently live, for the settings sheet to report. */
export function watchIsActive() {
  return Boolean(watcher);
}

export function stopGifWatch() {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* already gone */
    }
  }
  watcher = null;
}

/** True if `filePath` is a gif this watcher announced. The renderer asks for
    bytes by path, and only a path we ourselves offered is worth reading. */
export function wasAnnounced(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (!watchedDir) return false;
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== path.resolve(watchedDir)) return false;
  const name = path.basename(resolved);
  if (!name.toLowerCase().endsWith('.gif')) return false;
  for (const key of announced) {
    if (key.slice(0, key.lastIndexOf('@')) === name) return true;
  }
  return false;
}
