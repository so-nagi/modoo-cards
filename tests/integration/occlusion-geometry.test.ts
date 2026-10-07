import assert from 'node:assert/strict';
import test from 'node:test';
import { drawnRect, groupMasks, maskPayload, maskSelection, MIN_MASK_SIZE, moveMasks, problemCount, resizeFromDrag, resizeRect, selectMasks, ungroupMasks, type OcclusionMask, type ResizeCorner } from '../../src/components/occlusionGeometry.ts';

const masks: OcclusionMask[] = [
  { id: 'a', x: 0.1, y: 0.2, width: 0.2, height: 0.15 },
  { id: 'b', x: 0.65, y: 0.6, width: 0.25, height: 0.3 },
  { id: 'c', x: 0.35, y: 0.4, width: 0.1, height: 0.1 },
];
const approximately = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('drawing in reverse direction clips both corners to image bounds', () => {
  assert.deepEqual(drawnRect({ x: 1.2, y: 0.8 }, { x: -0.2, y: -0.5 }), { x: 0, y: 0, width: 1, height: 0.8 });
});

test('every resize corner preserves the opposite corner and cannot invert', () => {
  const rect = masks[0];
  for (const corner of ['nw', 'ne', 'sw', 'se'] as ResizeCorner[]) {
    const result = resizeRect(rect, corner, { x: corner.includes('w') ? 2 : -2, y: corner.includes('n') ? 2 : -2 });
    approximately(result.width, MIN_MASK_SIZE); approximately(result.height, MIN_MASK_SIZE);
    if (corner.includes('w')) approximately(result.x + result.width, rect.x + rect.width);
    else approximately(result.x, rect.x);
    if (corner.includes('n')) approximately(result.y + result.height, rect.y + rect.height);
    else approximately(result.y, rect.y);
  }
});

test('resizing outside the image remains within normalized coordinates', () => {
  for (const corner of ['nw', 'ne', 'sw', 'se'] as ResizeCorner[]) {
    const result = resizeRect(masks[0], corner, { x: corner.includes('w') ? -2 : 2, y: corner.includes('n') ? -2 : 2 });
    assert.ok(result.x >= 0 && result.y >= 0 && result.x + result.width <= 1 && result.y + result.height <= 1);
  }
});

test('grabbing any part of an enlarged corner handle preserves size until the pointer moves', () => {
  const rect = masks[0];
  for (const corner of ['nw', 'ne', 'sw', 'se'] as ResizeCorner[]) {
    const start = { x: rect.x + (corner.includes('e') ? rect.width : 0) + .02, y: rect.y + (corner.includes('s') ? rect.height : 0) - .03 };
    const unchanged = resizeFromDrag(rect, corner, start, start);
    approximately(unchanged.x, rect.x); approximately(unchanged.y, rect.y);
    approximately(unchanged.width, rect.width); approximately(unchanged.height, rect.height);
    const moved = resizeFromDrag(rect, corner, start, { x: start.x + .01, y: start.y + .02 });
    approximately(moved.width, rect.width + (corner.includes('w') ? -.01 : .01));
    approximately(moved.height, rect.height + (corner.includes('n') ? -.02 : .02));
  }
});

test('corner grab outside image bounds uses pointer delta without a boundary jump', () => {
  const rect = { x: 0, y: 0, width: .3, height: .2 }, start = { x: -.02, y: -.02 };
  const unchanged = resizeFromDrag(rect, 'nw', start, start);
  assert.deepEqual(unchanged, rect);
  const resized = resizeFromDrag(rect, 'nw', start, { x: .03, y: .04 });
  approximately(resized.x, .05); approximately(resized.y, .06);
  approximately(resized.width, .25); approximately(resized.height, .14);
});

test('a tiny crop fragment at every image edge cannot resize outside image bounds', () => {
  for (const rect of [
    { x: .998, y: .997, width: .002, height: .003 },
    { x: 0, y: 0, width: .002, height: .003 },
    { x: .998, y: 0, width: .002, height: .003 },
    { x: 0, y: .997, width: .002, height: .003 },
  ]) {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as ResizeCorner[]) {
      for (const point of [{ x: -1, y: -1 }, { x: 2, y: 2 }]) {
        const result = resizeRect(rect, corner, point);
        assert.ok(result.x >= 0 && result.y >= 0 && result.x + result.width <= 1 && result.y + result.height <= 1);
        assert.ok(result.width > 0 && result.height > 0);
        if (corner.includes('w')) approximately(result.x + result.width, rect.x + rect.width);
        else approximately(result.x, rect.x);
        if (corner.includes('n')) approximately(result.y + result.height, rect.y + rect.height);
        else approximately(result.y, rect.y);
      }
    }
  }
});

test('moving several masks uses a shared clamped delta and leaves unselected masks intact', () => {
  for (const delta of [{ x: 2, y: 3 }, { x: -2, y: -3 }]) {
    const moved = moveMasks(masks, ['a', 'b'], delta);
    approximately(moved[1].x - moved[0].x, masks[1].x - masks[0].x);
    approximately(moved[1].y - moved[0].y, masks[1].y - masks[0].y);
    assert.equal(moved[2], masks[2]);
    for (const mask of moved) assert.ok(mask.x >= -1e-12 && mask.y >= -1e-12 && mask.x + mask.width <= 1 + 1e-12 && mask.y + mask.height <= 1 + 1e-12);
  }
});

test('groups count as one problem, select together, and serialize without editor IDs', () => {
  const grouped = groupMasks(masks, ['a', 'b'], 'group-1');
  assert.equal(problemCount(grouped), 2);
  assert.deepEqual(maskSelection(grouped, 'a'), ['a', 'b']);
  assert.deepEqual(maskPayload(grouped).map(mask => mask.groupId), ['group-1', 'group-1', undefined]);
  assert.ok(maskPayload(grouped).every(mask => !('id' in mask)));
  assert.deepEqual(masks.map(mask => mask.groupId), [undefined, undefined, undefined]);
});

test('shift selection toggles a group as a unit and ungroup restores separate problems', () => {
  const grouped = groupMasks(masks, ['a', 'b'], 'group-1');
  assert.deepEqual(selectMasks(['c'], maskSelection(grouped, 'a'), true), ['c', 'a', 'b']);
  assert.deepEqual(selectMasks(['a', 'b', 'c'], maskSelection(grouped, 'a'), true), ['c']);
  assert.equal(problemCount(ungroupMasks(grouped, ['a'])), 3);
});
