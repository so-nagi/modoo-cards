import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorSettings, retrySettingsMirror, SETTINGS_SYNC_WARNING } from '../../src/settingsMirror.ts';
import { SessionBoundary } from '../../src/session.ts';

const saved = { skin: 'classic', theme: 'light', cardFontSize: 28 };

test('cloud rejection reports a warning without rejecting or altering the saved server settings', async () => {
  const warnings: string[] = [];
  const snapshot = { ...saved };
  const synced = await mirrorSettings(snapshot, {
    assertCurrent() {},
    async write(settings) { assert.deepEqual(settings, saved); throw new Error('permission-denied'); },
    notify: warning => { warnings.push(warning); },
  });
  assert.equal(synced, false);
  assert.deepEqual(snapshot, saved);
  assert.deepEqual(warnings, [SETTINGS_SYNC_WARNING]);
});

test('retry reads current server settings and writes them before clearing the warning', async () => {
  const events: unknown[] = [];
  const latest = { ...saved, skin: 'classic', cardFontSize: 32 };
  const synced = await retrySettingsMirror(async () => { events.push('read'); return latest; }, {
    assertCurrent() {},
    async write(settings) { events.push(['write', settings]); },
    notify: warning => { events.push(['notice', warning]); },
  });
  assert.equal(synced, true);
  assert.deepEqual(events, ['read', ['write', latest], ['notice', '']]);
});

test('failed retry keeps its warning and a later successful mirror clears it', async () => {
  const warnings: string[] = [];
  let unavailable = true;
  const boundary = {
    assertCurrent() {},
    async write() { if (unavailable) throw new Error('offline'); },
    notify: (warning: string) => { warnings.push(warning); },
  };
  assert.equal(await retrySettingsMirror(async () => saved, boundary), false);
  assert.deepEqual(warnings, [SETTINGS_SYNC_WARNING]);
  unavailable = false;
  assert.equal(await mirrorSettings(saved, boundary), true);
  assert.deepEqual(warnings, [SETTINGS_SYNC_WARNING, '']);
});

test('a failed server read does not write a stale snapshot or clear the warning', async () => {
  const events: string[] = [];
  await assert.rejects(retrySettingsMirror(async () => { throw new Error('server disconnected'); }, {
    assertCurrent() {},
    async write() { events.push('write'); },
    notify: warning => { events.push(warning); },
  }), /server disconnected/);
  assert.deepEqual(events, []);
});

test('account switch during the server read cancels retry before writing another account', async () => {
  const session = new SessionBoundary(); session.set('alice');
  const generation = session.capture();
  const events: string[] = [];
  await assert.rejects(retrySettingsMirror(async () => { session.set('bob'); return saved; }, {
    assertCurrent: () => session.assertCurrent(generation),
    async write() { events.push('write'); },
    notify: warning => { events.push(warning); },
  }), /계정이 변경/);
  assert.deepEqual(events, []);
});

test('account switch during either cloud success or failure cannot update the new account notice', async () => {
  for (const fails of [false, true]) {
    const session = new SessionBoundary(); session.set('alice');
    const generation = session.capture();
    const warnings: string[] = [];
    await assert.rejects(mirrorSettings(saved, {
      assertCurrent: () => session.assertCurrent(generation),
      async write() { session.set('bob'); if (fails) throw new Error('permission-denied'); },
      notify: warning => { warnings.push(warning); },
    }), /계정이 변경/);
    assert.deepEqual(warnings, []);
  }
});

test('timed out mirror warns once and its late completion cannot clear the warning', async () => {
  let finish!: () => void;
  const write = new Promise<void>(resolve => { finish = resolve; });
  const warnings: string[] = [];
  assert.equal(await mirrorSettings(saved, {
    assertCurrent() {},
    write: () => write,
    notify: warning => { warnings.push(warning); },
  }, 5), false);
  finish(); await write; await Promise.resolve();
  assert.deepEqual(warnings, [SETTINGS_SYNC_WARNING]);
});
