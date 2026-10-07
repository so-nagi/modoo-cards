export type SpeechStatus = { state: 'idle' | 'loading' | 'speaking' | 'error'; message: string };
type SpeechRuntime = {
  synthesis: SpeechSynthesis;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
};

export function speechFailure(code: string): string {
  if (code === 'not-allowed') return '브라우저가 음성 재생을 차단했습니다. 탭의 소리를 켠 뒤 읽어주기를 다시 눌러 주세요.';
  if (code === 'language-unavailable' || code === 'voice-unavailable') return '이 언어의 읽기 음성이 없습니다. 기기의 음성 설정에서 영어 또는 한국어 음성을 설치해 주세요.';
  if (code === 'audio-busy' || code === 'audio-hardware') return '음성 출력 장치를 사용할 수 없습니다. 기기의 소리 출력 설정을 확인해 주세요.';
  if (code === 'network') return '읽기 음성을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
  return '음성을 재생하지 못했습니다. 탭 음소거와 기기의 음성 설정을 확인한 뒤 다시 눌러 주세요.';
}

export function chooseReadingVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const normalized = lang.toLowerCase(), language = normalized.split('-')[0];
  return voices.filter(voice => voice.lang.toLowerCase().replaceAll('_', '-').split('-')[0] === language)
    .sort((a, b) => {
      const rank = (voice: SpeechSynthesisVoice) => Number(voice.localService) * 4
        + Number(voice.lang.toLowerCase().replaceAll('_', '-') === normalized) * 2 + Number(voice.default);
      return rank(b) - rank(a);
    })[0];
}

/** Retain the utterance and use engine events, not speak() returning, as playback evidence. */
export function createCardReader(runtime: SpeechRuntime, report: (status: SpeechStatus) => void) {
  const { synthesis } = runtime;
  let active: SpeechSynthesisUtterance | null = null;
  let startTimer: number | undefined, endTimer: number | undefined;
  let generation = 0;
  const clearTimers = () => {
    if (startTimer !== undefined) runtime.clearTimer(startTimer);
    if (endTimer !== undefined) runtime.clearTimer(endTimer);
    startTimer = endTimer = undefined;
  };
  const stop = (notify = true) => {
    generation++; clearTimers();
    const hadActive = active !== null;
    active = null;
    if (hadActive) synthesis.cancel();
    if (notify) report({ state: 'idle', message: '' });
  };
  const play = (text: string) => {
    stop(false);
    if (!text.trim()) { report({ state: 'error', message: '현재 카드에 읽을 텍스트가 없습니다.' }); return; }
    const request = generation;
    const fail = (message: string) => { if (request !== generation) return; stop(false); report({ state: 'error', message }); };
    try {
      const lang = /[가-힣]/.test(text) ? 'ko-KR' : 'en-US';
      const voices = synthesis.getVoices().filter(voice => voice.lang.toLowerCase().replaceAll('_','-').split('-')[0] === lang.split('-')[0]);
      const preferred = chooseReadingVoice(voices,lang);
      // Some installed voices enumerate successfully but end without producing speech.
      // Try another provider, then let the browser resolve its default voice.
      const candidates = [...new Set([preferred,voices.find(voice=>!voice.localService),voices.find(voice=>voice!==preferred)].filter((voice):voice is SpeechSynthesisVoice=>!!voice)),null];
      let candidateIndex = 0;
      const attempt = () => {
        if (request !== generation) return;
        clearTimers();
        const utterance = runtime.createUtterance(text);
        let started = false;
        utterance.lang = lang;
        utterance.voice = candidates[candidateIndex];
        utterance.volume = 1; utterance.rate = 1; utterance.pitch = 1;
        active = utterance;
        const voiceName = utterance.voice?.name;
        const current = () => request === generation && active === utterance;
        const retry = (message:string,canRetry=true) => {
          if (!current()) return;
          if (started || !canRetry || ++candidateIndex >= candidates.length) { fail(message); return; }
          clearTimers(); active = null; synthesis.cancel();
          startTimer = runtime.setTimer(attempt,50);
        };
        report({ state: 'loading', message: `${candidateIndex?'다른 읽기 음성을':'읽기 음성을'} 준비하고 있습니다…${voiceName?` · ${voiceName}`:''}` });
        const markStarted = () => {
          if (!current() || started) return;
          started = true;
          if (startTimer !== undefined) runtime.clearTimer(startTimer);
          startTimer = undefined;
          report({ state: 'speaking', message: voiceName ? `읽는 중 · ${voiceName}` : '읽는 중' });
        };
        utterance.onstart = markStarted;
        utterance.onboundary = markStarted;
        utterance.onend = () => {
          if (!current()) return;
          if (!started) { retry(`음성 재생을 확인하지 못했습니다${voiceName ? ` · ${voiceName}` : ''}. 기기의 음성 설정을 확인한 뒤 다시 눌러 주세요.`); return; }
          generation++; clearTimers(); active = null;
          report({ state: 'idle', message: voiceName ? `읽기 완료 · ${voiceName}` : '읽기 완료' });
        };
        utterance.onerror = event => retry(speechFailure(event.error),!['not-allowed','audio-hardware','audio-busy'].includes(event.error));
        startTimer = runtime.setTimer(() => retry('음성 재생이 시작되지 않았습니다. 탭 음소거와 기기의 읽기 음성을 확인한 뒤 다시 눌러 주세요.'), 8000);
        // Even a stalled engine must not leave the button stuck in its playing state.
        endTimer = runtime.setTimer(() => { if (current()) fail('음성 읽기가 중단됐습니다. 읽어주기를 다시 눌러 주세요.'); }, Math.max(30000, text.length * 500));
        try { if (synthesis.paused) synthesis.resume(); synthesis.speak(utterance); }
        catch { retry(speechFailure('synthesis-failed')); }
      };
      attempt();
    } catch { fail(speechFailure('synthesis-failed')); }
  };
  const prepare = () => { try { synthesis.getVoices(); } catch { /* play() reports failures in the user's action. */ } };
  return { play, stop, prepare, dispose: () => stop(false) };
}

/** Read content, excluding HTML code, media markers and concealed answers. */
export function cardReadingText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,template,noscript,svg,canvas,audio,video,button,input,select,textarea,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
  doc.querySelectorAll<HTMLElement>('[style]').forEach(node => {
    if (node.style.display === 'none' || node.style.visibility === 'hidden') node.remove();
  });
  doc.querySelectorAll('br,hr').forEach(node => node.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr').forEach(node => node.append('\n'));
  return (doc.body.textContent || '').replace(/\[sound:[^\]]*\]|\[anki:play:[^\]]*\]|\[\[type:[\s\S]*?\]\]/gi, ' ').replace(/\s+/g, ' ').trim();
}
