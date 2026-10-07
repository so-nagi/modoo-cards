import test from 'node:test';
import assert from 'node:assert/strict';

// Only the browser media boundary is simulated. Tests exercise the real controller.
async function harness(run: (sound: typeof import('../../src/features/sound.ts'), media: typeof Media, storage: Map<string, string>, browser: EventTarget) => Promise<void>) {
  const globals = ['window', 'localStorage', 'document'];
  const descriptors = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const storage = new Map<string, string>();
  class Media extends EventTarget {
    static all: Media[] = [];
    src: string; preload = ''; volume = 1; muted = false; paused = true; ended = false;
    currentTime = 0; duration = 0.2; error: { code: number } | null = null;
    readyState = 4; networkState = 1;
    hidden = false; isConnected = false; dataset: Record<string, string> = {};
    calls = 0; pauses = 0; loads = 0;
    resolve!: () => void; reject!: (error: Error) => void;
    constructor(src = '') { super(); this.src = src; Media.all.push(this); }
    load() { this.loads++; }
    play() { this.calls++; return new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
    pause() { this.pauses++; this.paused = true; }
    removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    remove() { this.isConnected = false; }
    start() { this.paused = false; this.dispatchEvent(new Event('playing')); }
    finish() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
  }
  const browser = Object.assign(new EventTarget(), { Audio: Media });
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => { assert.equal(tag, 'audio'); return new Media(); }, body: { append: (audio: Media) => { audio.isConnected = true; } } } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) } });
    const sound = await import(`../../src/features/sound.ts?native=${Math.random()}`);
    sound.setSoundPreferences({ enabled: true, volume: 0.4 });
    try { await run(sound, Media, storage, browser); } finally { sound.setSoundPreferences({ enabled: false, volume: 0.4 }); }
  } finally {
    globals.forEach((key, index) => descriptors[index] ? Object.defineProperty(globalThis, key, descriptors[index]!) : Reflect.deleteProperty(globalThis, key));
  }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('native play starts in the gesture, and reports playback only after promise plus media evidence', async () => harness(async (sound, Media) => {
  sound.playSound('save');
  assert.equal(Media.all.length, 1, 'uses native media instead of a Web Audio graph');
  const audio = Media.all[0];
  assert.equal(audio.isConnected, true, 'playback element is attached to the document like Voice Studio');
  assert.equal(audio.hidden, true);
  assert.equal(audio.src, '/sounds/banana-split-lubed/clips/banana-l-2.wav');
  assert.equal(audio.calls, 1, 'play() is called before the gesture callback returns');
  assert.equal(sound.getSoundDiagnostics().playCount, 0);
  audio.resolve(); await tick();
  assert.notEqual(sound.getSoundDiagnostics().phase, 'playing', 'resolved request alone is insufficient');
  audio.start();
  assert.equal(sound.getSoundDiagnostics().phase, 'playing');
  assert.equal(sound.getSoundDiagnostics().playCount, 1);
  audio.currentTime = 0.06; audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(sound.getSoundDiagnostics().currentTimeSeconds, 0.06);
  audio.finish();
  assert.equal(sound.getSoundDiagnostics().phase, 'ready');
  assert.equal(audio.currentTime, audio.duration, 'finished media is not seeked before its output tail can drain');
  assert.equal(audio.pauses, 0, 'the natural end must not be followed by an unnecessary pause');
  assert.equal(audio.src, sound.soundUrl('save'), 'ended media keeps its loaded source');
  assert.equal(audio.isConnected, true, 'the reusable pool retains its DOM element');
  sound.playSound('save');
  assert.equal(Media.all.length, 1, 'subsequent clicks reuse the already-played element');
  assert.equal(audio.calls, 2);
  assert.equal(audio.currentTime, 0, 'rewind is deferred until the next playback gesture');
}));

test('a media request without playback evidence times out with actionable media diagnostics', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await harness(async (sound, Media) => {
      sound.playSound('tap');
      const audio = Media.all[0]; audio.readyState = 1; audio.networkState = 2;
      context.mock.timers.tick(5001);
      const status = sound.getSoundDiagnostics();
      assert.equal(status.phase, 'error'); assert.equal(status.contextState, 'media-timeout');
      assert.equal(status.readyState, 1); assert.equal(status.networkState, 2);
      assert.equal(status.volume, 0.4); assert.equal(status.muted, false); assert.equal(status.mediaError, null);
      assert.equal(status.playCount, 0); assert.equal(audio.src, '');
      assert.equal(audio.isConnected, false, 'failed media does not leave hidden nodes behind');
      audio.resolve(); await tick();
      assert.equal(sound.getSoundDiagnostics().phase, 'error', 'a late promise must not hide the timeout');
    });
  } finally { context.mock.timers.reset(); }
});

test('confirmed playback clears the start deadline and cannot later turn into a timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await harness(async (sound, Media) => {
      sound.playSound('hard'); const audio = Media.all[0]; audio.start(); audio.resolve(); await tick();
      context.mock.timers.tick(6000);
      assert.equal(sound.getSoundDiagnostics().phase, 'playing');
      assert.equal(sound.getSoundDiagnostics().playCount, 1);
      assert.equal(audio.pauses, 0);
      audio.finish();
      assert.equal(sound.getSoundDiagnostics().phase, 'ready');
    });
  } finally { context.mock.timers.reset(); }
});

