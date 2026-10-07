import test from 'node:test';
import assert from 'node:assert/strict';
import { pairOcrWords, parseVocabularyText, wordsFromTesseract, type OcrWord } from '../../src/features/vocabulary.ts';

function word(text: string, x: number, y = 0, width = 65, confidence = 94): OcrWord {
  return { text, confidence, bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 } };
}

test('pasted vocabulary preserves part-of-speech and all meanings', () => {
  const rows = parseVocabularyText('01. carry v. 나르다, 휴대하다; 지니다\nlook after 돌보다\n  보살피다\nunknown');
  assert.equal(rows[0].word, 'carry');
  assert.equal(rows[0].meaning, 'v. 나르다, 휴대하다; 지니다');
  assert.equal(rows[1].word, 'look after');
  assert.equal(rows[1].meaning, '돌보다\n보살피다');
  assert.equal(rows[2].meaning, '');
  assert.equal(rows[2].selected, false);
});

test('duplicates are visible but not selected, distinct meanings remain selectable', () => {
  const rows = parseVocabularyText('apple 사과\napple 사과\napple 사과나무');
  assert.deepEqual(rows.map(row => row.selected), [true, false, true]);
  assert.equal(rows[1].duplicate, true);
});

test('text fallback separates wide-spaced page columns', () => {
  const rows = parseVocabularyText('apple 사과    banana 바나나');
  assert.deepEqual(rows.map(({ word, meaning }) => ({ word, meaning })), [{ word: 'apple', meaning: '사과' }, { word: 'banana', meaning: '바나나' }]);
});

test('spatial pairing reconstructs two columns across shuffled OCR blocks', () => {
  const rows = pairOcrWords([
    word('banana', 400), word('바나나', 520), word('집', 120, 60), word('apple', 0), word('사과', 120),
    word('house', 0, 60), word('tree', 400, 60), word('나무', 520, 60),
  ]);
  assert.deepEqual(rows.map(({ word, meaning }) => ({ word, meaning })), [
    { word: 'apple', meaning: '사과' }, { word: 'banana', meaning: '바나나' }, { word: 'house', meaning: '집' }, { word: 'tree', meaning: '나무' },
  ]);
});

test('wrapped meanings attach to their own column without collapsing definitions', () => {
  const rows = pairOcrWords([
    word('carry', 0), word('나르다,', 120), word('bear', 400), word('견디다;', 520),
    word('휴대하다', 120, 28), word('지니다', 520, 28),
  ]);
  assert.equal(rows[0].meaning, '나르다,\n휴대하다');
  assert.equal(rows[1].meaning, '견디다;\n지니다');
});

test('Tesseract v6/v7 block hierarchy yields each word once', () => {
  const a = word('apple', 0);
  assert.deepEqual(wordsFromTesseract({ blocks: [{ paragraphs: [{ lines: [{ words: [a] }] }] }] }), [a]);
});

test('low-confidence and orphan definitions remain visible for correction', () => {
  const rows = pairOcrWords([word('사과', 140, 0, 65, 45)]);
  assert.equal(rows[0].word, '');
  assert.equal(rows[0].meaning, '사과');
  assert.equal(rows[0].selected, false);
  assert.equal(rows[0].confidence, 45);
});

test('separate Korean glyph tokens and low punctuation preserve the original definition', () => {
  const rows = pairOcrWords([word('carry', 0), word('나', 120, 0, 18), word('르', 144, 0, 18), word('다', 168, 0, 18),
    { text: ',', confidence: 90, bbox: { x0: 187, y0: 16, x1: 190, y1: 22 } },
    word('휴', 215, 0, 18), word('대', 238, 0, 18), word('하다', 260, 0, 40)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].meaning, '나르다, 휴대하다');
});

test('a misread definition cannot consume the adjacent established column', () => {
  const rows = pairOcrWords([word('apple', 0), word('사과', 120), word('banana', 400), word('바나나', 520),
    word('look', 0, 60, 40), word('after', 48, 60, 55), word('SHC', 120, 60), word('tree', 400, 60), word('나무', 520, 60)]);
  assert.equal(rows.length, 4);
  assert.equal(rows[2].selected, false);
  assert.equal(rows[3].word, 'tree');
  assert.equal(rows[3].meaning, '나무');
});
