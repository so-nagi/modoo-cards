export type Box = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; confidence: number; bbox: Box };
export type VocabularyRow = { id: string; word: string; meaning: string; confidence: number; source: string; selected: boolean; duplicate?: boolean };
type LocatedRow = VocabularyRow & { x: number; meaningX: number; y: number; bottom: number; height: number };

const korean = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const latin = /[A-Za-z]/;
const pos = /^(?:n|v|a|ad|adj|adv|prep|pron|conj|interj|vi|vt|phr)\.?$/i;
const normalize = (text: string) => text.normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const cleanWord = (text: string) => normalize(text).replace(/^\s*(?:\d+[.)]?\s*|[•·▪■□]+\s*)/, '').replace(/\s*[:：|–—]\s*$/, '').trim();

function splitPair(text: string): { word: string; meaning: string } {
  const cleaned = normalize(text).trim();
  const hangulAt = cleaned.search(korean);
  if (hangulAt < 0) return { word: latin.test(cleaned) ? cleanWord(cleaned) : '', meaning: '' };
  const left = cleaned.slice(0, hangulAt);
  // Keep part-of-speech markers on the meaning side and do not remove comma-separated definitions.
  const marker = left.match(/(?:\s|^)((?:n|v|a|ad|adj|adv|prep|pron|conj|interj|vi|vt|phr)\.?\s*[:：|–—-]?\s*)$/i);
  const splitAt = marker?.index !== undefined ? marker.index : hangulAt;
  const word = cleanWord(cleaned.slice(0, splitAt)).replace(/\s*[-:=|]+\s*$/, '').trim();
  return { word: latin.test(word) ? word : '', meaning: cleaned.slice(splitAt).replace(/^[\s:：|–—]+/, '').trim() };
}

function finish(rows: VocabularyRow[]): VocabularyRow[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const signature = `${row.word.trim().toLocaleLowerCase()}\0${row.meaning.trim()}`;
    const duplicate = Boolean(row.word && row.meaning && seen.has(signature));
    seen.add(signature);
    return { ...row, id: `vocab-${index}`, selected: Boolean(row.word && row.meaning && !duplicate), duplicate };
  });
}

/** Text fallback, also usable for pasted OCR. Blank meanings are preserved for review. */
export function parseVocabularyText(text: string, confidence = 0): VocabularyRow[] {
  const rows: VocabularyRow[] = [];
  for (const line of text.split(/\r?\n/).filter(line => line.trim())) {
    // Tabs or wide whitespace after Korean are common text exports of a two-column sheet.
    const segments = line.split(/(?<=[가-힣.!?;])(?:\t+| {3,})(?=(?:\d+[.)]?\s*)?[A-Za-z])/);
    for (const segment of segments) {
      const pair = splitPair(segment);
      if (!pair.word && pair.meaning && rows.length) {
        const last = rows[rows.length - 1];
        last.meaning += `${last.meaning ? '\n' : ''}${pair.meaning}`;
        last.source += `\n${segment.trim()}`;
      } else if (pair.word || pair.meaning) {
        rows.push({ id: '', ...pair, confidence, source: segment.trim(), selected: true });
      }
    }
  }
  return finish(rows);
}

