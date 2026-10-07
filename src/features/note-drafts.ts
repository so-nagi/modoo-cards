export type NoteModelDraft={fields:string[];baseline:string;draftDirty:Record<number,boolean>};

export function hasUnsavedModelDrafts(drafts:ReadonlyMap<number,NoteModelDraft>,activeModelId:number):boolean {
  return Array.from(drafts.entries()).some(([id,draft])=>id!==activeModelId&&(
    JSON.stringify(draft.fields)!==JSON.stringify(JSON.parse(draft.baseline).fields)
    ||Object.values(draft.draftDirty).some(Boolean)
  ));
}

/** A saved model must not consume fields or pending hints belonging to another model. */
export function finishModelDraftSave<T extends NoteModelDraft>(drafts:ReadonlyMap<number,T>,savedModelId:number,tags:string):Map<number,T> {
  return new Map(Array.from(drafts.entries()).filter(([id])=>id!==savedModelId).map(([id,draft])=>[
    id,{...draft,baseline:JSON.stringify({...JSON.parse(draft.baseline),tags})},
  ]));
}
