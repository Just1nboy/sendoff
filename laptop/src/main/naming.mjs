/* The naming convention: the one hardcoded rule the whole app is built around.
   Sprite:    {ClientName}_sprite.png
   Animation: bouncy.gif  (always literal, confirmed with the artist)
   Batch:     Batch 1, Batch 2, ...  (he works in batches; each holds client folders)

   Drive ends up as:  {rootName}/Batch 3/{ClientName}/{ClientName}_sprite.png
                                                     /bouncy.gif */

export const GIF_FILE_NAME = 'bouncy.gif';

const BATCH_RE = /^Batch (\d+)$/;

export function batchFolderName(number) {
  return `Batch ${number}`;
}

/** The number in "Batch 7", or null for any folder that isn't a batch.
    Anything unparseable is ignored rather than renamed: folders he made by
    hand in Commissions are left alone. */
export function parseBatchNumber(folderName) {
  const match = BATCH_RE.exec(String(folderName ?? '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* He had already worked through four batches by hand before Neku existed, and
   Neku cannot see those folders (drive.file scope: it only ever sees what it
   created itself). So the first batch it makes is Batch 5, continuing his real
   count instead of restarting at 1 alongside his own history. */
export const FIRST_BATCH_NUMBER = 5;

/** Batches count up and never reuse a number, so a deleted Batch 6 does not
    hand its name to the next batch. */
export function nextBatchNumber(existingFolderNames) {
  let highest = 0;
  for (const name of existingFolderNames || []) {
    const n = parseBatchNumber(name);
    if (n !== null && n > highest) highest = n;
  }
  return highest ? highest + 1 : FIRST_BATCH_NUMBER;
}

/** Trim, collapse runs of whitespace, and swap path separators for a dash.
    Throws if nothing is left; an empty client name means no folder to file under. */
export function cleanClientName(raw) {
  const name = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[/\\]/g, '-');
  if (!name) throw new Error('Client name is empty.');
  return name;
}

export function spriteFileName(clientName) {
  return `${cleanClientName(clientName)}_sprite.png`;
}
