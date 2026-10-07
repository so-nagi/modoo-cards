import assert from 'node:assert/strict';
import test from 'node:test';
import { planImageCrop, rotateMasksClockwise, transformOcclusionImage } from '../../src/components/occlusionImage.ts';
import type { OcclusionMask } from '../../src/components/occlusionGeometry.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const source: OcclusionMask[] = [
  { id: 'one', groupId: 'group', x: .1, y: .2, width: .3, height: .1 },
  { id: 'two', groupId: 'group', x: .7, y: .4, width: .3, height: .6 },
];

test('clockwise rotation follows image coordinates, preserves groups and returns to original after four turns', () => {
  const before = structuredClone(source), once = rotateMasksClockwise(source);
  close(once[0].x, .7); close(once[0].y, .1); close(once[0].width, .1); close(once[0].height, .3);
  assert.equal(once[0].id, 'one'); assert.equal(once[0].groupId, 'group');
  let repeated = source;
  for (let index = 0; index < 4; index++) repeated = rotateMasksClockwise(repeated);
  repeated.forEach((mask, index) => {
    for (const field of ['x', 'y', 'width', 'height'] as const) close(mask[field], source[index][field]);
  });
  assert.deepEqual(source, before);
});

test('crop rounds outward once and remaps boxes against those exact source pixels', () => {
  const plan = planImageCrop(101, 81, { x: .123, y: .234, width: .456, height: .345 }, [
    { id: 'box', groupId: 'g', x: .2, y: .3, width: .1, height: .1 },
  ]);
  assert.deepEqual(plan.rect, { x: 12, y: 18, width: 47, height: 29 });
  close(plan.normalizedRect.x, 12 / 101); close(plan.normalizedRect.height, 29 / 81);
  close(plan.masks[0].x, (20.2 - 12) / 47); close(plan.masks[0].width, 10.1 / 47);
  close(plan.masks[0].y, (24.3 - 18) / 29); close(plan.masks[0].height, 8.1 / 29);
  assert.equal(plan.clippedCount, 0); assert.equal(plan.removedCount, 0);
});

test('crop removes outside boxes, clips overlapping boxes and keeps group IDs for surviving boxes', () => {
  const boxes: OcclusionMask[] = [
    { id: 'inside', groupId: 'g', x: .4, y: .4, width: .1, height: .1 },
    { id: 'partial', groupId: 'g', x: .1, y: .3, width: .2, height: .2 },
    { id: 'outside', x: .8, y: .8, width: .1, height: .1 },
    { id: 'touching', x: .1, y: .4, width: .1, height: .1 },
  ];
  const before = structuredClone(boxes);
  const plan = planImageCrop(1000, 500, { x: .2, y: .2, width: .5, height: .5 }, boxes);
  assert.equal(plan.removedCount, 2); assert.equal(plan.clippedCount, 1);
  assert.deepEqual(plan.masks.map(mask => [mask.id, mask.groupId]), [['inside', 'g'], ['partial', 'g']]);
  close(plan.masks[0].x, .4); close(plan.masks[1].x, 0); close(plan.masks[1].width, .2);
  assert.deepEqual(boxes, before);
});

test('floating point edge contact cannot retain an invisible box', () => {
  const plan = planImageCrop(1000, 1000, { x: .3, y: 0, width: .5, height: 1 }, [
    { id: 'touching', x: .1, y: .2, width: .2, height: .3 },
  ]);
  assert.equal(plan.masks.length, 0); assert.equal(plan.removedCount, 1); assert.equal(plan.clippedCount, 0);
});

test('crop clamps crossing image bounds, supports a one pixel crop and preserves a full crop', () => {
  assert.deepEqual(planImageCrop(100, 50, { x: -.1, y: -.2, width: .5, height: .8 }, []).rect, { x: 0, y: 0, width: 40, height: 30 });
  assert.deepEqual(planImageCrop(100, 100, { x: .505, y: .505, width: .001, height: .001 }, []).rect, { x: 50, y: 50, width: 1, height: 1 });
  const full = planImageCrop(1000, 500, { x: 0, y: 0, width: 1, height: 1 }, source);
  full.masks.forEach((mask, index) => {
    for (const field of ['x', 'y', 'width', 'height'] as const) close(mask[field], source[index][field]);
  });
  assert.equal(full.removedCount, 0); assert.equal(full.clippedCount, 0);
});

