import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeVocabularyFile, parseVocabularyFile } from '../../src/features/vocabularyFile.ts';
import { createPhotoImportSession, remainingAfterImport } from '../../src/features/photoImportSession.ts';

test('UTF-8 BOM TSV skips its Korean header and preserves every meaning', () => {
  const rows = parseVocabularyFile('\uFEFF단어\t한글 뜻\r\ncarry\t나르다, 휴대하다; 지니다\r\n\r\nlook after\t돌보다\r\n', 'words.tsv');
  assert.deepEqual(rows.map(({ word, meaning, selected }) => ({ word, meaning, selected })), [
    { word: 'carry', meaning: '나르다, 휴대하다; 지니다', selected: true },
    { word: 'look after', meaning: '돌보다', selected: true },
  ]);
});

test('CSV quotes protect commas, escaped quotes and multiline meanings', () => {
  const rows = parseVocabularyFile('word,meaning,example\r\ncarry,"나르다, 휴대하다\r\n지니다","She said ""carry it""."\r\n', 'words.csv');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].word, 'carry');
  assert.equal(rows[0].meaning, '나르다, 휴대하다\n지니다\n\n예문: She said "carry it".');
});

test('TSV quotes preserve tabs and headerless files retain their first word', () => {
  const rows = parseVocabularyFile('apple\t사과\nlook after\t"돌보다\t보살피다"', 'words.TSV');
  assert.deepEqual(rows.map(row => row.word), ['apple', 'look after']);
  assert.equal(rows[1].meaning, '돌보다\t보살피다');
});

test('recognized headers can reorder columns and optional examples stay on the back', () => {
  const rows = parseVocabularyFile('예문\t한글 뜻\t단어\nI look after him.\t돌보다\tlook after', 'words.tsv');
  assert.equal(rows[0].word, 'look after');
  assert.equal(rows[0].meaning, '돌보다\n\n예문: I look after him.');
});

test('duplicates stay visible but unchecked; distinct meanings and incomplete rows survive', () => {
  const rows = parseVocabularyFile('word\tmeaning\napple\t사과\n Apple \t사과\napple\t사과나무\nunfinished\t\n\t뜻만 있음\n\t', 'words.tsv');
  assert.deepEqual(rows.map(row => row.selected), [true, false, true, false, false]);
  assert.equal(rows[1].duplicate, true);
  assert.equal(rows[3].word, 'unfinished');
  assert.equal(rows[4].meaning, '뜻만 있음');
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
});

test('invalid quoting and extra columns fail instead of silently dropping data', () => {
  assert.throws(() => parseVocabularyFile('word,meaning\napple,"사과', 'words.csv'), /따옴표/);
  assert.throws(() => parseVocabularyFile('word,meaning\napple,"사과"oops', 'words.csv'), /따옴표/);
  assert.throws(() => parseVocabularyFile('word,meaning\ncarry,나르다,휴대하다', 'words.csv'), /열|따옴표/);
  assert.throws(() => parseVocabularyFile('word\tmeaning\ncarry\t나르다\t예문\t메모', 'words.tsv'), /열/);
});

test('empty, unseparated, binary, unsupported and oversized input report an error', () => {
  assert.throws(() => parseVocabularyFile('word\tmeaning\n\n', 'words.tsv'), /단어/);
  assert.throws(() => parseVocabularyFile('apple 사과', 'words.tsv'), /탭|열/);
  assert.throws(() => parseVocabularyFile('apple\t사과\0', 'words.tsv'), /파일/);
  assert.throws(() => parseVocabularyFile('apple\t사과', 'words.apkg'), /TSV|CSV/);
  assert.throws(() => parseVocabularyFile('apple\t사과\n'.repeat(2001), 'words.tsv'), /2,000|2000/);
  assert.throws(() => decodeVocabularyFile(new ArrayBuffer(5 * 1024 * 1024 + 1)), /5MB/);
});

test('UTF-8 decoder preserves Korean and rejects broken or legacy encodings', () => {
  const bytes = new TextEncoder().encode('\uFEFF단어\t한글 뜻\napple\t사과');
  assert.equal(decodeVocabularyFile(bytes.buffer), '단어\t한글 뜻\napple\t사과');
  assert.throws(() => decodeVocabularyFile(Uint8Array.from([0xff, 0xfe, 0x00]).buffer), /UTF-8/);
});

test('file preview uses existing submission lock and only removes selected successful rows', async () => {
  const rows = parseVocabularyFile('word\tmeaning\napple\t사과\napple\t사과\nbanana\t바나나', 'words.tsv');
  rows[2].selected = false;
  let payload: { word: string; meaning: string }[] = [];
  const result = await createPhotoImportSession().submit(rows, async selected => { payload = selected; });
  assert.deepEqual(payload, [{ word: 'apple', meaning: '사과' }]);
  assert.deepEqual(remainingAfterImport(rows, result!.submittedIds).map(row => row.word), ['apple', 'banana']);
});

test('downloadable sample is real UTF-8 TSV and opens as three selected cards', async () => {
  const file = await readFile(new URL('../../samples/sample-vocabulary.tsv', import.meta.url));
  const rows = parseVocabularyFile(decodeVocabularyFile(Uint8Array.from(file).buffer), 'sample-vocabulary.tsv');
  assert.deepEqual(rows.map(row => [row.word, row.meaning, row.selected]), [
    ['apple', '사과', true], ['carry', '나르다, 휴대하다; 지니다', true], ['look after', '돌보다, 보살피다', true],
  ]);
});
