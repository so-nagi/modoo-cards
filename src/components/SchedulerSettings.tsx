import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Busy, ErrorNotice, errorText } from './ui';

type Preferences = { learnAheadMinutes: number };

export default function SchedulerSettings() {
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [minutes, setMinutes] = useState('20');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const value = await api<Preferences>('/scheduler/preferences', { signal });
      if (signal?.aborted) return;
      setSaved(value); setMinutes(String(value.learnAheadMinutes));
    } catch (cause) { if (!signal?.aborted) setError(errorText(cause)); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const value = Number(minutes);
  const valid = minutes.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 60;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<Preferences>('/scheduler/preferences', { method: 'PUT', body: JSON.stringify({ learnAheadMinutes: value }) });
      setSaved(result); setMinutes(String(result.learnAheadMinutes)); setMessage('모든 덱의 미리 출제 설정을 저장했습니다.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <section className="settings-section">
    <h2>학습 카드 미리 출제</h2>
    <p className="fine-print">현재 풀 카드가 없을 때, 예정 시간보다 일찍 학습 카드를 표시할 범위입니다. 모든 덱에 적용됩니다.</p>
    {error && <ErrorNotice error={error} onRetry={saved ? undefined : () => void load()} />}
    {!saved ? !error && <Busy /> : <>
      <label className="field-label">미리 출제 범위 (분)
        <input type="number" min={0} max={60} step={1} value={minutes} disabled={busy} onChange={event => { setMinutes(event.target.value); setMessage(''); }} />
        <small>Anki 기본값은 20분입니다. 0분을 선택하면 예정 시간이 된 카드만 표시합니다.</small>
      </label>
      <p className="fine-print">지금 풀 새 카드와 복습 카드를 마친 뒤, 이 범위 안의 ‘다시’·‘어려움’ 학습 카드가 재출제됩니다. 카드별 간격과 순서는 Anki가 계산합니다.</p>
      <button disabled={busy || !valid || value === saved.learnAheadMinutes} onClick={() => void save()}>{busy ? '저장 중…' : '미리 출제 설정 저장'}</button>
      {message && <p className="success-notice" role="status">{message}</p>}
    </>}
  </section>;
}
