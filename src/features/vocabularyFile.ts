import type { VocabularyRow } from './vocabulary';

export const MAX_VOCABULARY_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const headers = {
  word: new Set(['단어', '영단어', '영어', 'word', 'term', 'front']),
  meaning: new Set(['뜻', '의미', '한글뜻', '한국어뜻', '한국어', 'meaning', 'definition', 'translation', 'korean', 'back']),
  example: new Set(['예문', 'example', 'examples', 'sentence', 'examplesentence']),
};

export function decodeVocabularyFile(bytes: ArrayBuffer): string {
  if (bytes.byteLength > MAX_VOCABULARY_FILE_BYTES) throw new Error('단어 파일은 5MB 이하로 선택해 주세요.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('한글을 읽을 수 없어요. 파일을 UTF-8 형식으로 저장한 뒤 다시 선택해 주세요.'); }
}

/** Quoted cells may contain separators, newlines and doubled quotation marks. */
function readCells(text: string, delimiter: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  function endCell() { row.push(cell.trim()); cell = ''; closed = false; }
  function endRow() {
    endCell();
    if (row.some(value => value)) result.push(row);
    if (result.length > MAX_ROWS + 1) throw new Error('한 파일에는 2,000개 이하의 단어를 넣어 주세요.');
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === delimiter) endCell();
    else if (char === '\n') endRow();
    else if (closed) {
      if (char !== ' ' && char !== '\t') throw new Error('닫힌 따옴표 뒤에 다른 글자가 있어요. CSV·TSV의 따옴표를 확인해 주세요.');
    } else if (char === '"') {
      if (cell.trim()) throw new Error('셀 안의 따옴표는 두 번 쓰고 셀 전체를 따옴표로 감싸 주세요.');
      cell = ''; quoted = true;
    } else cell += char;
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있어요. CSV·TSV 파일의 따옴표를 확인해 주세요.');
  endRow();
  return result;
}

export function parseVocabularyFile(text: string, filename: string): VocabularyRow[] {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension !== 'tsv' && extension !== 'csv' && extension !== 'txt') throw new Error('단어 목록은 TSV 또는 CSV 파일로 선택해 주세요.');
  if (text.includes('\0')) throw new Error('텍스트 단어 파일을 선택해 주세요. UTF-8 TSV·CSV 파일만 읽을 수 있어요.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiter = extension === 'csv' ? ',' : extension === 'tsv' || normalized.includes('\t') ? '\t' : ',';
  const table = readCells(normalized, delimiter);
  if (!table.length) throw new Error('파일에 단어와 한글 뜻을 넣어 주세요.');
  if (!table.some(row => row.length >= 2)) throw new Error('단어와 한글 뜻을 두 열로 나눠 주세요. TSV는 탭, CSV는 쉼표로 구분해요.');
  const names = table[0].map(value => value.toLowerCase().replace(/[\s_-]/g, ''));
  const wordColumn = names.findIndex(value => headers.word.has(value));
  const meaningColumn = names.findIndex(value => headers.meaning.has(value));
  const hasHeader = wordColumn >= 0 && meaningColumn >= 0;
  const exampleColumn = hasHeader ? names.findIndex(value => headers.example.has(value)) : 2;
  const columns = hasHeader ? table.shift()!.length : 3;
  if (hasHeader && (columns > 3 || (columns === 3 && exampleColumn < 0) || new Set(names).size !== names.length)) {
    throw new Error('열 이름은 단어, 한글 뜻, 예문(선택)으로 지정해 주세요.');
  }
  if (!table.length) throw new Error('제목 아래에 등록할 단어를 넣어 주세요.');
  if (table.length > MAX_ROWS) throw new Error('한 파일에는 2,000개 이하의 단어를 넣어 주세요.');
  const seen = new Set<string>();
  return table.map((cells, index) => {
    if (cells.length > columns) throw new Error(`${index + (hasHeader ? 2 : 1)}번째 항목의 열이 너무 많아요. 뜻에 쉼표가 있으면 셀을 따옴표로 감싸 주세요.`);
    const word = cells[hasHeader ? wordColumn : 0] || '';
    const definition = cells[hasHeader ? meaningColumn : 1] || '';
    const example = exampleColumn >= 0 ? cells[exampleColumn] || '' : '';
    const meaning = definition + (example ? `${definition ? '\n\n' : ''}예문: ${example}` : '');
    const signature = `${word.toLocaleLowerCase()}\0${meaning}`;
    const duplicate = seen.has(signature);
    seen.add(signature);
    return { id: `file-${index}`, word, meaning, confidence: 0, selected: Boolean(word && definition && !duplicate), duplicate,
      source: `파일: ${filename}\n${cells.join('\t')}` };
  });
}
