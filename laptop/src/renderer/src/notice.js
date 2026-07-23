/* The corner notice's own tiny renderer. No React here: it is one card with two
   buttons, and it has to be on screen the instant the gif finishes downloading. */
import './notice.css';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') === 'sprite' ? 'sprite' : 'gif';
const name = params.get('name') || '';
const size = Number(params.get('size') || 0);

/* Two arrivals, one card. A download needs a decision from him ("use this
   one?"); the file from the tablet is already on the light table, so the only
   thing left to offer is a way back to the window. */
const COPY = {
  gif: { tag: 'file landed in downloads', accept: 'Use it →' },
  sprite: { tag: 'artwork arrived from the tablet', accept: 'Show me →' },
};

/* The preview's type comes from the file itself. It used to be fixed per kind,
   which was fine while one side was always a .gif and the other always a .png. */
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function mimeFor(fileName) {
  const dot = String(fileName).lastIndexOf('.');
  return (dot > 0 && MIME_BY_EXT[fileName.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

document.querySelector('.notice-tag').textContent = COPY[kind].tag;
document.getElementById('btn-use').textContent = COPY[kind].accept;
document.getElementById('name').textContent = name;
document.getElementById('name').title = name;
document.getElementById('size').textContent = fmtSize(size);

document.getElementById('btn-use').addEventListener('click', () => {
  window.sendoffNotice.use();
});
document.getElementById('btn-dismiss').addEventListener('click', () => {
  window.sendoffNotice.dismiss();
});

// Escape dismisses, the way every other notification does
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.sendoffNotice.dismiss();
});

/* The preview is the point: seeing the animation bounce in the corner is how he
   knows it is the right export before committing it to a client's folder, and
   seeing the sprite is how he knows the tablet sent the drawing he meant. */
(async () => {
  try {
    const res = await window.sendoffNotice.preview();
    if (!res || !res.ok || !res.data) return;
    const blob = new Blob([new Uint8Array(res.data)], { type: mimeFor(name) });
    const img = document.createElement('img');
    img.alt = '';
    img.src = URL.createObjectURL(blob);
    document.getElementById('thumb').appendChild(img);
  } catch {
    /* no preview is fine; the filename alone still identifies it */
  }
})();
