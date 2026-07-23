/* The local-folder backend, driven against a real temp directory.

   It touches no Electron and no network, so unlike the Drive backend it can be
   tested for real rather than mocked: every assertion below is about files that
   genuinely exist on disk afterwards. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkClientFolder,
  createProject,
  deliver,
  discardStaged,
  getDrive,
  getFileBytes,
  listProjects,
  listStaging,
} from '../src/main/storage-local.js';
import { DEFAULT_NAMING } from '../src/main/naming.mjs';

const ROOT_NAME = 'Commissions';
const STAGING = 'Sprite Staging';
const SPRITE_BYTES = Buffer.from('a pretend png', 'utf8');
const GIF_BYTES = Buffer.from('a pretend gif', 'utf8');

async function freshHandle() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sendoff-local-'));
  return getDrive(dir);
}

/** Put a file in staging the way the tablet (or a sync client) would. */
async function stage(handle, name = 'aiko_final.png') {
  const dir = path.join(handle.dir, STAGING);
  await fs.mkdir(dir, { recursive: true });
  const full = path.join(dir, name);
  await fs.writeFile(full, SPRITE_BYTES);
  return full;
}

const deliverOpts = (extra = {}) => ({
  rootName: ROOT_NAME,
  stagingName: STAGING,
  naming: DEFAULT_NAMING,
  projectName: 'Batch 5',
  projectNumber: 5,
  clientName: 'Aiko',
  gifBytes: GIF_BYTES,
  gifName: 'ezgif-out.gif',
  ...extra,
});

const noop = () => {};

test('staging lists what is actually in the folder', async () => {
  const handle = await freshHandle();
  assert.deepEqual((await listStaging(handle, STAGING)).files, []);
  await stage(handle);
  const listing = await listStaging(handle, STAGING);
  assert.equal(listing.files.length, 1);
  assert.equal(listing.files[0].name, 'aiko_final.png');
  assert.equal(listing.files[0].mimeType, 'image/png');
  assert.equal(Number(listing.files[0].size), SPRITE_BYTES.length);
});

test('a project folder is created and then listed back', async () => {
  const handle = await freshHandle();
  const created = await createProject(handle, ROOT_NAME, DEFAULT_NAMING);
  // the default naming starts at 5, and the folder really exists
  assert.equal(created.name, 'Batch 5');
  assert.ok(fsSync.existsSync(path.join(handle.dir, ROOT_NAME, 'Batch 5')));
  const listed = await listProjects(handle, ROOT_NAME, DEFAULT_NAMING);
  assert.equal(listed.projects.length, 1);
  assert.equal(listed.nextName, 'Batch 6');
});

test('folders that do not match the template are not listed as projects', async () => {
  const handle = await freshHandle();
  await fs.mkdir(path.join(handle.dir, ROOT_NAME, 'Invoices'), { recursive: true });
  const listed = await listProjects(handle, ROOT_NAME, DEFAULT_NAMING);
  assert.deepEqual(listed.projects, []);
  assert.equal(listed.nextName, 'Batch 5');
});

test('a delivery puts both renamed files on disk and empties staging', async () => {
  const handle = await freshHandle();
  const staged = await stage(handle);
  const result = await deliver(
    handle,
    deliverOpts({ sprite: { kind: 'drive', id: staged, name: 'aiko_final.png' } }),
    noop
  );

  const clientDir = path.join(handle.dir, ROOT_NAME, 'Batch 5', 'Aiko');
  assert.equal(result.folderName, 'Aiko');
  assert.equal(result.link, clientDir);
  assert.equal(result.isPath, true);
  assert.equal(result.spriteName, 'Aiko_sprite.png');
  assert.equal(result.gifName, 'bouncy.gif');

  assert.deepEqual(await fs.readFile(path.join(clientDir, 'Aiko_sprite.png')), SPRITE_BYTES);
  assert.deepEqual(await fs.readFile(path.join(clientDir, 'bouncy.gif')), GIF_BYTES);
  // moved, not copied: it cannot be picked up a second time
  assert.equal(fsSync.existsSync(staged), false);
  assert.deepEqual((await listStaging(handle, STAGING)).files, []);
});

test('a local pick is written from bytes rather than moved', async () => {
  const handle = await freshHandle();
  await deliver(
    handle,
    deliverOpts({ sprite: { kind: 'local', name: 'from-disk.png', bytes: SPRITE_BYTES } }),
    noop
  );
  const clientDir = path.join(handle.dir, ROOT_NAME, 'Batch 5', 'Aiko');
  assert.deepEqual(await fs.readFile(path.join(clientDir, 'Aiko_sprite.png')), SPRITE_BYTES);
});

test('no half-written file is ever left wearing the final name', async () => {
  const handle = await freshHandle();
  await deliver(
    handle,
    deliverOpts({ sprite: { kind: 'local', name: 'x.png', bytes: SPRITE_BYTES } }),
    noop
  );
  const clientDir = path.join(handle.dir, ROOT_NAME, 'Batch 5', 'Aiko');
  const left = await fs.readdir(clientDir);
  assert.deepEqual(left.filter((f) => f.endsWith('.sendoff-part')), []);
});

