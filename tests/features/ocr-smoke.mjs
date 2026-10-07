// Explicit integration check (not part of the quick unit suite).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { pairOcrWords, wordsFromTesseract } from '../../src/features/vocabulary.ts';
const worker = await createWorker(['kor', 'eng'], OEM.LSTM_ONLY, {
  langPath: fileURLToPath(new URL('../../public/ocr/', import.meta.url)),
  gzip: false, cacheMethod: 'none',
});
try {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(fileURLToPath(new URL('./ocr-fixture.png', import.meta.url)), {}, { text: true, blocks: true });
  const rows = pairOcrWords(wordsFromTesseract(data));
  console.log(JSON.stringify({ engineConfidence: data.confidence, rows: rows.map(({ word, meaning, confidence }) => ({ word, meaning, confidence })) }, null, 2));
  const byWord = new Map(rows.map(row => [row.word.toLowerCase(), row.meaning]));
  for (const [word, meaning] of [['apple', '사과'], ['banana', '바나나'], ['carry', '나르다, 휴대하다'], ['house', '집'], ['look after', '돌보다'], ['tree', '나무']]) assert.equal(byWord.get(word), meaning, word);
  assert.equal(rows.length, 6);
  console.log('PASS: actual local English/Korean OCR and spatial pairing matched all six fixture pairs.');
} finally { await worker.terminate(); }
