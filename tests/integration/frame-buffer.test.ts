import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelFrame, createFrameBuffer, finishFrame, stageFrame } from '../../src/components/frameBuffer.ts';

const document = (revision: number, contentKey = String(revision)) => ({
  revision, contentKey, documentHtml: `<p>card ${revision}</p>`, title: '카드',
});
const visible = (state: ReturnType<typeof createFrameBuffer>) => state.active === null ? null : state.slots[state.active]?.revision;

test('the previous answer remains visible until the next document is ready', () => {
  const first = finishFrame(stageFrame(createFrameBuffer(), document(1)), 1);
  const waiting = stageFrame(first, document(2));
  assert.equal(visible(waiting), 1);
  assert.equal(waiting.slots.filter(Boolean).length, 2);
  const ready = finishFrame(waiting, 2);
  assert.equal(visible(ready), 2);
  assert.equal(ready.slots.filter(Boolean).length, 1);
  assert.equal(ready.pending, null);
});

test('stale readiness cannot switch to an abandoned card or answer side', () => {
  const first = finishFrame(stageFrame(createFrameBuffer(), document(1)), 1);
  const replaced = stageFrame(stageFrame(first, document(2)), document(3));
  assert.equal(finishFrame(replaced, 2), replaced);
  assert.equal(visible(replaced), 1);
  assert.equal(visible(finishFrame(replaced, 3)), 3);
});

test('failed preparation preserves the current document and allows retry', () => {
  const first = finishFrame(stageFrame(createFrameBuffer(), document(1)), 1);
  const failed = cancelFrame(stageFrame(first, document(2)), 2);
  assert.equal(visible(failed), 1);
  assert.equal(failed.slots.filter(Boolean).length, 1);
  assert.equal(visible(finishFrame(stageFrame(failed, document(3)), 3)), 3);
});

test('repeated grading and front/back swaps never produce an empty active slot', () => {
  let state = finishFrame(stageFrame(createFrameBuffer(), document(1)), 1);
  for (let revision = 2; revision <= 100; revision++) {
    const before = visible(state);
    state = stageFrame(state, document(revision, revision % 2 ? 'question' : 'answer'));
    assert.equal(visible(state), before);
    state = finishFrame(state, revision);
    assert.equal(visible(state), revision);
    assert.equal(state.slots.filter(Boolean).length, 1);
  }
});

test('new account/component starts with no document from the previous instance', () => {
  const prior = finishFrame(stageFrame(createFrameBuffer(), document(1)), 1);
  const next = createFrameBuffer();
  assert.equal(visible(prior), 1);
  assert.equal(visible(next), null);
  assert.deepEqual(next.slots, [null, null]);
});
