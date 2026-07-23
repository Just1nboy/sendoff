/* A folder on this computer, as a delivery target.

   Same function shapes as drive.js, so index.js can swap between them without
   knowing which is in use. This is a real backend, not a mock: files genuinely
   land on disk, and it is what makes Sendoff runnable with no Google account, no
   Cloud project and no OAuth client at all.

   What it deliberately does NOT do is share. There is no link to hand a client,
   so `deliver` returns the folder's path and the UI offers to open it. Point the
   base folder at a synced one (Drive, Dropbox, OneDrive) and that folder is
   shareable by whatever already syncs it, which is also how the tablet's files
   can still reach the staging folder without Sendoff talking to any API. */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
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

/* Where a discarded file goes. Never a real delete: the whole point of the X on
   the light table is that hitting it by mistake costs a trip to this folder
   rather than the artwork itself. Mirrors Drive's trash. */
const TRASH_DIR = '.sendoff-trash';

let baseDir = null;

/** Point every operation below at `dir`. Called once per resolve, from index.js. */
export function getDrive(dir) {
  if (!dir) {
    const err = new Error('No delivery folder is set. Pick one in settings.');
    err.code = 400;
    throw err;
  }
  baseDir = dir;
  return { local: true, dir };
}

const rootPath = (handle, rootName) => path.join(handle.dir, rootName);

async function ensureDir(dir) {
  const existed = fsSync.existsSync(dir);
  await fs.mkdir(dir, { recursive: true });
  return { id: dir, name: path.basename(dir), existed };
}

/** Directory entries that are folders, by name. Missing parent reads as empty. */
async function subfolders(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name !== TRASH_DIR).map((e) => e.name);
  } catch {
    return [];
  }
}

async function statOf(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/* ---------- projects ---------- */

async function projectList(handle, rootName, naming) {
  const root = rootPath(handle, rootName);
  const names = await subfolders(root);
  const out = [];
  for (const name of names) {
    const number = parseProjectNumber(naming.projectTemplate, name);
    if (number === null) continue;
    const dir = path.join(root, name);
    const stat = await statOf(dir);
    out.push({
      id: dir,
      name,
      number,
      createdTime: stat ? stat.birthtime.toISOString() : new Date().toISOString(),
      clients: (await subfolders(dir)).length,
    });
  }
  return out.sort((a, b) => b.number - a.number);
}

export async function listProjects(handle, rootName, namingIn) {
  const naming = resolveNaming(namingIn);
  await ensureDir(rootPath(handle, rootName));
  const projects = await projectList(handle, rootName, naming);
  const next = nextProjectNumber(
    projects.map((p) => p.name),
    naming.projectTemplate,
    naming.firstProjectNumber
  );
  return {
    rootId: rootPath(handle, rootName),
    nextNumber: next,
    nextName: projectFolderName(naming.projectTemplate, next),
    projects,
  };
}

export async function createProject(handle, rootName, namingIn) {
  const naming = resolveNaming(namingIn);
  const projects = await projectList(handle, rootName, naming);
  const number = nextProjectNumber(
    projects.map((p) => p.name),
    naming.projectTemplate,
    naming.firstProjectNumber
  );
  const name = projectFolderName(naming.projectTemplate, number);
  const created = await ensureDir(path.join(rootPath(handle, rootName), name));
  return {
    id: created.id,
    name,
    number,
    clients: 0,
    createdTime: new Date().toISOString(),
  };
}

/* ---------- staging ---------- */

const EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export async function listStaging(handle, stagingName) {
  const dir = path.join(handle.dir, stagingName);
  await fs.mkdir(dir, { recursive: true });
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { stagingId: dir, files: [] };
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const stat = await statOf(full);
    if (!stat) continue;
    files.push({
      id: full,
      name: entry.name,
      size: String(stat.size),
      modifiedTime: stat.mtime.toISOString(),
      mimeType: EXT_MIME[path.extname(entry.name).toLowerCase()] || 'application/octet-stream',
    });
  }
  return {
    stagingId: dir,
    files: files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime)),
  };
}

// wire key shared with the deployed tablet (see drive.js) — keep in sync
export const SEEN_KEY = 'nekuSeen';

/* Drive stamps staged files so the tablet can tell they were picked up. A local
   folder has no second surface polling it, so there is nothing to tell. */
export async function markStagedSeen() {
  return [];
}

