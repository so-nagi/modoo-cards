import type { OcclusionMask } from './occlusionGeometry';

export type OcclusionSnapshot = { masks: OcclusionMask[]; filename: string; imageUrl: string };
export type OcclusionHistory = { past: OcclusionSnapshot[]; present: OcclusionSnapshot; future: OcclusionSnapshot[] };
const copy = (snapshot: OcclusionSnapshot): OcclusionSnapshot => ({ ...snapshot, masks: snapshot.masks.map(mask => ({ ...mask })) });
const sameMasks = (left: OcclusionMask[], right: OcclusionMask[]) => left.length === right.length && left.every((mask, index) => {
  const next = right[index];
  return mask.id === next.id && mask.groupId === next.groupId && Math.abs(mask.x - next.x) < 1e-12 && Math.abs(mask.y - next.y) < 1e-12 && Math.abs(mask.width - next.width) < 1e-12 && Math.abs(mask.height - next.height) < 1e-12;
});
export const createOcclusionHistory = (snapshot: OcclusionSnapshot = { masks: [], filename: '', imageUrl: '' }): OcclusionHistory => ({ past: [], present: copy(snapshot), future: [] });

/** Only completed edits are committed. One pointer gesture is one history entry. */
export function commitOcclusionHistory(history: OcclusionHistory, next: OcclusionSnapshot): OcclusionHistory {
  if (history.present.filename === next.filename && history.present.imageUrl === next.imageUrl && sameMasks(history.present.masks, next.masks)) return history;
  return { past: [...history.past, history.present], present: copy(next), future: [] };
}
export function undoOcclusionHistory(history: OcclusionHistory): OcclusionHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}
export function redoOcclusionHistory(history: OcclusionHistory): OcclusionHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
export function maskHistoryShortcut(key: string, control: boolean, meta: boolean, shift: boolean): 'undo' | 'redo' | null {
  if (!control && !meta) return null;
  if (key.toLowerCase() === 'z') return shift ? 'redo' : 'undo';
  return control && key.toLowerCase() === 'y' ? 'redo' : null;
}
