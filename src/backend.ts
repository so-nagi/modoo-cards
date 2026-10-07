import { safeApiPath } from './session';

// Deployment configuration only. Never accept a destination from URL parameters
// or user input: authentication headers must stay on the configured backend.
const configured = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim() || '';
export const apiOrigin = (() => {
  if (!configured) return '';
  const parsed = new URL(configured);
  if (parsed.protocol !== 'https:' || parsed.origin !== configured) throw new Error('API 주소 설정을 확인하세요.');
  return parsed.origin;
})();
export const apiURL = (path: string) => apiOrigin + safeApiPath(path);
