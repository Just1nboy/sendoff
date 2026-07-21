/* The corner notice's own tiny renderer. No React here: it is one card with two
   buttons, and it has to be on screen the instant the gif finishes downloading. */
import './notice.css';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') === 'sprite' ? 'sprite' : 'gif';
const name = params.get('name') || '';
const size = Number(params.get('size') || 0);

/* Two arrivals, one card. The gif needs a decision from him ("use this one?");
   the sprite is already on the light table, so the only thing left to offer is
   a way back to the window. */
const COPY = {
  gif: { tag: 'gif landed in downloads', accept: 'Use it →', mime: 'image/gif' },
  sprite: { tag: 'sprite arrived from the tablet', accept: 'Show me →', mime: 'image/png' },
};

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
  window.nekuNotice.use();
});
document.getElementById('btn-dismiss').addEventListener('click', () => {
  window.nekuNotice.dismiss();
});

// Escape dismisses, the way every other notification does
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.nekuNotice.dismiss();
});

/* The preview is the point: seeing the animation bounce in the corner is how he
   knows it is the right export before committing it to a client's folder, and
   seeing the sprite is how he knows the tablet sent the drawing he meant. */
(async () => {
  try {
    const res = await window.nekuNotice.preview();
    if (!res || !res.ok || !res.data) return;
    const blob = new Blob([new Uint8Array(res.data)], { type: COPY[kind].mime });
    const img = document.createElement('img');
    img.alt = '';
    img.src = URL.createObjectURL(blob);
    document.getElementById('thumb').appendChild(img);
  } catch {
    /* no preview is fine; the filename alone still identifies it */
  }
})();
