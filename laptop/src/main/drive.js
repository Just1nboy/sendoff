/* Drive operations. Everything speaks in terms of the two folders that matter:
   the staging folder (the phone/tablet drops files here) and {root}/{project}/{client}
   (where the finished pair lands and gets shared).

   Every name written here comes from the caller's naming templates, never from a
   constant in this file. See naming.mjs.

   The deliver pipeline is deliberately idempotent: a retry after a partial
   failure re-checks what already happened instead of duplicating work. */
import path from 'node:path';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import {
  applyTemplate,
  cleanName,
  nextProjectNumber,
  nextRevisionNumber,
  parseProjectNumber,
  projectFolderName,
  resolveNaming,
  revisionFolderName,
  templateVars,
} from './naming.mjs';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/* Enough of a mime table to cover what a freelancer actually delivers. Drive
   sniffs content anyway; this only stops it filing everything as octet-stream. */
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/postscript',
  '.txt': 'text/plain',
};

export function mimeForName(fileName) {
  return MIME_BY_EXT[path.extname(String(fileName || '')).toLowerCase()] ||
    'application/octet-stream';
}

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

/** Direct subfolders of the root matching the project template, newest number first. */
async function listProjectFolders(drive, rootId, naming) {
  const res = await drive.files.list({
    q: `'${rootId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: 'files(id,name,createdTime)',
    pageSize: 200,
  });
  return (res.data.files || [])
    .map((f) => ({
      id: f.id,
      name: f.name,
      number: parseProjectNumber(naming.projectTemplate, f.name),
      createdTime: f.createdTime,
    }))
    .filter((b) => b.number !== null)
    .sort((a, b) => b.number - a.number);
}

/** How many client folders each project holds, for the project menu. */
async function countClients(drive, projectIds) {
  const counts = new Map();
  for (const chunk of chunked(projectIds, PARENT_CHUNK)) {
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

/** Every project under the root, for the "which project?" menu. */
export async function listProjects(drive, rootName, namingIn) {
  const naming = resolveNaming(namingIn);
  const root = await ensureFolder(drive, rootName);
  const projects = await listProjectFolders(drive, root.id, naming);
  const counts = await countClients(drive, projects.map((b) => b.id));
  return {
    rootId: root.id,
    nextNumber: nextProjectNumber(
      projects.map((b) => b.name),
      naming.projectTemplate,
      naming.firstProjectNumber
    ),
    nextName: projectFolderName(
      naming.projectTemplate,
      nextProjectNumber(projects.map((b) => b.name), naming.projectTemplate, naming.firstProjectNumber)
    ),
    projects: projects.map((b) => ({ ...b, clients: counts.get(b.id) || 0 })),
  };
}

/** Start the next project. The number always counts up from the highest that exists. */
export async function createProject(drive, rootName, namingIn) {
  const naming = resolveNaming(namingIn);
  const root = await ensureFolder(drive, rootName);
  const projects = await listProjectFolders(drive, root.id, naming);
  const number = nextProjectNumber(
    projects.map((b) => b.name),
    naming.projectTemplate,
    naming.firstProjectNumber
  );
  const created = await ensureFolder(drive, projectFolderName(naming.projectTemplate, number), root.id);
  return {
    id: created.id,
    name: created.name,
    number: parseProjectNumber(naming.projectTemplate, created.name),
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

/** Has this client been delivered before, in ANY project? Two things want the
    answer: the typo guard (a name reused from an old project is the likeliest
    kind of typo) and the revision offer (for everyone who does have repeat
    clients, a hit means "this is v2"). The root itself is searched too, for
    folders delivered before projects existed.

    Returns nextRevision so the CALLER can fix the number before delivering.
    Resolving it inside deliver would make a retry after a partial failure
    create v3 next to the v2 it had already made. */
export async function checkClientFolder(drive, rootName, clientName, namingIn) {
  const naming = resolveNaming(namingIn);
  const miss = { exists: false, projectName: null, nextRevision: null };
  const root = await findFolder(drive, rootName);
  if (!root) return miss;
  const name = cleanName(clientName);
  const projects = await listProjectFolders(drive, root.id, naming);
  const byId = new Map(projects.map((b) => [b.id, b.name]));

  for (const chunk of chunked([root.id, ...projects.map((b) => b.id)], PARENT_CHUNK)) {
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
      const subs = await drive.files.list({
        q: `'${hit.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
        fields: 'files(name)',
        pageSize: 200,
      });
      return {
        exists: true,
        projectName: parent ? byId.get(parent) : null,
        nextRevision: nextRevisionNumber(
          (subs.data.files || []).map((f) => f.name),
          naming.revisionTemplate
        ),
      };
    }
  }
  return miss;
}

