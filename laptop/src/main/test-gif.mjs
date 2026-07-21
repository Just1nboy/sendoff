/* A real animated gif, built from scratch, for the autopilot to drop into the
   watched folder. The Downloads watcher waits for a file to stop growing and the
   corner notice renders a preview of it, so testing either with a stub would test
   nothing: the harness needs bytes a decoder actually accepts.

   Encoded with an LZW stream that never compresses. With a minimum code size of
   7, codes start at 8 bits, and emitting a clear code every 100 pixels keeps the
   dictionary too small to ever need a 9th bit. Every code is therefore exactly
   one byte, which makes the encoder short enough to trust by reading it. */

const WIDTH = 48;
const HEIGHT = 48;
const BLOCK = 12; // the bouncing square
const FRAME_DELAY_CS = 12; // hundredths of a second

const CLEAR_CODE = 128;
const EOI_CODE = 129;
const MIN_CODE_SIZE = 7;
const PIXELS_PER_CLEAR = 100; // safely under the 126 that would force 9-bit codes

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];

/** One frame: dark background, orange block at height `top`. */
function frameIndices(top) {
  const px = new Array(WIDTH * HEIGHT).fill(0);
  const left = Math.round((WIDTH - BLOCK) / 2);
  for (let y = top; y < top + BLOCK; y++) {
    for (let x = left; x < left + BLOCK; x++) px[y * WIDTH + x] = 1;
  }
  return px;
}

function lzwCodes(indices) {
  const out = [CLEAR_CODE];
  let sinceClear = 0;
  for (const index of indices) {
    if (sinceClear >= PIXELS_PER_CLEAR) {
      out.push(CLEAR_CODE);
      sinceClear = 0;
    }
    out.push(index);
    sinceClear++;
  }
  out.push(EOI_CODE);
  return out;
}

/** Image data is carried in sub-blocks of at most 255 bytes, length-prefixed. */
function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0x00);
  return out;
}

/** An animated gif of a square bouncing on the spot. Returns a Buffer. */
export function makeBouncyGif() {
  const bytes = [];

  bytes.push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
  // logical screen: global colour table of 128 entries (2^(6+1))
  bytes.push(...u16(WIDTH), ...u16(HEIGHT), 0x96, 0x00, 0x00);
  // the palette Neku uses everywhere: near-black, then the poster orange
  const palette = new Array(128 * 3).fill(0);
  [palette[0], palette[1], palette[2]] = [0x14, 0x14, 0x14];
  [palette[3], palette[4], palette[5]] = [0xff, 0x6a, 0x00];
  bytes.push(...palette);

  // NETSCAPE2.0 application extension: loop forever
  bytes.push(0x21, 0xff, 0x0b);
  for (const ch of 'NETSCAPE2.0') bytes.push(ch.charCodeAt(0));
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  const travel = HEIGHT - BLOCK;
  const tops = [0, Math.round(travel / 2), travel, Math.round(travel / 2)];
  for (const top of tops) {
    // graphic control: disposal "do not dispose", no transparency (every frame
    // repaints the whole canvas, so nothing can leave a trail)
    bytes.push(0x21, 0xf9, 0x04, 0x04, ...u16(FRAME_DELAY_CS), 0x00, 0x00);
    // image descriptor: full canvas, no local colour table, not interlaced
    bytes.push(0x2c, ...u16(0), ...u16(0), ...u16(WIDTH), ...u16(HEIGHT), 0x00);
    bytes.push(MIN_CODE_SIZE);
    bytes.push(...subBlocks(lzwCodes(frameIndices(top))));
  }

  bytes.push(0x3b); // trailer
  return Buffer.from(bytes);
}
