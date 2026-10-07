export const SETTINGS_SYNC_WARNING = '설정은 앱 서버에 저장됐어요. 계정의 설정 사본을 갱신하지 못했어요. 다시 시도를 눌러 저장할 수 있어요.';

type MirrorBoundary = {
  assertCurrent: () => void;
  write: (settings: Record<string, unknown>) => Promise<void>;
  notify: (warning: string) => void;
};

// Mirror failure must not turn a successful authoritative save into a failure.
export async function mirrorSettings(settings: Record<string, unknown>, boundary: MirrorBoundary, timeoutMs = 8000): Promise<boolean> {
  boundary.assertCurrent();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      boundary.write(settings),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Cloud settings timeout')), timeoutMs); }),
    ]);
  } catch {
    boundary.assertCurrent();
    boundary.notify(SETTINGS_SYNC_WARNING);
    return false;
  } finally { clearTimeout(timer); }
  boundary.assertCurrent();
  boundary.notify('');
  return true;
}

export async function retrySettingsMirror(readSettings: () => Promise<Record<string, unknown>>, boundary: MirrorBoundary): Promise<boolean> {
  boundary.assertCurrent();
  const latest = await readSettings();
  boundary.assertCurrent();
  return mirrorSettings(latest, boundary);
}
