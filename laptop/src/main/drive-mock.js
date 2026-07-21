/* In-memory stand-in for drive.js, active when NEKU_MOCK=1.
   Lets the whole UI flow run (staging list, preview, deliver, link) with no
   Google credentials. Same function shapes as drive.js. */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  applyTemplate,
  cleanName,
  nextProjectNumber,
  parseProjectNumber,
  presetById,
  projectFolderName,
  resolveNaming,
  templateVars,
} from './naming.mjs';

// 1x1 transparent png, in case resources/mock-sprite.png is missing
const FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/* NEKU_MOCK_EMPTY=1 wipes the seeded batch so the day-one screen
   ("no projects yet" -> Start Batch 5) can be driven and screenshotted. */
const EMPTY = process.env.NEKU_MOCK_EMPTY === '1';

/* The seeded batch has to be named by whatever naming is active, or a run under
   a different preset would start with a folder its own template cannot parse and
   the menu would look empty. NEKU_PRESET picks one; see index.js. */
const MOCK_NAMING = resolveNaming(
  (presetById(process.env.NEKU_PRESET || '') || {}).naming
);
const SEEDED_NUMBER = MOCK_NAMING.firstProjectNumber;
const SEEDED_NAME = projectFolderName(MOCK_NAMING.projectTemplate, SEEDED_NUMBER);

const state = {
  staged: [
    {
      id: 'mock-sprite-1',
      name: 'aiko_final_v2.png',
      mimeType: 'image/png',
      size: '18240',
      modifiedTime: new Date(Date.now() - 13 * 60 * 1000).toISOString(),
    },
  ],
  // one finished batch already on the shelf, so the batch menu has something to pick
  batches: EMPTY
    ? []
    : [
        {
          id: `mock-batch-${SEEDED_NUMBER}`,
          name: SEEDED_NAME,
          number: SEEDED_NUMBER,
          createdTime: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
  clientFolders: EMPTY ? [] : [{ name: 'OldClientFromMarch', batchName: SEEDED_NAME }],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function getDrive() {
  return { mock: true };
}

export async function listBatches(_drive, _rootName, namingIn) {
  await sleep(200);
  const naming = resolveNaming(namingIn);
  const names = state.batches.map((b) => b.name);
  const next = nextProjectNumber(names, naming.projectTemplate, naming.firstProjectNumber);
  return {
    rootId: 'mock-root',
    nextNumber: next,
    nextName: projectFolderName(naming.projectTemplate, next),
    batches: state.batches
      .map((b) => ({
        ...b,
        clients: state.clientFolders.filter((c) => c.batchName === b.name).length,
      }))
      .sort((a, b) => b.number - a.number),
  };
}

export async function createBatch(_drive, _rootName, namingIn) {
  await sleep(250);
  const naming = resolveNaming(namingIn);
  const number = nextProjectNumber(
    state.batches.map((b) => b.name),
    naming.projectTemplate,
    naming.firstProjectNumber
  );
  const batch = {
    id: `mock-batch-${number}`,
    name: projectFolderName(naming.projectTemplate, number),
    number,
    createdTime: new Date().toISOString(),
  };
  state.batches.push(batch);
  return { ...batch, clients: 0 };
}

export async function listStaging() {
  await sleep(250);
  return { stagingId: 'mock-staging', files: state.staged.map((f) => ({ ...f })) };
}

export const SEEN_KEY = 'nekuSeen';

export async function markStagedSeen(_drive, files) {
  const stamped = [];
  for (const file of files || []) {
    const live = state.staged.find((f) => f.id === file.id);
    if (!live || (live.appProperties && live.appProperties[SEEN_KEY])) continue;
    live.appProperties = { ...(live.appProperties || {}), [SEEN_KEY]: new Date().toISOString() };
    stamped.push(live.id);
  }
  return stamped;
}

/** Put a sprite back on the mock light table. Only the autopilot calls this: the
    "Remove" path destroys what it acts on, so it needs its own sprite rather
    than the one the rest of the run is delivering. */
export function seedStaged(file) {
  state.staged.push({
    mimeType: 'image/png',
    size: '18240',
    modifiedTime: new Date().toISOString(),
    ...file,
  });
  return file.id;
}

export async function discardStaged(_drive, fileId) {
  await sleep(200);
  state.staged = state.staged.filter((f) => f.id !== fileId);
  return { id: fileId };
}

export async function getFileBytes() {
  await sleep(150);
  try {
    return fs.readFileSync(path.join(app.getAppPath(), 'resources', 'mock-sprite.png'));
  } catch {
    return FALLBACK_PNG;
  }
}

export async function checkClientFolder(_drive, _rootName, clientName) {
  await sleep(200);
  const name = cleanName(clientName);
  // like the real one, this looks across every batch, not just the current one
  const hit = state.clientFolders.find((f) => f.name.toLowerCase() === name.toLowerCase());
  return { exists: Boolean(hit), batchName: hit ? hit.batchName : null };
}

export async function deliver(_drive, opts, onStep) {
  const naming = resolveNaming(opts.naming);
  const clientName = cleanName(opts.clientName);
  const batchName = opts.batchName;
  const base = {
    clientName,
    projectName: batchName,
    projectNumber: opts.batchNumber ?? parseProjectNumber(naming.projectTemplate, batchName),
  };
  for (const step of ['folders', 'sprite', 'gif', 'share', 'link']) {
    onStep(step);
    await sleep(450);
  }
  if (opts.sprite.kind === 'drive') {
    state.staged = state.staged.filter((f) => f.id !== opts.sprite.id);
  }
  const existed = state.clientFolders.some(
    (f) => f.name.toLowerCase() === clientName.toLowerCase() && f.batchName === batchName
  );
  if (!existed) state.clientFolders.push({ name: clientName, batchName });
  return {
    link: `https://drive.google.com/drive/folders/mock-${encodeURIComponent(clientName)}`,
    folderName: clientName,
    batchName,
    spriteName: applyTemplate(
      naming.stagedTemplate,
      templateVars({ ...base, fileName: opts.sprite.name })
    ),
    gifName: applyTemplate(
      naming.attachedTemplate,
      templateVars({ ...base, fileName: opts.gifName })
    ),
    notices: existed
      ? [`Folder "${clientName}" already existed in ${batchName}. Files were added into it.`]
      : [],
  };
}
