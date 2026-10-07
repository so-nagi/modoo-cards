export type SoundAction = 'tap' | 'navigate' | 'reveal' | 'again' | 'hard' | 'good' | 'easy' | 'save' | 'delete';
export type SoundPreferences = { enabled: boolean; volume: number };
export type SoundDiagnostics = {
  phase: 'idle' | 'muted' | 'loading' | 'ready' | 'playing' | 'blocked' | 'error';
  contextState: string; message: string; durationSeconds: number | null; playCount: number;
  currentTimeSeconds?: number | null;
  readyState?: number | null; networkState?: number | null;
  muted?: boolean; volume?: number; mediaError?: number | null;
};

const STORAGE_KEY = 'modoo-anki.sound.v1';
const DEFAULTS: SoundPreferences = { enabled: true, volume: 0.35 };
// Seven user-supplied recordings. Clips preserve their full length and are PCM16.
export const SOUND_FILES: Record<SoundAction, string> = {
  tap: 'banana-l-1.wav', navigate: 'banana-l-2.wav', reveal: 'banana-l-3.wav',
  again: 'banana-l-4.wav', hard: 'banana-l-5.wav', good: 'banana-l-6.wav', easy: 'banana-l-7.wav',
  save: 'banana-l-2.wav', delete: 'banana-l-4.wav',
};
export function soundUrl(action: SoundAction): string { return `/sounds/banana-split-lubed/clips/${SOUND_FILES[action]}`; }
export function soundPreviewUrl(): string { return '/sounds/banana-split-lubed/preview.wav'; }

export function normalizeSoundPreferences(value: unknown): SoundPreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<SoundPreferences>;
  return { enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULTS.enabled,
    volume: typeof input.volume === 'number' && Number.isFinite(input.volume) ? Math.max(0, Math.min(1, input.volume)) : DEFAULTS.volume };
}
function readPreferences(): SoundPreferences {
  try { return normalizeSoundPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
  catch { return { ...DEFAULTS }; }
}

type Voice = { audio: HTMLAudioElement; action: SoundAction; id: number; live: boolean; fulfilled: boolean; sawPlaying: boolean; confirmed: boolean; deadline: ReturnType<typeof setTimeout> | null; detach: () => void };
let preferences = readPreferences();
let latestRequest = 0;
const active = new Set<Voice>();
const prepared = new Map<SoundAction, HTMLAudioElement>();
let diagnostics: SoundDiagnostics = { phase: 'idle', contextState: 'media-idle', message: '재생 전', durationSeconds: null, currentTimeSeconds: null, playCount: 0 };
const diagnosticListeners = new Set<(state: SoundDiagnostics) => void>();

/** Local media state only; no account, token, collection, or file data. */
export function getSoundDiagnostics(): SoundDiagnostics { return { ...diagnostics }; }
export function subscribeSoundDiagnostics(listener: (state: SoundDiagnostics) => void): () => void {
  diagnosticListeners.add(listener);
  return () => { diagnosticListeners.delete(listener); };
}
function reportSound(patch: Partial<SoundDiagnostics>): void {
  diagnostics = { ...diagnostics, ...patch };
  diagnosticListeners.forEach(listener => listener(getSoundDiagnostics()));
}
function releaseMedia(audio: HTMLAudioElement): void {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio.remove();
}
function releaseVoice(voice: Voice, recycle = false): void {
  if (!voice.live) return;
  voice.live = false;
  active.delete(voice);
  if (voice.deadline !== null) clearTimeout(voice.deadline);
  voice.detach();
  // Keep loaded media and its browser playback grant between ordinary clicks.
  // Errors and superseded pending requests still discard their media completely.
  if (recycle && !prepared.has(voice.action)) {
    try {
      // A completed short clip may still have an output tail in the device.
      // Preserve its position until the next gesture instead of seeking at ended.
      if (!voice.audio.ended) voice.audio.pause();
      prepared.set(voice.action, voice.audio);
      return;
    } catch { /* A failed seek needs a fresh media element on the next gesture. */ }
  }
  if (voice.audio.ended) { voice.audio.remove(); return; }
  releaseMedia(voice.audio);
}
function createMedia(action: SoundAction): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.hidden = true;
  audio.src = soundUrl(action);
  audio.preload = 'auto';
  audio.volume = preferences.volume;
  audio.muted = false;
  audio.dataset.modooSound = action;
  document.body.append(audio);
  return audio;
}

/** Pair the capture and bubble phases without a time-based click debounce. */
export function beginSoundGesture(): number { return latestRequest; }
export function finishSoundGesture(snapshot: number): void {
  if (snapshot === latestRequest) playSound('tap');
}

/** Explicit React action sounds win; other buttons get one synchronous click. */
export function installButtonSoundFeedback(): () => void {
  const gestures = new WeakMap<Event, number>();
  const capture = (event: Event) => {
    const control = (event.target as Element | null)?.closest?.('button,a[download],summary');
    if (!control || control.matches(':disabled,[aria-disabled="true"]')) return;
    gestures.set(event, beginSoundGesture());
  };
  const bubble = (event: Event) => {
    const snapshot = gestures.get(event);
    if (snapshot === undefined) return;
    gestures.delete(event);
    finishSoundGesture(snapshot);
  };
  document.addEventListener('click', capture, true);
  document.addEventListener('click', bubble);
  return () => {
    document.removeEventListener('click', capture, true);
    document.removeEventListener('click', bubble);
  };
}
function reportFailure(error: unknown, mediaCode?: number, state: Partial<SoundDiagnostics> = {}): void {
  const blocked = error instanceof Error && error.name === 'NotAllowedError';
  const message = blocked ? '브라우저가 재생을 차단했습니다. 들어보기를 눌러 다시 시도하세요.'
    : mediaCode === 2 ? '음원을 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.'
    : mediaCode === 3 || mediaCode === 4 ? '브라우저가 효과음 파일을 재생하지 못했습니다.'
    : '효과음을 재생하지 못했습니다. 다시 시도하세요.';
  reportSound({ ...state, phase: blocked ? 'blocked' : 'error', contextState: blocked ? 'media-blocked' : 'media-error', message });
}

