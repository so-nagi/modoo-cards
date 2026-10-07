/** Public assets also work when the static demo is hosted under a repository path. */
export function assetUrl(path: string): string {
  return `${import.meta.env?.BASE_URL || '/'}${path.replace(/^\/+/, '')}`;
}
