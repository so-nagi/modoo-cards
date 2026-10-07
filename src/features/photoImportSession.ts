import type { VocabularyRow } from './vocabulary';

/** A synchronous submission lock prevents duplicate requests before React rerenders. */
export function createPhotoImportSession() {
  let submitting = false;
  return {
    get submitting() { return submitting; },
    async submit(rows: VocabularyRow[], onImport: (rows: { word: string; meaning: string }[]) => Promise<void>) {
      if (submitting) return null;
      const selected = rows.filter(row => row.selected && row.word.trim() && row.meaning.trim());
      if (!selected.length) return null;
      const submittedIds = new Set(selected.map(row => row.id));
      const payload = selected.map(row => ({ word: row.word.trim(), meaning: row.meaning.trim() }));
      submitting = true;
      try {
        await onImport(payload);
        return { count: payload.length, submittedIds };
      } finally { submitting = false; }
    },
  };
}

export function remainingAfterImport(rows: VocabularyRow[], submittedIds: ReadonlySet<string>): VocabularyRow[] {
  return rows.filter(row => !submittedIds.has(row.id));
}
