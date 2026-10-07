import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore -- Node executes this dependency-free setup module directly.
import { setupFiles, writeSetup } from '../../scripts/setup-self-host.mjs';
const config = { apiKey: 'public-test-key', projectId: 'demo-cards-one', authDomain: 'demo-cards-one.firebaseapp.com', appId: '1:123:web:test' };
const database = 'https://demo-cards-one-default-rtdb.asia-southeast1.firebasedatabase.app';
test('fork setup uses only the supplied Firebase, API and source settings', () => {
  const files = setupFiles(config, database, 'https://cards.example.com', 'https://github.com/example/cards');
  assert.equal(JSON.parse(files['.firebaserc']).projects.default, config.projectId);
  assert.equal(JSON.parse(files['firebase.public.json']).apiKey, config.apiKey);
  assert.match(files['render.env'], /MODOO_LOCAL_AUTH=0/);
  assert.ok(files['render.env'].includes(database));
  assert.match(files['.env.production.local'], /VITE_API_ORIGIN=https:\/\/cards.example.com/);
});
test('setup rejects administrator credentials and cross-project or unsafe addresses', () => {
  for (const value of [{ ...config, private_key: 'test' }, { ...config, type: 'service_account' }, { ...config, projectId: 'your-project-id' }]) {
    assert.throws(() => setupFiles(value, database, 'https://cards.example.com', 'https://github.com/example/cards'));
  }
  for (const value of ['https://other-default-rtdb.firebaseio.com', database + '/accounts', database + '?auth=secret', 'http://demo-cards-one.firebaseio.com']) {
    assert.throws(() => setupFiles(config, value, 'https://cards.example.com', 'https://github.com/example/cards'));
  }
  assert.throws(() => setupFiles(config, database, 'https://user:secret@cards.example.com', 'https://github.com/example/cards'));
});
test('a changed configuration cannot partially overwrite existing setup files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'modoo-setup-'));
  try {
    writeFileSync(join(folder, 'render.env'), 'existing');
    const files = setupFiles(config, database, 'https://cards.example.com', 'https://github.com/example/cards');
    assert.throws(() => writeSetup(folder, files));
    assert.equal(readFileSync(join(folder, 'render.env'), 'utf8'), 'existing');
    assert.throws(() => readFileSync(join(folder, '.firebaserc')));
    writeSetup(folder, files, true);
    writeSetup(folder, files); // Repeat with identical configuration is safe.
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