test('invalid dimensions, empty crops, nonfinite and invalid mask geometry fail before transforming', () => {
  for (const width of [0, -1, 1.1, Infinity, NaN]) assert.throws(() => planImageCrop(width, 100, { x: 0, y: 0, width: 1, height: 1 }, []));
  for (const crop of [{ x: 0, y: 0, width: 0, height: 1 }, { x: 1, y: 0, width: 1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }]) {
    assert.throws(() => planImageCrop(100, 100, crop, []));
  }
  assert.throws(() => rotateMasksClockwise([{ ...source[0], x: 2 }]));
  assert.throws(() => planImageCrop(100, 100, { x: 0, y: 0, width: 1, height: 1 }, [{ ...source[0], width: -1 }]));
});

async function withCanvas<T>(run: (state: { calls: unknown[][]; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }) => Promise<T>, fail?: 'context' | 'blob' | 'draw') {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls: unknown[][] = [];
  const context = {
    translate: (...args: unknown[]) => calls.push(['translate', ...args]),
    rotate: (...args: unknown[]) => calls.push(['rotate', ...args]),
    drawImage: (...args: unknown[]) => { if (fail === 'draw') throw new Error('draw failed'); calls.push(['drawImage', ...args]); },
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0, height: 0,
    getContext: () => fail === 'context' ? null : context,
    toBlob: (callback: BlobCallback, type: string) => { calls.push(['encode', canvas.width, canvas.height, type]); callback(fail === 'blob' ? null : new Blob(['pixels'], { type })); },
  } as unknown as HTMLCanvasElement;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (name: string) => { assert.equal(name, 'canvas'); return canvas; } } });
  try { return await run({ calls, canvas, context }); }
  finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
}
const image = { complete: true, naturalWidth: 640, naturalHeight: 360 } as HTMLImageElement;

test('canvas rotation swaps native dimensions, uses a quarter turn and frees the allocation after PNG encoding', async () => {
  await withCanvas(async ({ calls, canvas }) => {
    const file = await transformOcclusionImage(image, { kind: 'rotate-clockwise' }, 'photo.jpg');
    assert.equal(file.name, 'photo-edited.png'); assert.equal(file.type, 'image/png');
    assert.deepEqual(calls, [['translate', 360, 0], ['rotate', Math.PI / 2], ['drawImage', image, 0, 0, 640, 360], ['encode', 360, 640, 'image/png']]);
    assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  });
});

test('canvas crop uses the same integer pixel bounds as the mask crop plan', async () => {
  await withCanvas(async ({ calls }) => {
    const plan = planImageCrop(640, 360, { x: .13, y: .27, width: .42, height: .51 }, []);
    await transformOcclusionImage(image, { kind: 'crop', rect: plan.rect }, 'photo-edited.png');
    const rect = plan.rect;
    assert.deepEqual(calls, [['drawImage', image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height], ['encode', rect.width, rect.height, 'image/png']]);
  });
});

test('explicit resolution reduction retains the whole image and enables high quality scaling', async () => {
  await withCanvas(async ({ calls, context }) => {
    await transformOcclusionImage(image, { kind: 'resize', width: 320, height: 180 });
    assert.deepEqual(calls[0], ['drawImage', image, 0, 0, 640, 360, 0, 0, 320, 180]);
    assert.equal(context.imageSmoothingEnabled, true); assert.equal(context.imageSmoothingQuality, 'high');
  });
});

test('canvas errors release memory and unsupported dimensions fail before allocation', async () => {
  for (const failure of ['context', 'blob', 'draw'] as const) await withCanvas(async ({ canvas }) => {
    await assert.rejects(transformOcclusionImage(image, { kind: 'rotate-clockwise' }));
    assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  }, failure);
  await assert.rejects(transformOcclusionImage({ ...image, complete: false } as HTMLImageElement, { kind: 'rotate-clockwise' }));
  await assert.rejects(transformOcclusionImage(image, { kind: 'resize', width: 1000, height: 360 }));
  await assert.rejects(transformOcclusionImage(image, { kind: 'crop', rect: { x: -1, y: 0, width: 100, height: 100 } }));
  await assert.rejects(transformOcclusionImage({ complete: true, naturalWidth: 10000, naturalHeight: 10000 } as HTMLImageElement, { kind: 'rotate-clockwise' }));
});

test('large sources can be explicitly reduced to fit the canvas budget', async () => {
  await withCanvas(async ({ calls }) => {
    await transformOcclusionImage({ complete: true, naturalWidth: 10000, naturalHeight: 10000 } as HTMLImageElement, { kind: 'resize', width: 2000, height: 2000 });
    assert.deepEqual(calls.at(-1), ['encode', 2000, 2000, 'image/png']);
  });
});
