/* Drive operations. Everything speaks in terms of the two folders that matter:
   the staging folder (tablet drops sprites here) and Commissions/{Batch}/{Client}
   (where the finished pair lands and gets shared).

   The deliver pipeline is deliberately idempotent: a retry after a partial
   failure re-checks what already happened instead of duplicating work. */
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import {
  GIF_FILE_NAME,
  batchFolderName,
  cleanClientName,
  nextBatchNumber,
  parseBatchNumber,
  spriteFileName,
} from './naming.mjs';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function getDrive(authClient) {
  return google.drive({ version: 'v3', auth: authClient });
}

const escQ = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFolder(drive, name, parentId) {
  let q = `name='${escQ(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const res = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 5 });
  return res.data.files && res.data.files[0] ? res.data.files[0] : null;
}

async function ensureFolder(drive, name, parentId) {
  const found = await findFolder(drive, name, parentId);
  if (found) return { id: found.id, name: found.name, existed: true };
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id,name',
  });
  return { id: created.data.id, name: created.data.name, existed: false };
}

async function findChildByName(drive, parentId, name) {
  const q = `name='${escQ(name)}' and '${parentId}' in parents and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 5 });
  return res.data.files && res.data.files[0] ? res.data.files[0] : null;
}

/* Drive's query language has no "parent in this list" operator, so a multi-parent
   lookup is an or-chain. Chunked to keep any single query a sane length. */
const PARENT_CHUNK = 40;

function chunked(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const parentsClause = (ids) => '(' + ids.map((id) => `'${id}' in parents`).join(' or ') + ')';

/** Direct subfolders of the root that look like batches, newest number first. */
async function listBatchFolders(drive, rootId) {
  const res = await drive.files.list({
    q: `'${rootId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id,name,createdTime)',
    pageSize: 200,
  });
  return (res.data.files || [])
    .map((f) => ({ id: f.id, name: f.name, number: parseBatchNumber(f.name), createdTime: f.createdTime }))
    .filter((b) => b.number !== null)
    .sort((a, b) => b.number - a.number);
}

/** How many client folders each batch holds, for the batch menu. */
async function countClients(drive, batchIds) {
  const counts = new Map();
  for (const chunk of chunked(batchIds, PARENT_CHUNK)) {
    const res = await drive.files.list({
      q: `${parentsClause(chunk)} and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id,parents)',
      pageSize: 1000,
    });
    for (const f of res.data.files || []) {
      for (const parent of f.parents || []) {
        counts.set(parent, (counts.get(parent) || 0) + 1);
      }
    }
  }
  return counts;
}

/** Every batch under the root, for the "which batch?" menu. */
export async function listBatches(drive, rootName) {
  const root = await ensureFolder(drive, rootName);
  const batches = await listBatchFolders(drive, root.id);
  const counts = await countClients(drive, batches.map((b) => b.id));
  return {
    rootId: root.id,
    nextNumber: nextBatchNumber(batches.map((b) => b.name)),
    batches: batches.map((b) => ({ ...b, clients: counts.get(b.id) || 0 })),
  };
}

/** Start the next batch. The number always counts up from the highest that exists. */
export async function createBatch(drive, rootName) {
  const root = await ensureFolder(drive, rootName);
  const batches = await listBatchFolders(drive, root.id);
  const name = batchFolderName(nextBatchNumber(batches.map((b) => b.name)));
  const created = await ensureFolder(drive, name, root.id);
  return {
    id: created.id,
    name: created.name,
    number: parseBatchNumber(created.name),
    clients: 0,
    createdTime: new Date().toISOString(),
  };
}

