import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { inspectAddon } from '../../src/features/addonInspector.ts';

test('desktop package metadata and dependencies are inspected without execution', () => {
  const archive = zipSync({
    'manifest.json': strToU8(JSON.stringify({ name: 'Review Heatmap', human_version: '1.0.0', package: 'review_heatmap' })),
    '__init__.py': strToU8('from aqt.qt import QWidget\nfrom anki import hooks\nraise RuntimeError("must never execute")'),
  });
  const result = inspectAddon(archive, 'heatmap.ankiaddon');
  assert.equal(result.name, 'Review Heatmap');
  assert.equal(result.version, '1.0.0');
  assert.equal(result.pythonFiles, 1);
  assert.equal(result.compatibility, 'desktop-only');
  assert.ok(result.dependencies.includes('Qt / PyQt'));
  assert.equal(result.equivalent, '학습 통계의 복습 히트맵');
});

test('packages without Python are never represented as installed or browser compatible', () => {
  const result = inspectAddon(zipSync({ 'script.js': strToU8('alert("not run")') }), 'unknown.ankiaddon');
  assert.equal(result.compatibility, 'unsupported');
  assert.equal(result.equivalent, null);
});

test('traversal paths and oversized declared expanded data are rejected', () => {
  assert.throws(() => inspectAddon(zipSync({ '../__init__.py': strToU8('pass') }), 'bad.ankiaddon'), /안전하지 않은/);
  const archive = zipSync({ 'image.bin': new Uint8Array(101 * 1024 * 1024) });
  assert.throws(() => inspectAddon(archive, 'huge.ankiaddon'), /너무 커서/);
});

test('malformed metadata stays a warning and script-like names remain plain data', () => {
  const result = inspectAddon(zipSync({ 'manifest.json': strToU8('{broken'), 'meta.json': strToU8('{"name":"<script>hello</script>"}'), '__init__.py': strToU8('pass') }), 'x.ankiaddon');
  assert.equal(result.name, '<script>hello</script>');
  assert.equal(result.warnings.length, 1);
});
