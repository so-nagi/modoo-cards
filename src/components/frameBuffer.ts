export type FrameDocument = {
  revision: number;
  documentHtml: string;
  title: string;
  contentKey?: string | number;
};

export type FrameBuffer = {
  slots: [FrameDocument | null, FrameDocument | null];
  active: 0 | 1 | null;
  pending: number | null;
};

export function createFrameBuffer(): FrameBuffer {
  return { slots: [null, null], active: null, pending: null };
}

/** Loading a document never removes the currently visible document. */
export function stageFrame(buffer: FrameBuffer, document: FrameDocument): FrameBuffer {
  const slot = buffer.active === 0 ? 1 : 0;
  const slots: FrameBuffer['slots'] = [...buffer.slots];
  slots[slot] = document;
  return { slots, active: buffer.active, pending: document.revision };
}

/** A late load from an abandoned request must not replace a newer card. */
export function finishFrame(buffer: FrameBuffer, revision: number): FrameBuffer {
  if (buffer.pending !== revision) return buffer;
  const slot = buffer.slots.findIndex(document => document?.revision === revision);
  if (slot !== 0 && slot !== 1) return buffer;
  const slots: FrameBuffer['slots'] = [null, null];
  slots[slot] = buffer.slots[slot];
  return { slots, active: slot, pending: null };
}

export function cancelFrame(buffer: FrameBuffer, revision: number): FrameBuffer {
  if (buffer.pending !== revision) return buffer;
  const slots: FrameBuffer['slots'] = [...buffer.slots];
  for (const slot of [0, 1] as const) {
    if (slot !== buffer.active && slots[slot]?.revision === revision) slots[slot] = null;
  }
  return { slots, active: buffer.active, pending: null };
}
