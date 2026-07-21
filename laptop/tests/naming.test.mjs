import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NAMING,
  PRESETS,
  applyTemplate,
  cleanName,
  matchPreset,
  nextProjectNumber,
  nextRevisionNumber,
  parseProjectNumber,
  parseRevisionNumber,
  presetById,
  projectFolderName,
  resolveNaming,
  revisionFolderName,
  splitFileName,
  templateVars,
  today,
  validateNaming,
  validateProjectTemplate,
} from '../src/main/naming.mjs';

/* ---------- the template engine ---------- */

test('a template with no tokens is used literally', () => {
  assert.equal(applyTemplate('bouncy.gif', {}), 'bouncy.gif');
});

test('tokens are substituted', () => {
  assert.equal(applyTemplate('{client}_sprite.png', { client: 'Aiko' }), 'Aiko_sprite.png');
  assert.equal(
    applyTemplate('{client}_{date}{ext}', { client: 'Aiko', date: '2026-07-21', ext: '.jpg' }),
    'Aiko_2026-07-21.jpg'
  );
});

test('an unknown token is left visible rather than silently blanked', () => {
  // a typo has to show up in the preview, not quietly produce "_sprite.png"
  assert.equal(applyTemplate('{cleint}_sprite.png', { client: 'Aiko' }), '{cleint}_sprite.png');
});

test('characters Windows rejects cannot reach a file name', () => {
  assert.equal(applyTemplate('{client}_sprite.png', { client: 'Ai:k?o' }), 'Aiko_sprite.png');
});

test('a template that fills in to nothing is rejected', () => {
  assert.throws(() => applyTemplate('{client}', { client: '' }));
  assert.throws(() => applyTemplate('   ', {}));
});

test('a file name splits into its name and extension', () => {
  assert.deepEqual(splitFileName('aiko_final_v2.png'), { name: 'aiko_final_v2', ext: '.png' });
  assert.deepEqual(splitFileName('archive.tar.gz'), { name: 'archive.tar', ext: '.gz' });
  assert.deepEqual(splitFileName('noext'), { name: 'noext', ext: '' });
  // a leading dot is the name, not an extension
  assert.deepEqual(splitFileName('.gitignore'), { name: '.gitignore', ext: '' });
});

test('template vars carry the original file name through', () => {
  const vars = templateVars({
    clientName: 'Aiko',
    projectName: 'Batch 5',
    projectNumber: 5,
    fileName: 'sketch.PNG',
  });
  assert.equal(vars.client, 'Aiko');
  assert.equal(vars.project, 'Batch 5');
  assert.equal(vars.n, 5);
  assert.equal(vars.name, 'sketch');
  assert.equal(vars.ext, '.PNG');
});

test('the date token is the local day, zero padded', () => {
  assert.equal(today(new Date(2026, 6, 5)), '2026-07-05');
});

/* ---------- client names ---------- */

test('client name keeps its case exactly as typed', () => {
  assert.equal(cleanName('mochaLatte'), 'mochaLatte');
});

test('whitespace is trimmed and collapsed', () => {
  assert.equal(cleanName('  Aiko   Tanaka '), 'Aiko Tanaka');
});

test('path separators cannot leak into names', () => {
  assert.equal(cleanName('Ai/ko\\chan'), 'Ai-ko-chan');
});

test('empty or whitespace-only names are rejected', () => {
  assert.throws(() => cleanName('   '));
  assert.throws(() => cleanName(''));
  assert.throws(() => cleanName(null));
});

/* ---------- project folders ---------- */

test('a project folder is its template with the number filled in', () => {
  assert.equal(projectFolderName('Batch {n}', 1), 'Batch 1');
  assert.equal(projectFolderName('Batch {n}', 12), 'Batch 12');
  assert.equal(projectFolderName('Shoot {n}', 3), 'Shoot 3');
  assert.equal(projectFolderName('{n} - commissions', 4), '4 - commissions');
});

test('a project folder name round-trips to its number', () => {
  assert.equal(parseProjectNumber('Batch {n}', 'Batch 3'), 3);
  assert.equal(parseProjectNumber('Batch {n}', projectFolderName('Batch {n}', 41)), 41);
  assert.equal(parseProjectNumber('Shoot {n}', 'Shoot 9'), 9);
});

test('folders that do not match the template are ignored, never renumbered', () => {
  for (const name of ['Commissions', 'Batch', 'batch 2', 'Batch 2 old', 'Batch 0', 'Batch x']) {
    assert.equal(parseProjectNumber('Batch {n}', name), null, name);
  }
  // and a folder from a different template is not mistaken for one of ours
  assert.equal(parseProjectNumber('Shoot {n}', 'Batch 5'), null);
});

test('regex characters in a template are matched literally', () => {
  assert.equal(parseProjectNumber('Batch ({n})', 'Batch (7)'), 7);
  assert.equal(parseProjectNumber('Batch ({n})', 'Batch x7y'), null);
});

test('a new project takes the next number after the highest', () => {
  assert.equal(nextProjectNumber(['Batch 5', 'Batch 6'], 'Batch {n}'), 7);
  assert.equal(nextProjectNumber(['Batch 6', 'Batch 5'], 'Batch {n}'), 7);
});

test('deleting a project does not hand its number to the next one', () => {
  // Batch 6 deleted: the next one is still 8, so old links stay unambiguous
  assert.equal(nextProjectNumber(['Batch 5', 'Batch 7'], 'Batch {n}'), 8);
});

