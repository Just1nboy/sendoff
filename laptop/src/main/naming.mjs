/* Naming templates: the single source for every name Neku writes into Drive.

   Nothing here is specific to one kind of work. A sprite artist's
   "{client}_sprite.png" and a photographer's "{client}_{date}{ext}" are the same
   code path with different strings, so generalising the app is a matter of
   changing settings rather than changing this file.

   Drive ends up as:  {rootName}/{project}/{client}/{staged file}
                                                   /{attached file}
   where {project} is itself a template, e.g. "Batch {n}" or "Shoot {n}".

   PRESETS are prefilled sets of these templates. PRESETS[0] is the setup Neku
   shipped with for its first user, and it is also the default, so an existing
   install keeps behaving exactly as it did before templates existed. */

/** Tokens usable in any template. Surfaced in the settings sheet as help. */
export const TOKENS = [
  { token: '{client}', help: 'the client name you typed' },
  { token: '{project}', help: 'the project folder, e.g. Batch 5' },
  { token: '{n}', help: 'the project number, e.g. 5' },
  { token: '{date}', help: "today's date, as 2026-07-21" },
  { token: '{name}', help: "the file's own name, without the extension" },
  { token: '{ext}', help: "the file's own extension, e.g. .png" },
];

const TOKEN_RE = /\{([a-z]+)\}/g;

/* Characters Windows and Drive both do better without. Applied to the finished
   name, not to the template, so a template may legitimately contain a slash-free
   separator of its own choosing. */
const ILLEGAL = /[\\/:*?"<>|]/g;

/** Trim, collapse runs of whitespace, and swap path separators for a dash.
    Throws if nothing is left: an empty client name means no folder to file under. */
export function cleanName(raw) {
  const name = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[/\\]/g, '-');
  if (!name) throw new Error('Client name is empty.');
  return name;
}

/** Today, as 2026-07-21. Local date, because that is the day he thinks he is in. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Split "aiko_final_v2.png" into { name: 'aiko_final_v2', ext: '.png' }. */
export function splitFileName(fileName) {
  const full = String(fileName ?? '').trim();
  const dot = full.lastIndexOf('.');
  // a leading dot is part of the name (".gitignore"), not an extension
  if (dot <= 0) return { name: full, ext: '' };
  return { name: full.slice(0, dot), ext: full.slice(dot) };
}

/**
 * Fill a template. Unknown tokens are left alone rather than blanked, so a typo
 * shows up in the preview as literal "{cleint}" instead of silently vanishing.
 *
 * vars = { client, project, n, date, name, ext }
 */
export function applyTemplate(template, vars = {}) {
  const filled = String(template ?? '').replace(TOKEN_RE, (whole, token) =>
    token in vars && vars[token] != null ? String(vars[token]) : whole
  );
  const out = filled.replace(ILLEGAL, '').replace(/\s+/g, ' ').trim();
  if (!out) throw new Error(`Template "${template}" produced an empty name.`);
  return out;
}

/** The variables every template gets, built once per delivery. */
export function templateVars({ clientName, projectName, projectNumber, fileName, now }) {
  const { name, ext } = splitFileName(fileName);
  return {
    client: clientName ?? '',
    project: projectName ?? '',
    n: projectNumber ?? '',
    date: today(now),
    name,
    ext,
  };
}

/* ---------- project folders ---------- */

/** A project template has to contain {n} or the app cannot number the next one. */
export function validateProjectTemplate(template) {
  const str = String(template ?? '').trim();
  if (!str) return 'Project folder name cannot be empty.';
  if (!str.includes('{n}')) return 'Project folder name must contain {n}, the project number.';
  try {
    applyTemplate(str, { n: 1 });
  } catch {
    return 'Project folder name produces an empty name.';
  }
  return null;
}

export function projectFolderName(template, number) {
  return applyTemplate(template, { n: number });
}

/* "Batch {n}" becomes /^Batch (\d+)$/. Tokens other than {n} match loosely,
   since only the number needs reading back out. */
function projectRegex(template) {
  const escaped = String(template ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\\\{n\\\}/g, '(\\d+)').replace(/\\\{[a-z]+\\\}/g, '.+');
  return new RegExp(`^${body}$`);
}

/** The number in "Batch 7", or null for any folder that isn't a project folder.
    Anything unparseable is ignored rather than renamed: folders made by hand
    inside the root are left alone. */
