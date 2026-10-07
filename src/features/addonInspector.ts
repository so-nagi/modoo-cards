import { strFromU8, unzipSync } from 'fflate';

export type AddonInspection = {
  name: string; version: string; package: string; fileCount: number; pythonFiles: number;
  dependencies: string[]; equivalent: string | null; warnings: string[];
  compatibility: 'desktop-only' | 'unsupported';
};

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

function plainValue(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 250) : fallback;
}

/** Inspect bounded ZIP text in memory. Never import, eval, extract or execute package code. */
export function inspectAddon(bytes: Uint8Array, filename: string): AddonInspection {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('확장 패키지는 25MB 이하로 선택해 주세요.');
  let fileCount = 0;
  let expanded = 0;
  let selectedBytes = 0;
  let pythonFiles = 0;
  const warnings: string[] = [];
  const filenames: string[] = [];
  const files = unzipSync(bytes, { filter(file) {
    const name = file.name.replace(/\\/g, '/');
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || name.includes('\0')) throw new Error('안전하지 않은 파일 경로가 들어 있는 패키지예요.');
    fileCount++;
    filenames.push(name);
    expanded += file.originalSize;
    if (fileCount > 5000 || expanded > MAX_EXPANDED_BYTES) throw new Error('확장 패키지의 내용이 너무 커서 검사할 수 없어요.');
    const python = /\.py$/i.test(name);
    if (python) pythonFiles++;
    const metadata = /(?:^|\/)(?:manifest|meta|addon)\.json$/i.test(name);
    if (!python && !metadata) return false;
    if (file.originalSize > (metadata ? 256 * 1024 : 1024 * 1024)) { warnings.push(`${name.slice(0, 150)}: 큰 파일은 내용 검사를 건너뛰었어요.`); return false; }
    selectedBytes += file.originalSize;
    if (selectedBytes > MAX_TEXT_BYTES) throw new Error('코드 검사 범위(8MB)를 넘는 패키지예요.');
    return true;
  } });
  if (!fileCount) throw new Error('패키지에 파일이 없어요.');
  let metadata: Record<string, unknown> = {};
  const metadataPaths = Object.keys(files).filter(name => /(?:^|\/)(?:manifest|meta|addon)\.json$/i.test(name))
    .sort((a, b) => Number(/manifest\.json$/i.test(a)) - Number(/manifest\.json$/i.test(b)));
  for (const path of metadataPaths) {
    try {
      const parsed: unknown = JSON.parse(strFromU8(files[path]));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const key of ['name', 'version', 'human_version', 'package']) if (Object.hasOwn(parsed, key)) metadata[key] = (parsed as Record<string, unknown>)[key];
      }
    } catch { warnings.push(`${path.slice(0, 150)}: 메타데이터를 읽지 못했어요.`); }
  }
  const dependencies = new Set<string>();
  for (const [name, data] of Object.entries(files)) {
    if (!/\.py$/i.test(name)) continue;
    const code = strFromU8(data);
    for (const [pattern, label] of [
      [/\b(?:from|import)\s+aqt\b/, 'Anki 데스크톱 UI (aqt)'],
      [/\b(?:from|import)\s+(?:aqt\.qt|PyQt[56]?|PySide[26]?)\b/, 'Qt / PyQt'],
      [/\b(?:from|import)\s+anki\b/, 'Anki Python API'],
      [/\b(?:from|import)\s+(?:requests|urllib|httpx)\b/, 'Python 네트워크 모듈'],
    ] as const) if (pattern.test(code)) dependencies.add(label);
  }
  const name = plainValue(metadata.name, filename.replace(/\.(?:ankiaddon|zip)$/i, ''));
  const identity = `${name} ${plainValue(metadata.package, '')} ${filenames.join(' ')}`.toLowerCase().replace(/[_-]/g, ' ');
  const equivalent = /review\s*heatmap/.test(identity) ? '학습 통계의 복습 히트맵'
    : /frozen\s*fields/.test(identity) ? '카드 추가의 필드 고정'
    : /advanced\s*browser/.test(identity) ? '카드 탐색기의 검색·정렬·열 선택'
    : /image\s*occlusion/.test(identity) ? '이미지 가리기 카드'
    : /speed\s*focus|review\s*timer/.test(identity) ? '집중 모드와 예상 복습 시간' : null;
  return { name, version: plainValue(metadata.human_version ?? metadata.version, '기재되지 않음'),
    package: plainValue(metadata.package, '기재되지 않음'), fileCount, pythonFiles, dependencies: [...dependencies], equivalent,
    warnings, compatibility: pythonFiles > 0 ? 'desktop-only' : 'unsupported' };
}