/**
 * The whole delivery in one call:
 *   folders -> sprite -> gif -> share -> link
 *
 * opts = {
 *   rootName, stagingName,
 *   naming,                          // the templates every name here comes from
 *   projectName,                       // "Project 3": resolved by name, so a project
 *                                    // deleted in Drive is simply recreated
 *   projectNumber,
 *   stagingId,                       // where the staged file currently lives
 *   sprite: { kind:'drive', id, name } | { kind:'local', bytes:Buffer, name },
 *   clientName,
 *   gifBytes: Buffer,
 *   gifName,                         // what he dragged in, for {name}/{ext}
 *   revision,                        // 2, 3, ... to deliver into a revision
 *                                    // subfolder; null/absent for a first delivery
 * }
 * onStep(step) fires as each phase starts.
 */
export async function deliver(drive, opts, onStep) {
  const naming = resolveNaming(opts.naming);
  const clientName = cleanName(opts.clientName);
  const base = {
    clientName,
    projectName: opts.projectName,
    projectNumber: opts.projectNumber ?? parseProjectNumber(naming.projectTemplate, opts.projectName),
  };
  // each file's own name feeds {name}/{ext}, so the two templates can differ
  const targetSprite = applyTemplate(
    naming.stagedTemplate,
    templateVars({ ...base, fileName: opts.sprite.name })
  );
  const targetGif = applyTemplate(
    naming.attachedTemplate,
    templateVars({ ...base, fileName: opts.gifName })
  );
  const notices = [];

  onStep('folders');
  const root = await ensureFolder(drive, opts.rootName);
  const project = await ensureFolder(drive, opts.projectName, root.id);
  const clientFolder = await ensureFolder(drive, clientName, project.id);

  /* Files go into a revision subfolder when one was asked for, but the CLIENT
     folder is still what gets shared, so the link he already sent this client
     keeps working and simply gains the new revision. */
  const revisionName = opts.revision
    ? revisionFolderName(naming.revisionTemplate, opts.revision)
    : null;
  const destFolder = revisionName
    ? await ensureFolder(drive, revisionName, clientFolder.id)
    : clientFolder;

  if (revisionName) {
    notices.push(`Delivered as ${revisionName} inside the existing "${clientName}" folder.`);
  } else if (clientFolder.existed) {
    notices.push(
      `Folder "${clientName}" already existed in ${project.name}. Files were added into it.`
    );
  }

  onStep('sprite');
  const existingSprite = await findChildByName(drive, destFolder.id, targetSprite);
  if (opts.sprite.kind === 'drive') {
    if (existingSprite && existingSprite.id === opts.sprite.id) {
      // retry of a partially-completed run: the move already happened
    } else {
      try {
        await drive.files.update({
          fileId: opts.sprite.id,
          addParents: destFolder.id,
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
    const media = { mimeType: mimeForName(targetSprite), body: Readable.from(opts.sprite.bytes) };
    if (existingSprite) {
      await drive.files.update({ fileId: existingSprite.id, media, fields: 'id' });
    } else {
      await drive.files.create({
        requestBody: { name: targetSprite, parents: [destFolder.id] },
        media,
        fields: 'id',
      });
    }
  }

  onStep('gif');
  const gifMedia = { mimeType: mimeForName(targetGif), body: Readable.from(opts.gifBytes) };
  const existingGif = await findChildByName(drive, destFolder.id, targetGif);
  if (existingGif) {
    await drive.files.update({ fileId: existingGif.id, media: gifMedia, fields: 'id' });
    notices.push(`${targetGif} already existed. Its contents were replaced.`);
  } else {
    await drive.files.create({
      requestBody: { name: targetGif, parents: [destFolder.id] },
      media: gifMedia,
      fields: 'id',
    });
  }

  // the CLIENT folder is shared, never the project folder: one client's link must
  // not expose the rest of the project
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
    projectName: project.name,
    revisionName,
    spriteName: targetSprite,
    gifName: targetGif,
    notices,
  };
}