/** Everything currently sitting in the staging folder, newest first. */
export async function listStaging(drive, stagingName) {
  const staging = await ensureFolder(drive, stagingName);
  const res = await drive.files.list({
    q: `'${staging.id}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime,size,mimeType,appProperties)',
    orderBy: 'modifiedTime desc',
    pageSize: 25,
  });
  return { stagingId: staging.id, files: res.data.files || [] };
}

/* The receipt the tablet reads.

   After sending, the tablet has no way of knowing whether the sprite ever got
   picked up, which is what makes him send twice and end up with two sprites on
   the light table. Drive itself is the only thing both surfaces can see, so the
   laptop stamps the file as it appears on the light table and the tablet reads
   that stamp back off the file it uploaded. No server in between. */
export const SEEN_KEY = 'nekuSeen';

// a stamp that keeps failing (revoked access to someone else's upload, say) must
// not be retried on every 15-second poll for the rest of the session
const stampAttempted = new Set();

export async function markStagedSeen(drive, files) {
  const stamped = [];
  for (const file of files || []) {
    if (file.appProperties && file.appProperties[SEEN_KEY]) continue;
    if (stampAttempted.has(file.id)) continue;
    stampAttempted.add(file.id);
    try {
      await drive.files.update({
        fileId: file.id,
        requestBody: { appProperties: { [SEEN_KEY]: new Date().toISOString() } },
        fields: 'id',
      });
      stamped.push(file.id);
    } catch {
      // the stamp is a courtesy to the tablet; it must never break the light table
    }
  }
  return stamped;
}

/** Get a wrong upload off the light table.

    Trashed, not deleted: Drive keeps a trashed file for 30 days, so an X hit by
    mistake costs him a trip to drive.google.com rather than the sprite itself.
    Never make this a permanent delete. */
export async function discardStaged(drive, fileId) {
  await drive.files.update({ fileId, requestBody: { trashed: true }, fields: 'id' });
  return { id: fileId };
}

export async function getFileBytes(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

/** Has this client been delivered before, in ANY batch? (Never expected, since
    there are no repeat clients, so the UI surfaces a hit as a possible typo.)
    The root itself is searched too, for folders delivered before batches existed. */
export async function checkClientFolder(drive, rootName, clientName) {
  const root = await findFolder(drive, rootName);
  if (!root) return { exists: false, batchName: null };
  const name = cleanClientName(clientName);
  const batches = await listBatchFolders(drive, root.id);
  const byId = new Map(batches.map((b) => [b.id, b.name]));

  for (const chunk of chunked([root.id, ...batches.map((b) => b.id)], PARENT_CHUNK)) {
    const res = await drive.files.list({
      q:
        `name='${escQ(name)}' and mimeType='${FOLDER_MIME}' and trashed=false ` +
        `and ${parentsClause(chunk)}`,
      fields: 'files(id,name,parents)',
      pageSize: 10,
    });
    const hit = (res.data.files || [])[0];
    if (hit) {
      const parent = (hit.parents || []).find((p) => byId.has(p));
      return { exists: true, batchName: parent ? byId.get(parent) : null };
    }
  }
  return { exists: false, batchName: null };
}

/**
 * The whole delivery in one call:
 *   folders -> sprite -> gif -> share -> link
 *
 * opts = {
 *   rootName, stagingName,
 *   batchName,                       // "Batch 3": resolved by name, so a batch
 *                                    // deleted in Drive is simply recreated
 *   stagingId,                       // where the sprite currently lives
 *   sprite: { kind:'drive', id, name } | { kind:'local', bytes:Buffer, name },
 *   clientName,
 *   gifBytes: Buffer,
 * }
 * onStep(step) fires as each phase starts.
 */
export async function deliver(drive, opts, onStep) {
  const clientName = cleanClientName(opts.clientName);
  const targetSprite = spriteFileName(clientName);
  const notices = [];

  onStep('folders');
  const root = await ensureFolder(drive, opts.rootName);
  const batch = await ensureFolder(drive, opts.batchName, root.id);
  const clientFolder = await ensureFolder(drive, clientName, batch.id);
  if (clientFolder.existed) {
    notices.push(
      `Folder "${clientName}" already existed in ${batch.name}. Files were added into it.`
    );
  }

  onStep('sprite');
  const existingSprite = await findChildByName(drive, clientFolder.id, targetSprite);
  if (opts.sprite.kind === 'drive') {
    if (existingSprite && existingSprite.id === opts.sprite.id) {
      // retry of a partially-completed run: the move already happened
    } else {
      try {
        await drive.files.update({
          fileId: opts.sprite.id,
          addParents: clientFolder.id,
          removeParents: opts.stagingId,
          requestBody: { name: targetSprite },
          fields: 'id,parents',
        });
      } catch (err) {
        // the staged file vanished but the named sprite is in place -> done earlier
        if (!(existingSprite && (err.code === 404 || err.status === 404))) throw err;
      }
      if (existingSprite && existingSprite.id !== opts.sprite.id) {
        notices.push(
          `Two files named ${targetSprite} are now in the folder. Remove the stale one in Drive.`
        );
      }
    }
  } else {
    const media = { mimeType: 'image/png', body: Readable.from(opts.sprite.bytes) };
    if (existingSprite) {
      await drive.files.update({ fileId: existingSprite.id, media, fields: 'id' });
    } else {
      await drive.files.create({
        requestBody: { name: targetSprite, parents: [clientFolder.id] },
        media,
        fields: 'id',
      });
    }
  }

  onStep('gif');
  const gifMedia = { mimeType: 'image/gif', body: Readable.from(opts.gifBytes) };
  const existingGif = await findChildByName(drive, clientFolder.id, GIF_FILE_NAME);
  if (existingGif) {
    await drive.files.update({ fileId: existingGif.id, media: gifMedia, fields: 'id' });
    notices.push(`${GIF_FILE_NAME} already existed. Its contents were replaced.`);
  } else {
    await drive.files.create({
      requestBody: { name: GIF_FILE_NAME, parents: [clientFolder.id] },
      media: gifMedia,
      fields: 'id',
    });
  }

  // the CLIENT folder is shared, never the batch folder: one client's link must
  // not expose the rest of the batch
  onStep('share');
  await drive.permissions.create({
    fileId: clientFolder.id,
    requestBody: { type: 'anyone', role: 'reader' },
  });

  onStep('link');
  const meta = await drive.files.get({
    fileId: clientFolder.id,
    fields: 'webViewLink,name',
  });

  return {
    link: meta.data.webViewLink,
    folderName: meta.data.name,
    batchName: batch.name,
    spriteName: targetSprite,
    gifName: GIF_FILE_NAME,
    notices,
  };
}
