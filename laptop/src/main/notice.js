/* The corner notice: Sendoff's own notification, not a Windows one.

   Two things need to reach him while he is looking at something else: the gif
   finishing its download (he is in the browser), and a sprite arriving from the
   tablet (he is at the tablet, or mid-way through the previous commission). So
   this is a real window — small, frameless, bottom-right, above whatever is in
   front — rather than an in-app banner he would never see. showInactive() is
   load-bearing: stealing focus from whatever he is doing would be worse than
   saying nothing at all. */
import path from 'node:path';
import { BrowserWindow, screen } from 'electron';

const WIDTH = 384;
const HEIGHT = 148;
const MARGIN = 18;
const AUTO_HIDE_MS = 22000;

let noticeWin = null;
let hideTimer = null;

function noticeUrl(query) {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL('notice.html', `${process.env.ELECTRON_RENDERER_URL}/`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return { kind: 'url', value: url.toString() };
  }
  return {
    kind: 'file',
    value: path.join(__dirname, '../renderer/notice.html'),
    query,
  };
}

/** Show the notice for one arrival. `kind` is 'gif' or 'sprite'. Rebuilt each
    time: a fresh window is cheap at this rate and beats keeping stale state
    around between arrivals. */
export function showNotice({ kind, name, size }, preloadPath) {
  hideNotice();

  const area = screen.getPrimaryDisplay().workArea;
  noticeWin = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: area.x + area.width - WIDTH - MARGIN,
    y: area.y + area.height - HEIGHT - MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      backgroundThrottling: false,
    },
  });

  noticeWin.setAlwaysOnTop(true, 'screen-saver'); // above a maximised browser
  noticeWin.setVisibleOnAllWorkspaces(true);

  const target = noticeUrl({ kind, name, size: String(size || 0) });
  if (target.kind === 'url') noticeWin.loadURL(target.value);
  else noticeWin.loadFile(target.value, { query: target.query });

  noticeWin.once('ready-to-show', () => {
    if (noticeWin && !noticeWin.isDestroyed()) noticeWin.showInactive();
  });
  noticeWin.on('closed', () => {
    noticeWin = null;
  });

  hideTimer = setTimeout(hideNotice, AUTO_HIDE_MS);
}

export function hideNotice() {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (noticeWin && !noticeWin.isDestroyed()) noticeWin.destroy();
  noticeWin = null;
}

export function noticeIsOpen() {
  return Boolean(noticeWin && !noticeWin.isDestroyed());
}
