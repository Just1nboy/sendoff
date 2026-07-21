import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_BATCH_NUMBER,
  GIF_FILE_NAME,
  batchFolderName,
  cleanClientName,
  nextBatchNumber,
  parseBatchNumber,
  spriteFileName,
} from '../src/main/naming.mjs';

test('gif name is always the literal bouncy.gif', () => {
  assert.equal(GIF_FILE_NAME, 'bouncy.gif');
});

test('sprite name follows {ClientName}_sprite.png', () => {
  assert.equal(spriteFileName('Aiko'), 'Aiko_sprite.png');
});

test('client name keeps its case exactly as typed', () => {
  assert.equal(spriteFileName('mochaLatte'), 'mochaLatte_sprite.png');
});

test('whitespace is trimmed and collapsed', () => {
  assert.equal(cleanClientName('  Aiko   Tanaka '), 'Aiko Tanaka');
});

test('path separators cannot leak into names', () => {
  assert.equal(cleanClientName('Ai/ko\\chan'), 'Ai-ko-chan');
});

test('empty or whitespace-only names are rejected', () => {
  assert.throws(() => cleanClientName('   '));
  assert.throws(() => cleanClientName(''));
  assert.throws(() => cleanClientName(null));
});

test('batches are named Batch 1, Batch 2, and so on', () => {
  assert.equal(batchFolderName(1), 'Batch 1');
  assert.equal(batchFolderName(12), 'Batch 12');
});

test('a batch folder name round-trips to its number', () => {
  assert.equal(parseBatchNumber('Batch 3'), 3);
  assert.equal(parseBatchNumber(batchFolderName(41)), 41);
});

test('folders that are not batches are ignored, never renumbered', () => {
  for (const name of ['Commissions', 'Batch', 'batch 2', 'Batch 2 old', 'Batch 0', 'Batch x']) {
    assert.equal(parseBatchNumber(name), null, name);
  }
});

test('the very first batch continues his hand-numbered count, at Batch 5', () => {
  assert.equal(FIRST_BATCH_NUMBER, 5);
  assert.equal(nextBatchNumber([]), 5);
  assert.equal(nextBatchNumber(['Sprite Staging', 'random folder']), 5);
});

test('a new batch takes the next number after the highest', () => {
  assert.equal(nextBatchNumber(['Batch 5', 'Batch 6']), 7);
  assert.equal(nextBatchNumber(['Batch 6', 'Batch 5']), 7);
});

test('deleting a batch does not hand its number to the next one', () => {
  // Batch 6 deleted: the next batch is still 8, so old links stay unambiguous
  assert.equal(nextBatchNumber(['Batch 5', 'Batch 7']), 8);
});

test('a batch below the starting number still counts up from itself', () => {
  // if he ever makes a Batch 2 by hand inside the app's tree, don't jump back to 5
  assert.equal(nextBatchNumber(['Batch 2']), 3);
});
