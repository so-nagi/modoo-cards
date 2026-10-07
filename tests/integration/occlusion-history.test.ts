import assert from 'node:assert/strict';
import test from 'node:test';
import { commitOcclusionHistory, createOcclusionHistory, maskHistoryShortcut, redoOcclusionHistory, undoOcclusionHistory } from '../../src/components/occlusionHistory.ts';
import { groupMasks, moveMasks, resizeFromDrag, ungroupMasks, type OcclusionMask } from '../../src/components/occlusionGeometry.ts';

const a: OcclusionMask = { id: 'a', x: .1, y: .2, width: .2, height: .15 };
const b: OcclusionMask = { id: 'b', x: .6, y: .5, width: .2, height: .25 };
const image = { filename: 'original.png', imageUrl: '/media/original.png' };

test('draw, group, ungroup, move, resize and delete restore exact snapshots in both directions', () => {
  let history = createOcclusionHistory({ ...image, masks: [] });
  const states = [history.present];
  const commit = (masks: OcclusionMask[]) => { history = commitOcclusionHistory(history, { ...image, masks }); states.push(history.present); };
  commit([a]); commit([a, b]);
  commit(groupMasks(history.present.masks, ['a', 'b'], 'g1'));
  commit(ungroupMasks(history.present.masks, ['a']));
  commit(moveMasks(history.present.masks, ['a'], { x: .12, y: .03 }));
  const beforeResize = history.present.masks[0];
  commit([{ ...beforeResize, ...resizeFromDrag(beforeResize, 'se', { x: .4, y: .4 }, { x: .46, y: .49 }) }, b]);
  commit(history.present.masks.filter(mask => mask.id !== 'a'));
  assert.equal(history.past.length, 7);
  for (let index = states.length - 2; index >= 0; index--) { history = undoOcclusionHistory(history); assert.deepEqual(history.present, states[index]); }
  assert.equal(undoOcclusionHistory(history), history);
  for (let index = 1; index < states.length; index++) { history = redoOcclusionHistory(history); assert.deepEqual(history.present, states[index]); }
  assert.equal(redoOcclusionHistory(history), history);
});

test('many transient pointer positions commit as one step; cancelled and no-op gestures preserve redo', () => {
  const original = createOcclusionHistory({ ...image, masks: [a, b] });
  let transient = original.present.masks;
  for (let step = 1; step <= 100; step++) transient = moveMasks(original.present.masks, ['a'], { x: step / 1000, y: 0 });
  assert.equal(original.past.length, 0);
  const completed = commitOcclusionHistory(original, { ...image, masks: transient });
  assert.equal(completed.past.length, 1);
  const restored = undoOcclusionHistory(completed);
  assert.deepEqual(restored.present.masks, [a, b]);
  assert.equal(restored.future.length, 1);
  assert.equal(commitOcclusionHistory(restored, { ...image, masks: restored.present.masks.map(mask => ({ ...mask })) }), restored);
  assert.deepEqual(redoOcclusionHistory(restored).present.masks, transient);
});

test('new edit after undo clears the old redo branch', () => {
  const before = createOcclusionHistory({ ...image, masks: [] });
  const added = commitOcclusionHistory(before, { ...image, masks: [a] });
  const replaced = commitOcclusionHistory(undoOcclusionHistory(added), { ...image, masks: [b] });
  assert.equal(replaced.future.length, 0);
  assert.deepEqual(replaced.present.masks, [b]);
});

test('image crop or rotation and remapped masks undo together, and selecting a new image resets history', () => {
  const source = createOcclusionHistory({ ...image, masks: [{ ...a, groupId: 'group' }, { ...b, groupId: 'group' }] });
  const transformed = { filename: 'crop.png', imageUrl: '/media/crop.png', masks: [{ ...a, x: .3, groupId: 'group' }] };
  const result = commitOcclusionHistory(source, transformed);
  assert.equal(result.past.length, 1);
  assert.deepEqual(undoOcclusionHistory(result).present, source.present);
  assert.deepEqual(redoOcclusionHistory(undoOcclusionHistory(result)).present, transformed);
  const newImage = createOcclusionHistory({ filename: 'new.png', imageUrl: '/media/new.png', masks: [] });
  assert.equal(newImage.past.length, 0); assert.equal(newImage.future.length, 0);
  assert.equal(undoOcclusionHistory(newImage), newImage);
});

test('snapshot copies isolate saved history from later source mutations', () => {
  const incoming = { ...image, masks: [{ ...a }] };
  const history = createOcclusionHistory(incoming);
  incoming.masks[0].x = .8;
  assert.equal(history.present.masks[0].x, a.x);
  const next = { ...image, masks: [{ ...b }] }, committed = commitOcclusionHistory(history, next);
  next.masks[0].groupId = 'changed';
  assert.equal(committed.present.masks[0].groupId, undefined);
  assert.equal(committed.past[0].masks[0].x, a.x);
});

test('Windows and macOS undo/redo shortcuts do not consume plain typing', () => {
  assert.equal(maskHistoryShortcut('z', true, false, false), 'undo');
  assert.equal(maskHistoryShortcut('Z', false, true, false), 'undo');
  assert.equal(maskHistoryShortcut('z', true, false, true), 'redo');
  assert.equal(maskHistoryShortcut('Z', false, true, true), 'redo');
  assert.equal(maskHistoryShortcut('y', true, false, false), 'redo');
  assert.equal(maskHistoryShortcut('z', false, false, false), null);
  assert.equal(maskHistoryShortcut('y', false, true, false), null);
  assert.equal(maskHistoryShortcut('a', true, false, false), null);
});