test('the first project uses the configured starting number', () => {
  assert.equal(nextProjectNumber([], 'Batch {n}', 5), 5);
  assert.equal(nextProjectNumber(['Sprite Staging', 'random folder'], 'Batch {n}', 5), 5);
  assert.equal(nextProjectNumber([], 'Shoot {n}', 1), 1);
  // and it only applies while nothing exists yet
  assert.equal(nextProjectNumber(['Batch 2'], 'Batch {n}', 5), 3);
});

test('a project template must contain the number token', () => {
  assert.equal(validateProjectTemplate('Batch {n}'), null);
  assert.match(validateProjectTemplate('Batch'), /\{n\}/);
  assert.match(validateProjectTemplate(''), /empty/i);
});

/* ---------- presets ---------- */

/* ---------- revisions ---------- */

test('a revision folder is its template with the number filled in', () => {
  assert.equal(revisionFolderName('v{n}', 2), 'v2');
  assert.equal(revisionFolderName('revision {n}', 3), 'revision 3');
});

test('the first revision is 2, because the client folder itself is v1', () => {
  assert.equal(nextRevisionNumber([], 'v{n}'), 2);
  assert.equal(nextRevisionNumber(['notes', 'refs'], 'v{n}'), 2);
});

test('revisions count up from the highest that exists', () => {
  assert.equal(nextRevisionNumber(['v2'], 'v{n}'), 3);
  assert.equal(nextRevisionNumber(['v3', 'v2'], 'v{n}'), 4);
  // a deleted v3 does not hand its number back, same rule as projects
  assert.equal(nextRevisionNumber(['v2', 'v4'], 'v{n}'), 5);
});

test('folders in the client folder that are not revisions are ignored', () => {
  assert.equal(parseRevisionNumber('v{n}', 'v2'), 2);
  for (const name of ['refs', 'V2', 'v', 'v0', 'v2 old']) {
    assert.equal(parseRevisionNumber('v{n}', name), null, name);
  }
});

test('a revision template must contain the number token', () => {
  assert.ok(validateNaming({ ...DEFAULT_NAMING, revisionTemplate: 'final' }).revisionTemplate);
  assert.equal(validateNaming({ ...DEFAULT_NAMING, revisionTemplate: 'v{n}' }), null);
});

test('the default naming is the setup Neku shipped with', () => {
  // an existing install must not change behaviour just because templates exist
  assert.equal(DEFAULT_NAMING.projectTemplate, 'Batch {n}');
  assert.equal(DEFAULT_NAMING.firstProjectNumber, 5);
  assert.equal(DEFAULT_NAMING.stagedTemplate, '{client}_sprite.png');
  assert.equal(DEFAULT_NAMING.attachedTemplate, 'bouncy.gif');
});

test('the default preset reproduces the original hardcoded names exactly', () => {
  const vars = templateVars({
    clientName: 'Aiko',
    projectName: projectFolderName(DEFAULT_NAMING.projectTemplate, 5),
    projectNumber: 5,
    fileName: 'aiko_final_v2.png',
  });
  assert.equal(applyTemplate(DEFAULT_NAMING.stagedTemplate, vars), 'Aiko_sprite.png');
  assert.equal(applyTemplate(DEFAULT_NAMING.attachedTemplate, vars), 'bouncy.gif');
  assert.equal(projectFolderName(DEFAULT_NAMING.projectTemplate, 5), 'Batch 5');
  assert.equal(nextProjectNumber([], DEFAULT_NAMING.projectTemplate, DEFAULT_NAMING.firstProjectNumber), 5);
});

test('every preset is internally valid', () => {
  for (const preset of PRESETS) {
    assert.equal(validateNaming(preset.naming), null, preset.id);
    assert.equal(presetById(preset.id), preset);
  }
});

test('presets have distinct ids', () => {
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
});

test('a set of templates is matched back to its preset, and edits are not', () => {
  assert.equal(matchPreset(PRESETS[0].naming).id, 'sprite-commission');
  assert.equal(matchPreset(PRESETS[2].naming).id, 'photo');
  assert.equal(matchPreset({ ...PRESETS[0].naming, attachedTemplate: 'wiggly.gif' }), null);
  assert.equal(matchPreset(null), null);
});

test('a photographer gets photographer names from the same code path', () => {
  const naming = presetById('photo').naming;
  const vars = templateVars({
    clientName: 'Rivera Wedding',
    projectName: projectFolderName(naming.projectTemplate, 3),
    projectNumber: 3,
    fileName: 'DSC_0421.jpg',
    now: new Date(2026, 6, 21),
  });
  assert.equal(projectFolderName(naming.projectTemplate, 3), 'Shoot 3');
  assert.equal(applyTemplate(naming.stagedTemplate, vars), 'Rivera Wedding_2026-07-21.jpg');
});

test('partial or malformed settings resolve to a complete usable set', () => {
  assert.deepEqual(resolveNaming(null), DEFAULT_NAMING);
  assert.equal(resolveNaming({ firstProjectNumber: 0 }).firstProjectNumber, 1);
  assert.equal(resolveNaming({ firstProjectNumber: '7' }).firstProjectNumber, 7);
  assert.equal(resolveNaming({ stagedTemplate: 'x.png' }).attachedTemplate, 'bouncy.gif');
});

test('validation reports the field that is wrong', () => {
  assert.equal(validateNaming(DEFAULT_NAMING), null);
  assert.ok(validateNaming({ ...DEFAULT_NAMING, projectTemplate: 'Batch' }).projectTemplate);
  assert.ok(validateNaming({ ...DEFAULT_NAMING, stagedTemplate: '' }).stagedTemplate);
});
