// Optional browser QA fixture; uses the existing workspace canvas runtime.
import { createCanvas } from '../../../sentence-studio/node_modules/@napi-rs/canvas/index.js';
import { writeFileSync } from 'node:fs';
const canvas = createCanvas(1500, 600);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1500, 600);
ctx.fillStyle = '#111'; ctx.font = '36px "Malgun Gothic"';
for (const [word, meaning, x, y] of [
  ['apple', '사과', 70, 100], ['banana', '바나나', 800, 100],
  ['carry', '나르다, 휴대하다', 70, 240], ['house', '집', 800, 240],
  ['look after', '돌보다', 70, 380], ['tree', '나무', 800, 380],
]) { ctx.fillText(word, x, y); ctx.fillText(meaning, x + 270, y); }
writeFileSync(new URL('./ocr-fixture.png', import.meta.url), canvas.toBuffer('image/png'));
console.log('Created tests/features/ocr-fixture.png (6 English/Korean pairs, 2 columns)');
