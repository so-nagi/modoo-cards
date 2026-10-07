import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoImportSession, remainingAfterImport } from '../../src/features/photoImportSession.ts';
import { parseVocabularyText } from '../../src/features/vocabulary.ts';

test('successful batch removes only submitted complete rows; unselected and unfinished work survives', async () => {
  const rows = parseVocabularyText('apple 사과\nbanana 바나나\nunfinished');
  rows[1].selected = false;
  const session = createPhotoImportSession();
  let payload: { word: string; meaning: string }[] = [];
  const result = await session.submit(rows, async selected => { payload = selected; });
  assert.deepEqual(payload, [{ word: 'apple', meaning: '사과' }]);
  assert.equal(result?.count, 1);
  const remaining = remainingAfterImport(rows, result!.submittedIds);
  assert.deepEqual(remaining.map(row => row.word), ['banana', 'unfinished']);
  assert.equal(await session.submit(remaining, async () => { assert.fail('no eligible rows'); }), null);
});

test('rapid repeated submit starts one request while pending and releases after success', async () => {
  const rows = parseVocabularyText('apple 사과');
  const session = createPhotoImportSession();
  let resolve!: () => void;
  let calls = 0;
  const send = async () => { calls++; await new Promise<void>(done => { resolve = done; }); };
  const first = session.submit(rows, send);
  assert.equal(session.submitting, true);
  assert.equal(await session.submit(rows, send), null);
  assert.equal(calls, 1);
  resolve();
  assert.equal((await first)?.count, 1);
  assert.equal(session.submitting, false);
});

test('failed import preserves input and permits retry', async () => {
  const rows = parseVocabularyText('apple 사과');
  const session = createPhotoImportSession();
  await assert.rejects(session.submit(rows, async () => { throw new Error('network'); }), /network/);
  assert.equal(session.submitting, false);
  assert.equal(rows[0].selected, true);
  assert.equal((await session.submit(rows, async () => {}))?.count, 1);
});