/** Preload only. play() stays inside the eventual click/key handler. */
export function prepareSound(): void {
  if (!preferences.enabled || preferences.volume === 0 || typeof window === 'undefined') return;
  try {
    for (const action of Object.keys(SOUND_FILES) as SoundAction[]) {
      if (!prepared.has(action) && ![...active].some(voice => voice.action === action)) {
        const audio = createMedia(action);
        prepared.set(action, audio);
        audio.load();
      }
    }
  } catch (error) { reportFailure(error); }
}
export function getSoundPreferences(): SoundPreferences { return { ...preferences }; }
export function setSoundPreferences(value: SoundPreferences): void {
  preferences = normalizeSoundPreferences(value);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Storage may be unavailable. */ }
  for (const voice of active) voice.audio.volume = preferences.volume;
  for (const audio of prepared.values()) audio.volume = preferences.volume;
  if (!preferences.enabled || preferences.volume === 0) {
    latestRequest++;
    for (const voice of active) releaseVoice(voice, voice.confirmed);
    reportSound({ phase: 'muted', contextState: 'media-paused', message: !preferences.enabled ? '효과음 꺼짐' : '음량이 0%입니다.' });
  } else if (diagnostics.phase === 'muted') {
    reportSound({ phase: 'ready', contextState: 'media-ready', message: '재생 준비' });
  }
}

/** Native media play() must be invoked synchronously from the user gesture. */
export function playSound(action: SoundAction): void {
  if (typeof window === 'undefined') return;
  if (!preferences.enabled || preferences.volume === 0) {
    reportSound({ phase: 'muted', contextState: 'media-paused', message: !preferences.enabled ? '효과음 꺼짐' : '음량이 0%입니다.' });
    return;
  }
  let voice: Voice | undefined;
  try {
    const id = ++latestRequest;
    // A pending old click must not play later as a burst after a slow load.
    for (const old of active) if (!old.confirmed) releaseVoice(old);
    if (active.size >= 6) releaseVoice(active.values().next().value!);
    const audio = prepared.get(action) || createMedia(action);
    prepared.delete(action);
    audio.volume = preferences.volume;
    if (audio.currentTime > 0 || audio.ended) audio.currentTime = 0;
    voice = { audio, action, id, live: true, fulfilled: false, sawPlaying: false, confirmed: false, deadline: null, detach: () => {} };
    const current = voice;
    const mediaState = () => ({ durationSeconds: Number.isFinite(audio.duration) ? audio.duration : null, currentTimeSeconds: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
      readyState: audio.readyState, networkState: audio.networkState, muted: audio.muted, volume: audio.volume, mediaError: audio.error?.code ?? null });
    const confirm = () => {
      if (!current.live || !current.fulfilled || (!current.sawPlaying && audio.currentTime <= 0) || (audio.paused && !audio.ended)) return;
      const first = !current.confirmed;
      current.confirmed = true;
      if (current.deadline !== null) { clearTimeout(current.deadline); current.deadline = null; }
      if (id === latestRequest) reportSound({ phase: 'playing', contextState: 'media-playing', message: '브라우저 재생 확인', playCount: diagnostics.playCount + (first ? 1 : 0), ...mediaState() });
    };
    const onPlaying = () => { current.sawPlaying = true; confirm(); };
    const onProgress = () => { confirm(); };
    const onMetadata = () => { if (current.live && id === latestRequest) reportSound(mediaState()); };
    const onEnded = () => {
      if (!current.live) return;
      confirm();
      const state = mediaState();
      releaseVoice(current, true);
      if (id === latestRequest) reportSound({ phase: 'ready', contextState: 'media-ended', message: '브라우저 재생 완료', ...state });
    };
    const fail = (error: unknown) => {
      if (!current.live) return;
      const code = audio.error?.code;
      const state = mediaState();
      releaseVoice(current);
      if (id === latestRequest) reportFailure(error, code, state);
    };
    const onError = () => fail(new Error('Media playback failed'));
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('timeupdate', onProgress);
    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    current.detach = () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('timeupdate', onProgress);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
    active.add(current);
    reportSound({ phase: 'loading', contextState: 'media-loading', message: '음원 재생 준비 중', ...mediaState() });
    current.deadline = setTimeout(() => {
      if (!current.live || current.confirmed) return;
      const state = mediaState();
      releaseVoice(current);
      if (id === latestRequest) reportSound({ ...state, phase: 'error', contextState: 'media-timeout', message: '5초 동안 재생이 시작되지 않았습니다. 아래 음원 직접 재생으로 확인해 주세요.' });
    }, 5000);
    // No await, fetch, or decoding before this call: preserve the trusted gesture.
    const started = audio.play();
    void started.then(() => { if (current.live) { current.fulfilled = true; confirm(); } }).catch(fail);
  } catch (error) {
    if (voice) releaseVoice(voice);
    reportFailure(error);
  }
}

// App/account settings are authoritative. A storage event from another tab must
// not silently change playback while this tab still displays different settings.
