export class SessionBoundary {
  private identity: string | null = null;
  private generation = 0;
  set(identity: string | null) {
    if (identity !== this.identity) { this.identity = identity; this.generation++; }
  }
  capture() { return this.generation; }
  assertCurrent(generation: number) {
    if (generation !== this.generation) throw new Error('계정이 변경되어 이전 요청을 취소했어요.');
  }
}

export function safeApiPath(path: string): string {
  const decoded = decodeURIComponent(path.split('?')[0]);
  if (!path.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\') || decoded.split('/').some(p => p === '..' || p === '.') || /[\u0000-\u001f]/.test(decoded)) {
    throw new Error('올바르지 않은 API 경로예요.');
  }
  return `/api${path}`;
}
