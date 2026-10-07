export type Point = { x: number; y: number };
export type MaskRect = Point & { width: number; height: number };
export type OcclusionMask = MaskRect & { id: string; groupId?: string };
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export const MIN_MASK_SIZE = 0.008;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const boundedPoint = (point: Point): Point => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) });

export function drawnRect(origin: Point, point: Point): MaskRect {
  const a = boundedPoint(origin), b = boundedPoint(point);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function resizeRect(rect: MaskRect, corner: ResizeCorner, point: Point): MaskRect {
  const right = rect.x + rect.width, bottom = rect.y + rect.height;
  // A crop may leave a smaller fragment at an edge; its opposite anchor must stay fixed.
  const x = corner.includes('w') ? clamp(point.x, 0, right - Math.min(MIN_MASK_SIZE, right)) : rect.x;
  const y = corner.includes('n') ? clamp(point.y, 0, bottom - Math.min(MIN_MASK_SIZE, bottom)) : rect.y;
  const endX = corner.includes('e') ? clamp(point.x, rect.x + Math.min(MIN_MASK_SIZE, 1 - rect.x), 1) : right;
  const endY = corner.includes('s') ? clamp(point.y, rect.y + Math.min(MIN_MASK_SIZE, 1 - rect.y), 1) : bottom;
  return { x, y, width: endX - x, height: endY - y };
}

/** Preserve the grab offset inside a handle's enlarged hit area. */
export function resizeFromDrag(rect: MaskRect, corner: ResizeCorner, start: Point, point: Point): MaskRect {
  return resizeRect(rect, corner, {
    x: rect.x + (corner.includes('e') ? rect.width : 0) + point.x - start.x,
    y: rect.y + (corner.includes('s') ? rect.height : 0) + point.y - start.y,
  });
}

/** Clamp one shared delta so a group stays together at every image boundary. */
export function moveMasks(masks: OcclusionMask[], ids: string[], delta: Point): OcclusionMask[] {
  const selected = masks.filter(mask => ids.includes(mask.id));
  if (!selected.length) return masks;
  const dx = clamp(delta.x, -Math.min(...selected.map(mask => mask.x)), 1 - Math.max(...selected.map(mask => mask.x + mask.width)));
  const dy = clamp(delta.y, -Math.min(...selected.map(mask => mask.y)), 1 - Math.max(...selected.map(mask => mask.y + mask.height)));
  return masks.map(mask => ids.includes(mask.id) ? { ...mask, x: clamp(mask.x + dx, 0, 1 - mask.width), y: clamp(mask.y + dy, 0, 1 - mask.height) } : mask);
}

export function maskSelection(masks: OcclusionMask[], id: string): string[] {
  const mask = masks.find(item => item.id === id);
  return !mask ? [] : mask.groupId ? masks.filter(item => item.groupId === mask.groupId).map(item => item.id) : [id];
}

export function selectMasks(current: string[], target: string[], additive: boolean): string[] {
  if (!additive) return target;
  return target.every(id => current.includes(id)) ? current.filter(id => !target.includes(id)) : [...new Set([...current, ...target])];
}

export function groupMasks(masks: OcclusionMask[], ids: string[], groupId: string): OcclusionMask[] {
  if (!groupId || masks.filter(mask => ids.includes(mask.id)).length < 2) return masks;
  return masks.map(mask => ids.includes(mask.id) ? { ...mask, groupId } : mask);
}

export function ungroupMasks(masks: OcclusionMask[], ids: string[]): OcclusionMask[] {
  const groups = new Set(masks.filter(mask => ids.includes(mask.id) && mask.groupId).map(mask => mask.groupId));
  return masks.map(mask => {
    if (!mask.groupId || !groups.has(mask.groupId)) return mask;
    const { groupId: _groupId, ...independent } = mask;
    return independent;
  });
}

export function problemCount(masks: OcclusionMask[]): number {
  return masks.filter(mask => !mask.groupId).length + new Set(masks.flatMap(mask => mask.groupId ? [mask.groupId] : [])).size;
}

export function maskPayload(masks: OcclusionMask[]): (MaskRect & { groupId?: string })[] {
  return masks.map(({ id: _id, ...mask }) => mask);
}