test('retrying a delivery whose move already happened is not an error', async () => {
  const handle = await freshHandle();
  const staged = await stage(handle);
  const opts = deliverOpts({ sprite: { kind: 'drive', id: staged, name: 'aiko_final.png' } });
  await deliver(handle, opts, noop);
  // the staged file is gone now; the same call again is a Retry after a partial
  // failure and must land on its feet rather than throw
  const again = await deliver(handle, opts, noop);
  assert.equal(again.folderName, 'Aiko');
  const clientDir = path.join(handle.dir, ROOT_NAME, 'Batch 5', 'Aiko');
  assert.deepEqual(await fs.readFile(path.join(clientDir, 'Aiko_sprite.png')), SPRITE_BYTES);
});

test('a staged file that vanished with nothing delivered is a real error', async () => {
  const handle = await freshHandle();
  await assert.rejects(() =>
    deliver(
      handle,
      deliverOpts({
        sprite: { kind: 'drive', id: path.join(handle.dir, STAGING, 'ghost.png'), name: 'ghost.png' },
      }),
      noop
    )
  );
});

test('an existing client is found, with the revision that comes next', async () => {
  const handle = await freshHandle();
  assert.deepEqual(await checkClientFolder(handle, ROOT_NAME, 'Aiko', DEFAULT_NAMING), {
    exists: false,
    projectName: null,
    nextRevision: null,
  });

  await deliver(
    handle,
    deliverOpts({ sprite: { kind: 'local', name: 'a.png', bytes: SPRITE_BYTES } }),
    noop
  );
  const found = await checkClientFolder(handle, ROOT_NAME, 'Aiko', DEFAULT_NAMING);
  assert.equal(found.exists, true);
  assert.equal(found.projectName, 'Batch 5');
  assert.equal(found.nextRevision, 2);
});

test('a revision lands in a subfolder and leaves the first delivery alone', async () => {
  const handle = await freshHandle();
  const first = deliverOpts({ sprite: { kind: 'local', name: 'a.png', bytes: SPRITE_BYTES } });
  await deliver(handle, first, noop);

  const v2Bytes = Buffer.from('the revised png', 'utf8');
  const result = await deliver(
    handle,
    deliverOpts({
      sprite: { kind: 'local', name: 'a.png', bytes: v2Bytes },
      revision: 2,
    }),
    noop
  );

  const clientDir = path.join(handle.dir, ROOT_NAME, 'Batch 5', 'Aiko');
  assert.equal(result.revisionName, 'v2');
  // the shared thing is still the CLIENT folder, so the old link keeps working
  assert.equal(result.link, clientDir);
  // v1 is untouched
  assert.deepEqual(await fs.readFile(path.join(clientDir, 'Aiko_sprite.png')), SPRITE_BYTES);
  // and v2 sits beside it, same file name, no collision possible
  assert.deepEqual(await fs.readFile(path.join(clientDir, 'v2', 'Aiko_sprite.png')), v2Bytes);

  const after = await checkClientFolder(handle, ROOT_NAME, 'Aiko', DEFAULT_NAMING);
  assert.equal(after.nextRevision, 3);
});

test('revision subfolders are never mistaken for client folders', async () => {
  const handle = await freshHandle();
  await deliver(
    handle,
    deliverOpts({ sprite: { kind: 'local', name: 'a.png', bytes: SPRITE_BYTES } }),
    noop
  );
  await deliver(
    handle,
    deliverOpts({ sprite: { kind: 'local', name: 'a.png', bytes: SPRITE_BYTES }, revision: 2 }),
    noop
  );
  // "v2" lives inside Aiko, not in the project, so it is not a client
  const listed = await listProjects(handle, ROOT_NAME, DEFAULT_NAMING);
  assert.equal(listed.projects[0].clients, 1);
});

test('discarding a staged file is recoverable, never a delete', async () => {
  const handle = await freshHandle();
  const staged = await stage(handle);
  await discardStaged(handle, staged);

  assert.equal(fsSync.existsSync(staged), false);
  assert.deepEqual((await listStaging(handle, STAGING)).files, []);

  // it is in the trash, whole, exactly like Drive's 30-day trash
  const trash = await fs.readdir(path.join(handle.dir, '.sendoff-trash'));
  assert.equal(trash.length, 1);
  assert.ok(trash[0].endsWith('aiko_final.png'));
  assert.deepEqual(
    await fs.readFile(path.join(handle.dir, '.sendoff-trash', trash[0])),
    SPRITE_BYTES
  );
});

test('discarding twice does not overwrite what is already in the trash', async () => {
  const handle = await freshHandle();
  await discardStaged(handle, await stage(handle, 'same.png'));
  await new Promise((r) => setTimeout(r, 5));
  await discardStaged(handle, await stage(handle, 'same.png'));
  const trash = await fs.readdir(path.join(handle.dir, '.sendoff-trash'));
  assert.equal(trash.length, 2);
});

test('the trash folder is never offered as a project', async () => {
  const handle = await freshHandle();
  await fs.mkdir(path.join(handle.dir, ROOT_NAME, '.sendoff-trash'), { recursive: true });
  const listed = await listProjects(handle, ROOT_NAME, DEFAULT_NAMING);
  assert.deepEqual(listed.projects, []);
});

test('bytes come back for the light table preview', async () => {
  const handle = await freshHandle();
  const staged = await stage(handle);
  assert.deepEqual(await getFileBytes(handle, staged), SPRITE_BYTES);
});

test('no folder chosen is a clear error, not a crash', () => {
  assert.throws(() => getDrive(''), /folder/i);
});