/** Move to .sendoff-trash rather than unlink: recoverable, like Drive's trash. */
export async function discardStaged(handle, fileId) {
  const trash = path.join(handle.dir, TRASH_DIR);
  await fs.mkdir(trash, { recursive: true });
  // a name already in the trash must not silently replace what is there
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.rename(fileId, path.join(trash, `${stamp}_${path.basename(fileId)}`));
  return { id: fileId };
}

export async function getFileBytes(_handle, fileId) {
  return fs.readFile(fileId);
}

/* ---------- clients ---------- */

export async function checkClientFolder(handle, rootName, clientName, namingIn) {
  const naming = resolveNaming(namingIn);
  const miss = { exists: false, projectName: null, nextRevision: null };
  const root = rootPath(handle, rootName);
  if (!fsSync.existsSync(root)) return miss;
  const name = cleanName(clientName);
  const lower = name.toLowerCase();

  // every project, plus the root itself for folders made before projects existed
  const projects = await projectList(handle, rootName, naming);
  const places = [{ name: null, dir: root }, ...projects.map((p) => ({ name: p.name, dir: p.id }))];

  for (const place of places) {
    const hit = (await subfolders(place.dir)).find((f) => f.toLowerCase() === lower);
    if (!hit) continue;
    const clientDir = path.join(place.dir, hit);
    return {
      exists: true,
      projectName: place.name,
      nextRevision: nextRevisionNumber(await subfolders(clientDir), naming.revisionTemplate),
    };
  }
  return miss;
}

/* ---------- deliver ---------- */

/** Write bytes only once the whole file is there, so a crash mid-write cannot
    leave a half-file wearing the final name. */
async function writeFileAtomic(target, bytes) {
  const tmp = `${target}.sendoff-part`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, target);
}

/**
 * Same contract as drive.js deliver, and idempotent in the same way: a retry
 * after a partial failure re-checks what already happened instead of repeating
 * it. See drive.js for the option shape.
 */
export async function deliver(handle, opts, onStep) {
  const naming = resolveNaming(opts.naming);
  const clientName = cleanName(opts.clientName);
  const base = {
    clientName,
    projectName: opts.projectName,
    projectNumber:
      opts.projectNumber ?? parseProjectNumber(naming.projectTemplate, opts.projectName),
  };
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
  const root = await ensureDir(rootPath(handle, opts.rootName));
  const project = await ensureDir(path.join(root.id, opts.projectName));
  const clientFolder = await ensureDir(path.join(project.id, clientName));

  const revisionName = opts.revision
    ? revisionFolderName(naming.revisionTemplate, opts.revision)
    : null;
  const destFolder = revisionName
    ? await ensureDir(path.join(clientFolder.id, revisionName))
    : clientFolder;

  if (revisionName) {
    notices.push(`Delivered as ${revisionName} inside the existing "${clientName}" folder.`);
  } else if (clientFolder.existed) {
    notices.push(
      `Folder "${clientName}" already existed in ${opts.projectName}. Files were added into it.`
    );
  }

  onStep('sprite');
  const spriteTarget = path.join(destFolder.id, targetSprite);
  if (opts.sprite.kind === 'drive') {
    // "drive" here means "already in staging": moved, not copied, so it cannot
    // be picked up twice and there is no window where it exists in both places
    if (fsSync.existsSync(opts.sprite.id)) {
      await fs.rename(opts.sprite.id, spriteTarget);
    } else if (!fsSync.existsSync(spriteTarget)) {
      throw new Error(`The staged file is no longer in ${path.dirname(opts.sprite.id)}.`);
    }
    // neither branch is an error when the target is already there: that is a
    // retry of a run whose move had already gone through
  } else {
    await writeFileAtomic(spriteTarget, Buffer.from(opts.sprite.bytes));
  }

  onStep('gif');
  const gifTarget = path.join(destFolder.id, targetGif);
  if (fsSync.existsSync(gifTarget)) {
    notices.push(`${targetGif} already existed. Its contents were replaced.`);
  }
  await writeFileAtomic(gifTarget, Buffer.from(opts.gifBytes));

  /* No sharing step: a folder on this computer has no link. Kept as a step so
     the progress the UI shows is the same five either way. */
  onStep('share');

  onStep('link');
  return {
    link: clientFolder.id,
    isPath: true, // the UI offers "open folder" instead of "open in Drive"
    folderName: clientName,
    projectName: project.name,
    revisionName,
    spriteName: targetSprite,
    gifName: targetGif,
    notices,
  };
}
