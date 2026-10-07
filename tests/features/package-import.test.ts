import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImportFile, isAnkiPackage, importResultMessage } from '../../src/features/packageImport.ts';

test('Anki packages route away from the UTF-8 vocabulary parser regardless of MIME', () => {
  assert.equal(isAnkiPackage('DAY01.APKG'), true);
  assert.equal(isAnkiPackage('collection.colpkg'), true);
  assert.equal(isAnkiPackage('words.csv'), false);
  assert.equal(isAnkiPackage('words.apkg.zip'), false);
});

test('file selection accepts supported packages and text up to 128 MiB', () => {
  for (const name of ['day.apkg', 'DAY.APKG', 'backup.colpkg', 'words.csv', 'words.tsv', 'words.txt']) {
    assert.equal(validateImportFile({ name, size: 128 * 1024 * 1024 }), '');
  }
});

test('invalid, empty and oversized files are rejected before any upload', () => {
  for (const file of [{ name: 'deck.zip', size: 20 }, { name: 'empty.apkg', size: 0 },
    { name: 'huge.apkg', size: 128 * 1024 * 1024 + 1 }]) {
    assert.ok(validateImportFile(file));
  }
});

test('result includes newly added notes/cards and explains zero additions without calling it failure', () => {
  const first = importResultMessage({ message: '완료', added: 480, cardsAdded: 480 });
  assert.match(first, /노트 480개/);
  assert.match(first, /카드 480개/);
  const repeat = importResultMessage({ message: '완료', added: 0, cardsAdded: 0 });
  assert.match(repeat, /새로 추가된 노트가 없/);
  assert.match(repeat, /기존/);
});

test('result remains compatible with a backend that only returns added', () => {
  assert.match(importResultMessage({ message: '완료', added: 3 }), /노트 3개/);
  assert.doesNotMatch(importResultMessage({ message: '완료', added: 3 }), /undefined/);
  assert.equal(importResultMessage({ message: '컬렉션 복원 완료' }), '컬렉션 복원 완료');
});