export function parseProjectNumber(template, folderName) {
  if (!String(template ?? '').includes('{n}')) return null;
  const match = projectRegex(template).exec(String(folderName ?? '').trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ---------- revisions ----------

   A repeat client is a revision, not a typo, for everyone except the artist Neku
   was built for. Revisions live in a subfolder of the client folder ("v2", "v3"),
   which means: no file name can ever collide, the client's shared link is still
   the one folder and keeps working, and the first delivery is untouched — it
   stays loose in the client folder exactly as it always was. v1 IS that first
   delivery, so revision numbering starts at 2. */

export function revisionFolderName(template, number) {
  return applyTemplate(template, { n: number });
}

export function parseRevisionNumber(template, folderName) {
  return parseProjectNumber(template, folderName);
}

/** The next revision to make inside a client folder, given what is already there. */
export function nextRevisionNumber(existingFolderNames, template) {
  let highest = 1; // the client folder itself is v1
  for (const name of existingFolderNames || []) {
    const n = parseRevisionNumber(template, name);
    if (n !== null && n > highest) highest = n;
  }
  return highest + 1;
}

/** Projects count up and never reuse a number, so a deleted "Batch 6" does not
    hand its name to the next one and old links stay unambiguous.
    firstNumber only applies when no project exists yet. */
export function nextProjectNumber(existingFolderNames, template, firstNumber = 1) {
  let highest = 0;
  for (const name of existingFolderNames || []) {
    const n = parseProjectNumber(template, name);
    if (n !== null && n > highest) highest = n;
  }
  const first = Number.isInteger(firstNumber) && firstNumber > 0 ? firstNumber : 1;
  return highest ? highest + 1 : first;
}

/* ---------- presets ---------- */

/* A preset is nothing but five strings. Adding a trade to this list is a data
   change, which is the whole point of templating the names. */
export const PRESETS = [
  {
    id: 'sprite-commission',
    name: 'Sprite commission',
    hint: 'A sprite off the tablet plus an animation. What Neku shipped with.',
    naming: {
      projectTemplate: 'Batch {n}',
      firstProjectNumber: 5,
      stagedTemplate: '{client}_sprite.png',
      attachedTemplate: 'bouncy.gif',
      revisionTemplate: 'v{n}',
    },
  },
  {
    id: 'illustration',
    name: 'Illustration commission',
    hint: 'A finished piece plus a high-resolution or alternate version.',
    naming: {
      projectTemplate: 'Batch {n}',
      firstProjectNumber: 1,
      stagedTemplate: '{client}_artwork{ext}',
      attachedTemplate: '{client}_final{ext}',
      revisionTemplate: 'v{n}',
    },
  },
  {
    id: 'photo',
    name: 'Photo delivery',
    hint: 'Dated shots, grouped by shoot.',
    naming: {
      projectTemplate: 'Shoot {n}',
      firstProjectNumber: 1,
      stagedTemplate: '{client}_{date}{ext}',
      attachedTemplate: '{client}_{date}_gallery{ext}',
      revisionTemplate: 'v{n}',
    },
  },
  {
    id: 'design',
    name: 'Design handoff',
    hint: 'A deliverable plus its source or spec file, grouped by job.',
    naming: {
      projectTemplate: 'Job {n}',
      firstProjectNumber: 1,
      stagedTemplate: '{client}_{name}{ext}',
      attachedTemplate: '{client}_source{ext}',
      revisionTemplate: 'v{n}',
    },
  },
];

/** The naming a fresh install starts from. Deliberately the first user's setup:
    an existing copy of Neku must not change behaviour when it updates. */
export const DEFAULT_NAMING = { ...PRESETS[0].naming };

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** Which preset a set of templates corresponds to, or null for a hand-edited one. */
export function matchPreset(naming) {
  if (!naming) return null;
  return (
    PRESETS.find((p) =>
      Object.keys(p.naming).every((k) => String(p.naming[k]) === String(naming[k]))
    ) || null
  );
}

/** Fill in anything missing, so a settings file written by an older version and
    a half-typed form both come out as a complete, usable set of templates. */
export function resolveNaming(partial) {
  const naming = { ...DEFAULT_NAMING, ...(partial || {}) };
  const first = Number(naming.firstProjectNumber);
  naming.firstProjectNumber = Number.isInteger(first) && first > 0 ? first : 1;
  return naming;
}

/** Every problem with a set of templates, keyed by field, or null if it is fine. */
export function validateNaming(partial) {
  const naming = resolveNaming(partial);
  const errors = {};
  const projectError = validateProjectTemplate(naming.projectTemplate);
  if (projectError) errors.projectTemplate = projectError;
  // same rule as projects: without {n} the app cannot count revisions
  if (!String(naming.revisionTemplate ?? '').includes('{n}')) {
    errors.revisionTemplate = 'Revision folder name must contain {n}, the revision number.';
  }
  for (const key of ['stagedTemplate', 'attachedTemplate']) {
    try {
      // a realistic set of values, so an all-token template is judged filled in
      applyTemplate(naming[key], templateVars({
        clientName: 'Client',
        projectName: 'Project 1',
        projectNumber: 1,
        fileName: 'file.png',
      }));
    } catch {
      errors[key] = 'This produces an empty file name.';
    }
  }
  return Object.keys(errors).length ? errors : null;
}
