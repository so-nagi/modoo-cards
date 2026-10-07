import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionBoundary, safeApiPath } from '../../src/session.ts';

test('changing account invalidates in-flight responses', () => {
  const boundary = new SessionBoundary();
  boundary.set('alice');
  const request = boundary.capture();
  boundary.set('bob');
  assert.throws(() => boundary.assertCurrent(request), /계정/);
});
test('refreshing the same account token does not invalidate its pending request', () => {
  const boundary = new SessionBoundary();
  boundary.set('alice');
  const request = boundary.capture();
  boundary.set('alice');
  assert.doesNotThrow(() => boundary.assertCurrent(request));
});
test('API helper only accepts own origin relative API paths', () => {
  for (const path of ['https://evil.invalid/', '//evil.invalid', '/\\evil', '/%2e%2e/admin']) {
    assert.throws(() => safeApiPath(path));
  }
  assert.equal(safeApiPath('/cards?q=deck%3AEnglish'), '/api/cards?q=deck%3AEnglish');
});