test('volume changes reach current media immediately and mute stops active and pending playback', async () => harness(async (sound, Media, storage) => {
  sound.playSound('tap'); const first = Media.all[0]; first.start(); first.resolve(); await tick();
  sound.playSound('good'); const pending = Media.all[1];
  sound.setSoundPreferences({ enabled: true, volume: 0.65 });
  assert.equal(first.volume, 0.65); assert.equal(pending.volume, 0.65);
  sound.setSoundPreferences({ enabled: true, volume: 0 });
  assert.ok(first.pauses > 0); assert.ok(pending.pauses > 0);
  assert.equal(sound.getSoundDiagnostics().phase, 'muted');
  pending.start(); pending.resolve(); await tick();
  assert.equal(sound.getSoundDiagnostics().playCount, 1, 'late pending events cannot restart or confirm a muted click');
  sound.playSound('easy'); assert.equal(Media.all.length, 2);
  assert.deepEqual(JSON.parse(storage.get('modoo-anki.sound.v1')!), { enabled: true, volume: 0 });
}));

test('a newer click discards an unstarted sound and rapid played clicks have at most six voices', async () => harness(async (sound, Media) => {
  sound.playSound('tap'); const old = Media.all[0];
  sound.playSound('save'); const newest = Media.all[1];
  assert.ok(old.pauses > 0); assert.equal(old.src, '');
  old.start(); old.resolve(); newest.start(); newest.resolve(); await tick();
  assert.equal(sound.getSoundDiagnostics().playCount, 1);
  for (let index = 0; index < 6; index++) { sound.playSound('good'); const audio = Media.all.at(-1)!; audio.start(); audio.resolve(); await tick(); }
  assert.equal(Media.all.filter(audio => audio.src && !audio.paused).length, 6);
  assert.equal(newest.src, '', 'oldest playing voice is released at the overlap limit');
}));

test('autoplay rejection is visible and the next gesture can retry', async () => harness(async (sound, Media) => {
  sound.playSound('save');
  Media.all[0].reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })); await tick();
  assert.equal(sound.getSoundDiagnostics().phase, 'blocked');
  assert.equal(sound.getSoundDiagnostics().playCount, 0);
  assert.equal(Media.all[0].src, '');
  sound.playSound('save'); const retry = Media.all[1]; retry.start(); retry.resolve(); await tick();
  assert.equal(sound.getSoundDiagnostics().phase, 'playing');
  assert.equal(sound.getSoundDiagnostics().playCount, 1);
}));

test('prepare is silent and another tab cannot silently override app-authoritative settings', async () => harness(async (sound, Media, storage, browser) => {
  sound.prepareSound();
  assert.ok(Media.all.length > 0); assert.equal(Media.all.reduce((sum, audio) => sum + audio.calls, 0), 0);
  const count = Media.all.length; sound.prepareSound(); assert.equal(Media.all.length, count);
  storage.set('modoo-anki.sound.v1', JSON.stringify({ enabled: false, volume: 0 }));
  browser.dispatchEvent(Object.assign(new Event('storage'), { key: 'modoo-anki.sound.v1' }));
  assert.deepEqual(sound.getSoundPreferences(), { enabled: true, volume: 0.4 });
  sound.playSound('save'); assert.equal(Media.all.length, count, 'uses a preloaded media element');
}));

test('time advancement can confirm playback when the playing event was not observed', async () => harness(async (sound, Media) => {
  sound.playSound('reveal'); const audio = Media.all[0]; audio.resolve(); await tick();
  audio.paused = false; audio.currentTime = 0.04; audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(sound.getSoundDiagnostics().phase, 'playing');
  assert.equal(sound.getSoundDiagnostics().playCount, 1);
}));

test('button feedback plays once and preserves explicit navigation or rating sounds in the same gesture', async () => harness(async (sound, Media) => {
  const generic = sound.beginSoundGesture(); sound.finishSoundGesture(generic);
  assert.equal(Media.all.length, 1); assert.equal(Media.all[0].src, sound.soundUrl('tap'));
  Media.all[0].start(); Media.all[0].resolve(); await tick(); Media.all[0].finish();
  const navigation = sound.beginSoundGesture(); sound.playSound('navigate'); sound.finishSoundGesture(navigation);
  assert.equal(Media.all.length, 2); assert.equal(Media.all[1].src, sound.soundUrl('navigate'));
  Media.all[1].start(); Media.all[1].resolve(); await tick(); Media.all[1].finish();
  const rating = sound.beginSoundGesture(); sound.playSound('hard'); sound.finishSoundGesture(rating);
  assert.equal(Media.all.length, 3); assert.equal(Media.all[2].src, sound.soundUrl('hard'));
  assert.equal(Media.all.reduce((sum, audio) => sum + audio.calls, 0), 3);
}));
