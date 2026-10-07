import { requestIdentity, sessionBoundary, cloudSettingsWrite } from './auth';
import { apiURL } from './backend';
import { mirrorSettings, retrySettingsMirror } from './settingsMirror';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}

const mirrorBoundary = (generation: number) => ({
  assertCurrent: () => sessionBoundary.assertCurrent(generation),
  write: cloudSettingsWrite,
  notify: (warning: string) => window.dispatchEvent(new CustomEvent('modoo:sync-warning', { detail: warning })),
});

export async function retryCloudSettings(): Promise<boolean> {
  const generation = sessionBoundary.capture();
  return retrySettingsMirror(() => api<Record<string, unknown>>('/settings'), mirrorBoundary(generation));
}

async function authenticatedFetch(path: string, options: RequestInit = {}) {
  const identity = await requestIdentity();
  const headers = new Headers(options.headers);
  if (identity.token) headers.set('Authorization', `Bearer ${identity.token}`);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiURL(path), { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  sessionBoundary.assertCurrent(identity.generation);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: `요청을 처리하지 못했어요. (${response.status})` }));
    throw new ApiError(typeof error.detail === 'string' ? error.detail : '입력 내용을 확인해 주세요.', response.status);
  }
  return { response, generation: identity.generation };
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const { response, generation } = await authenticatedFetch(path, options);
  const result = response.status === 204 ? {} : await response.json();
  sessionBoundary.assertCurrent(generation);
  // The account's Anki server is authoritative. An older Firestore mirror must
  // never overwrite a successful server write during a periodic refresh.
  if (path === '/settings' && options.method?.toUpperCase() === 'PUT') {
    await mirrorSettings(result, mirrorBoundary(generation));
  }
  return result as T;
}

export async function downloadFile(path: string, body: unknown, filename: string) {
  const { response, generation } = await authenticatedFetch(path, { method: 'POST', body: JSON.stringify(body) });
  const blob = await response.blob();
  sessionBoundary.assertCurrent(generation);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