/** Rebuild physical lines across OCR blocks, then pair inside each page column. */
export function pairOcrWords(input: OcrWord[]): VocabularyRow[] {
  const words = input.filter(word => word.text.trim() && Object.values(word.bbox).every(Number.isFinite))
    .map(word => ({ ...word, text: normalize(word.text) })).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines: { words: OcrWord[]; center: number; height: number }[] = [];
  for (const word of words) {
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    // Small punctuation boxes sit below a line's center; include their baseline instead
    // of inventing a separate row for every comma/period.
    const candidates = lines.filter(line => Math.abs(line.center - center) <= Math.max(3, Math.max(height, line.height) * 0.6));
    const line = candidates.sort((a, b) => Math.abs(a.center - center) - Math.abs(b.center - center))[0];
    if (line) { line.words.push(word); line.center = line.words.reduce((sum, item) => sum + (item.bbox.y0 + item.bbox.y1) / 2, 0) / line.words.length; }
    else lines.push({ words: [word], center, height });
  }
  const rows: LocatedRow[] = [];
  const columnStarts: number[] = [];
  for (const line of lines.sort((a, b) => a.center - b.center)) {
    const sorted = line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const segments: OcrWord[][] = [[]];
    let hasKorean = false;
    let bracketDepth = 0;
    sorted.forEach((word, index) => {
      const previous = sorted[index - 1];
      const gap = previous ? word.bbox.x0 - previous.bbox.x1 : 0;
      const newEnglish = latin.test(word.text) && !korean.test(word.text) && !pos.test(word.text);
      // A new English headword after its Korean definition starts the next printed column.
      // Parenthetical English examples remain part of the previous definition.
      const knownColumn = index > 0 && columnStarts.some(start => Math.abs(start - word.bbox.x0) < line.height * 1.5);
      const split = bracketDepth <= 0 && newEnglish && gap > line.height * 0.8 && (hasKorean || knownColumn);
      const splitKoreanColumn = hasKorean && korean.test(word.text) && gap > line.height * 5;
      if (split || splitKoreanColumn) {
        if (split && !columnStarts.some(start => Math.abs(start - word.bbox.x0) < line.height * 1.5)) columnStarts.push(word.bbox.x0);
        segments.push([]); hasKorean = false; bracketDepth = 0;
      }
      segments[segments.length - 1].push(word);
      hasKorean ||= korean.test(word.text);
      bracketDepth += (word.text.match(/[([{]/g) || []).length - (word.text.match(/[)\]}]/g) || []).length;
    });
    for (const segment of segments.filter(segment => segment.length)) {
      const source = segment.reduce((text, word, index) => {
        if (!index) return word.text;
        const previous = segment[index - 1];
        const gap = word.bbox.x0 - previous.bbox.x1;
        // Korean OCR emits syllables as separate "words". Rejoin close glyphs but
        // retain real spaces, punctuation, and English multi-word headwords.
        const adjacentKorean = korean.test(previous.text.slice(-1)) && korean.test(word.text[0]) && gap < line.height * 0.48;
        const punctuation = /^[,.;:!?\])}]/.test(word.text);
        return `${text}${adjacentKorean || punctuation ? '' : ' '}${word.text}`;
      }, '');
      const pair = splitPair(source);
      const x = segment[0].bbox.x0;
      const y = Math.min(...segment.map(word => word.bbox.y0));
      const bottom = Math.max(...segment.map(word => word.bbox.y1));
      const confidence = Math.round(segment.reduce((sum, word) => sum + Math.max(0, Math.min(100, word.confidence || 0)), 0) / segment.length);
      if (!pair.word && pair.meaning) {
        const previous = rows.filter(row => y >= row.bottom - line.height * 0.3 && y - row.bottom < line.height * 2.2
          && Math.abs(row.meaningX - x) < Math.max(line.height * 3, 35))
          .sort((a, b) => (Math.abs(a.meaningX - x) + (y - a.bottom)) - (Math.abs(b.meaningX - x) + (y - b.bottom)))[0];
        if (previous) {
          previous.meaning += `${previous.meaning ? '\n' : ''}${pair.meaning}`;
          previous.source += `\n${source}`;
          previous.bottom = bottom;
          previous.confidence = Math.min(previous.confidence, confidence);
          continue;
        }
      }
      if (pair.word || pair.meaning) rows.push({ id: '', ...pair, confidence, source, selected: true,
        x, y, bottom, height: line.height, meaningX: segment.find(word => korean.test(word.text))?.bbox.x0 ?? x });
    }
  }
  return finish(rows.map(({ x: _x, y: _y, bottom: _bottom, height: _height, meaningX: _meaningX, ...row }) => row));
}

export function wordsFromTesseract(data: unknown): OcrWord[] {
  const output: OcrWord[] = [];
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.words)) {
      for (const word of node.words) {
        const candidate = word as OcrWord;
        if (typeof candidate.text === 'string' && candidate.bbox) output.push(candidate);
      }
      return;
    }
    for (const key of ['blocks', 'paragraphs', 'lines']) if (Array.isArray(node[key])) (node[key] as unknown[]).forEach(visit);
  }
  visit(data);
  return output;
}
