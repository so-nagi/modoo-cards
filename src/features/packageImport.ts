export const IMPORT_ACCEPT = '.apkg,.colpkg,.csv,.tsv,.txt';
const MAX_IMPORT_BYTES = 128 * 1024 * 1024;

export function isAnkiPackage(name: string): boolean {
  return /\.(apkg|colpkg)$/i.test(name);
}

export function validateImportFile(file: Pick<File, 'name' | 'size'>): string {
  if (!/\.(apkg|colpkg|csv|tsv|txt)$/i.test(file.name)) return '.apkg, .colpkg, .csv, .tsv, .txt 파일을 선택하세요.';
  if (!file.size) return '파일이 비어 있습니다. Anki에서 내보낸 파일을 다시 선택하세요.';
  if (file.size > MAX_IMPORT_BYTES) return '업로드는 128MB 이하로 해주세요.';
  return '';
}

export type ImportResult = { message: string; added?: number; cardsAdded?: number };

export function importResultMessage(result: ImportResult): string {
  const message = result.message || '가져오기가 완료되었습니다.';
  if (result.added === undefined) return message;
  const counts = `노트 ${result.added}개${result.cardsAdded === undefined ? '' : ` · 카드 ${result.cardsAdded}개`} 추가`;
  return `${message} ${counts}.${result.added === 0 ? ' 새로 추가된 노트가 없습니다. 기존 자료와 같은 항목은 중복 추가하지 않으며 변경된 항목은 Anki 규칙에 따라 반영됩니다.' : ''}`;
}
