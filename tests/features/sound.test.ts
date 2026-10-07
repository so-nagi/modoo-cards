import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSoundPreferences, SOUND_FILES, soundUrl, type SoundAction } from '../../src/features/sound.ts';

test('sound preferences preserve mute, clamp volume and recover corrupt values', () => {
  assert.deepEqual(normalizeSoundPreferences({ enabled: false, volume: 0.7 }), { enabled: false, volume: 0.7 });
  assert.deepEqual(normalizeSoundPreferences({ enabled: true, volume: 10 }), { enabled: true, volume: 1 });
  assert.deepEqual(normalizeSoundPreferences({ enabled: false, volume: -1 }), { enabled: false, volume: 0 });
  assert.deepEqual(normalizeSoundPreferences({ volume: NaN }), { enabled: true, volume: 0.35 });
  assert.deepEqual(normalizeSoundPreferences(null), { enabled: true, volume: 0.35 });
});

test('all nine actions distribute the seven supplied WAVs and four ratings remain distinct', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/sounds/banana-split-lubed/manifest.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(SOUND_FILES).length, 9);
  assert.equal(new Set(Object.values(SOUND_FILES)).size, 7);
  assert.equal(new Set(['again', 'hard', 'good', 'easy'].map(action => SOUND_FILES[action as SoundAction])).size, 4);
  for (const [action, filename] of Object.entries(SOUND_FILES)) {
    assert.ok(manifest.clips[filename]);
    assert.equal(soundUrl(action as SoundAction), `/sounds/banana-split-lubed/clips/${filename}`);
  }
});


