// Actual PCM inspection; no browser or codec mock and no external tools required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SOUND_FILES } from '../../src/features/sound.ts';

const base = new URL('../../public/sounds/banana-split-lubed/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
function wav(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const part = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(part.length, size);
    if (kind === 'fmt ') format = { codec: part.readUInt16LE(0), channels: part.readUInt16LE(2), rate: part.readUInt32LE(4), width: part.readUInt16LE(14) / 8 };
    if (kind === 'data') pcm = part;
    offset += 8 + size + (size % 2);
  }
  assert.ok(format && pcm);
  assert.equal(format.codec, 1, 'uncompressed signed integer PCM');
  assert.equal(pcm.length % format.width, 0);
  const samples = Array.from({ length: pcm.length / format.width }, (_, index) => pcm.readIntLE(index * format.width, format.width) / 2 ** (format.width * 8 - 1));
  return { ...format, samples, frames: samples.length / format.channels };
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(new Set(Object.values(SOUND_FILES)).size, 7);
const report = {};
for (const name of new Set(Object.values(SOUND_FILES))) {
  const originalBytes = readFileSync(new URL(`originals/${name}`, base)), clipBytes = readFileSync(new URL(`clips/${name}`, base));
  const meta = manifest.clips[name], original = wav(originalBytes), clip = wav(clipBytes);
  assert.equal(hash(originalBytes), meta.sourceSha256);
  assert.equal(hash(clipBytes), meta.sha256);
  assert.equal(original.width, 4); assert.equal(clip.width, 2);
  assert.equal(clip.frames, original.frames, 'whole supplied recording is retained');
  assert.equal(clip.rate, original.rate); assert.equal(clip.channels, original.channels);
  assert.equal(clip.frames, meta.frames); assert.equal(clip.rate, meta.sampleRate);
  const peak = Math.max(...clip.samples.map(Math.abs));
  const rms = Math.sqrt(clip.samples.reduce((sum, sample) => sum + sample ** 2, 0) / clip.samples.length);
  assert.ok(peak >= 0.899 && peak < 0.901, `${name}: normalized peak without clipping`);
  assert.ok(rms > 0.035, `${name}: non-silent waveform`);
  for (let index = 0; index < clip.samples.length; index++) {
    assert.ok(Math.abs(clip.samples[index] - original.samples[index] * meta.gain * 32767 / 32768) < 1 / 32768, `${name}: same waveform after normalization`);
  }
  report[name] = { seconds: Number((clip.frames / clip.rate).toFixed(4)), peak: Number(peak.toFixed(4)), rmsDb: Number((20 * Math.log10(rms)).toFixed(1)) };
}
console.log(JSON.stringify(report, null, 2));
console.log('PASS: all seven original hashes, PCM16 compatibility, complete waveforms, normalization and signal levels.');
const previewMeta = manifest.preview;
const previewBytes = readFileSync(new URL(previewMeta.file, base)), preview = wav(previewBytes);
assert.equal(hash(previewBytes), previewMeta.sha256);
assert.equal(preview.width, 2); assert.equal(preview.channels, 1); assert.equal(preview.rate, 44100);
assert.equal(preview.frames, previewMeta.frames);
assert.ok(preview.frames / preview.rate >= 4, 'native preview must have a visible multi-second timeline');
assert.equal(previewMeta.segments.length, 7);
let cursor = 0;
for (const segment of previewMeta.segments) {
  const clip = wav(readFileSync(new URL(`clips/${segment.file}`, base)));
  assert.equal(segment.frames, clip.frames);
  for (; cursor < segment.startFrame; cursor++) assert.equal(preview.samples[cursor], 0, 'gaps are silence');
  assert.deepEqual(preview.samples.slice(cursor, cursor + segment.frames), clip.samples, `${segment.file}: preview uses the unchanged click waveform`);
  cursor += segment.frames;
}
for (; cursor < preview.frames; cursor++) assert.equal(preview.samples[cursor], 0, 'output tail is silence');
console.log(`PASS: ${Math.round(preview.frames / preview.rate * 1000)} ms listening preview retains all seven exact waveforms with silence between clicks.`);
