import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Clock3, Flag, Maximize2, Pause, RotateCcw, Volume2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { playSound } from '../features/sound';
import { cardReadingText, createCardReader, type SpeechStatus } from '../features/speech';
import '../features/speech.css';
import type { CardRow, Deck, Settings, StudyCard } from '../types';
import { Busy, CardFrame, Empty, ErrorNotice, errorText, htmlText } from './ui';
import { useMobileStudyLayout } from './useMobileStudyLayout';
import './study-mobile.css';

type Counts = { new: number; learn: number; review: number };
type Waiting = { count: number; nextDueAt: number | null };
type DailyLimits = { new: boolean; review: boolean };
type StudyResponse = { card: StudyCard | null; counts: Counts; waiting?: Waiting; limits?: DailyLimits };
type TypedField = { name: string; expected: string };
type Presentation = {
  id: number;
  card: StudyCard | null;
  counts: Counts;
  waiting: Waiting;
  limits: DailyLimits;
  typedFields: TypedField[];
  typed: Record<string, string>;
  revealed: boolean;
  flagged: boolean;
  resetTimer: boolean;
};
type AnswerRequest = { cardId: number; rating: number; token: string; requestId: string; elapsedMs: number };
const emptyCounts: Counts = { new: 0, learn: 0, review: 0 };
const emptyWaiting: Waiting = { count: 0, nextDueAt: null };
const noLimits: DailyLimits = { new: false, review: false };

function typeFields(detail: CardRow, markers: string[]): TypedField[] {
  return markers.map(name => {
    const index = detail.fieldNames.indexOf(name.replace(/^cloze:/, ''));
    let expected = index >= 0 ? detail.fields[index] : '';
    if (name.startsWith('cloze:')) {
      const wanted = (detail.ord || 0) + 1;
      expected = Array.from(expected.matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g))
        .filter(match => Number(match[1]) === wanted).map(match => match[2]).join(', ');
    }
    return { name, expected: htmlText(expected).replace(/\[sound:[^\]]+\]/g, '').trim() };
  });
}

export default function Study({deck,settings,onBack,onChange,onZen}:{deck:Deck;settings:Settings;onBack:()=>void;onChange:()=>Promise<void>;onZen:()=>void}) {
  const [visible,setVisible] = useState<Presentation|null>(null);
  const [target,setTarget] = useState<Presentation|null>(null);
  const [phase,setPhase] = useState<'idle'|'saving'|'fetching'|'rendering'>('fetching');
  const [reloadRequired,setReloadRequired] = useState(false);
  const [error,setError] = useState('');
  const [checkMessage,setCheckMessage] = useState('');
  const [answered,setAnswered] = useState(0);
  const [seconds,setSeconds] = useState(0);
  const [speechStatus,setSpeechStatus] = useState<SpeechStatus>({state:'idle',message:''});
  const reader = useRef<ReturnType<typeof createCardReader>|null>(null);
  const visibleRef = useRef(visible), targetRef = useRef(target);
  visibleRef.current = visible; targetRef.current = target;
  const live = useRef(true), busyRef = useRef(true), reloadRef = useRef(false);
  const started = useRef(Date.now()), sessionStarted = useRef(Date.now());
  const presentationSequence = useRef(0), requestSequence = useRef(0);
  const fetchController = useRef<AbortController|null>(null), mutationController = useRef<AbortController|null>(null);
  const pendingAnswer = useRef<AnswerRequest|null>(null);
  const rootRef = useRef<HTMLDivElement>(null), revealRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    const instance = createCardReader({synthesis:window.speechSynthesis,createUtterance:text=>new SpeechSynthesisUtterance(text),setTimer:(callback,delay)=>window.setTimeout(callback,delay),clearTimer:timer=>window.clearTimeout(timer)},setSpeechStatus);
    reader.current = instance; instance.prepare();
    window.speechSynthesis.addEventListener('voiceschanged',instance.prepare);
    return () => { window.speechSynthesis.removeEventListener('voiceschanged',instance.prepare); instance.dispose(); reader.current = null; };
  }, []);
  useEffect(() => { reader.current?.stop(); }, [visible?.card?.id,visible?.revealed]);

  const requireReload = useCallback((required:boolean) => {
    reloadRef.current = required;
    setReloadRequired(required);
  }, []);

  // Keep the visible card while data loads. CardFrame commits its replacement
  // only when the next isolated document has loaded and reached a paint boundary.
  const loadNext = useCallback(async(manual = false) => {
    fetchController.current?.abort();
    const controller = new AbortController();
    fetchController.current = controller;
    const request = ++requestSequence.current;
    busyRef.current = true;
    setPhase('fetching'); setError(''); setCheckMessage('');
    try {
      const result = await api<StudyResponse>(`/study?deckId=${deck.id}`, {signal:controller.signal});
      if (!live.current || controller.signal.aborted || request !== requestSequence.current) return;
      let typedFields:TypedField[] = [];
      let flagged = false;
      if (result.card) {
        const markers = [...new Set(Array.from(result.card.front.matchAll(/\[\[type:([^\]]+)\]\]/g), match => match[1]))];
        if (markers.length) {
          const detail = await api<CardRow>(`/cards/${result.card.id}`, {signal:controller.signal});
          if (!live.current || controller.signal.aborted || request !== requestSequence.current) return;
          typedFields = typeFields(detail, markers); flagged = detail.flag > 0;
        }
      }
      const next:Presentation = {id:++presentationSequence.current,card:result.card,counts:result.counts,waiting:result.waiting||emptyWaiting,limits:result.limits||noLimits,typedFields,typed:{},revealed:false,flagged,resetTimer:true};
      if (!next.card) {
        if (manual) {
          const checkedAt = new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
          const resultMessage = next.waiting.count > 0
            ? '아직 출제 시간이 되지 않았습니다.'
            : next.limits.new || next.limits.review ? '오늘 학습 한도에 도달했습니다.' : '지금 출제할 카드가 없습니다.';
          setCheckMessage(`${checkedAt} 확인 완료 · ${resultMessage}`);
        }
        visibleRef.current = next; targetRef.current = null;
        setVisible(next); setTarget(null); setPhase('idle');
        busyRef.current = false; requireReload(false);
      } else {
        targetRef.current = next; setTarget(next); setPhase('rendering');
      }
    } catch (cause) {
      if (!live.current || controller.signal.aborted || request !== requestSequence.current) return;
      setError(`${reloadRef.current?'다음 카드를 불러오지 못했습니다. ':''}${errorText(cause)}`);
      setPhase('idle'); busyRef.current = false;
    }
  }, [deck.id,requireReload]);

  useEffect(() => {
    live.current = true; void loadNext();
    const interval = window.setInterval(() => setSeconds(Math.floor((Date.now()-sessionStarted.current)/1000)), 1000);
    return () => {
      live.current = false; requestSequence.current++;
      fetchController.current?.abort(); mutationController.current?.abort();
      window.clearInterval(interval);
    };
  }, [loadNext]);

  const frameReady = useCallback((key?:string|number) => {
    const next = targetRef.current;
    if (!live.current || !next || next.id !== key) return;
    const active = document.activeElement;
    const shouldFocus = active === document.body || !!(active && rootRef.current?.contains(active));
    visibleRef.current = next; targetRef.current = null;
    setVisible(next); setTarget(null); setPhase('idle');
    busyRef.current = false; requireReload(false);
    if (next.resetTimer) started.current = Date.now();
    if (shouldFocus) requestAnimationFrame(() => {
      if (!live.current || visibleRef.current?.id !== next.id) return;
      const input = !next.revealed ? rootRef.current?.querySelector<HTMLInputElement>('.typed-answer-area input') : null;
      const destination = input || (!next.revealed ? revealRef.current : rootRef.current);
      destination?.focus({preventScroll:true});
    });
  }, [requireReload]);

  const frameFailed = useCallback((key:string|number|undefined,message:string) => {
    if (!live.current || targetRef.current?.id !== key) return;
    targetRef.current = null; setTarget(null);
    setError(message); setPhase('idle'); busyRef.current = false; requireReload(true);
  }, [requireReload]);

  const refreshStats = useCallback((message:string) => {
    void onChange().catch(cause => {if(live.current)setError(`${message} ${errorText(cause)}`);});
  }, [onChange]);

  const reveal = useCallback(() => {
    const current = visibleRef.current;
    if (!current?.card || current.revealed || busyRef.current || reloadRef.current) return;
    const next = {...current,id:++presentationSequence.current,revealed:true,resetTimer:false};
    busyRef.current = true; setPhase('rendering');
    targetRef.current = next; setTarget(next); playSound('reveal');
  }, []);

  const answer = useCallback(async(rating:number) => {
    const current = visibleRef.current;
    if (!current?.card || !current.revealed || busyRef.current || reloadRef.current) return;
    const card = current.card;
    if (pendingAnswer.current?.cardId === card.id && pendingAnswer.current.rating !== rating) {
      setError('이전 답변의 저장 여부를 확인해야 합니다. 이전에 선택한 답변을 다시 눌러 주세요.'); return;
    }
    if (!pendingAnswer.current || pendingAnswer.current.cardId !== card.id) {
      pendingAnswer.current = {cardId:card.id,rating,token:card.token,requestId:crypto.randomUUID(),elapsedMs:Date.now()-started.current};
    }
    busyRef.current = true; setPhase('saving'); setError('');
    // Start the click feedback before the request leaves the keyboard/click gesture.
    playSound((['again','hard','good','easy'] as const)[rating-1]);
    const controller = new AbortController(); mutationController.current = controller;
    let transitioning = false;
    try {
      await api('/answer', {method:'POST',body:JSON.stringify(pendingAnswer.current),signal:controller.signal});
      if (!live.current || controller.signal.aborted) return;
      pendingAnswer.current = null;
      setAnswered(value => value+1); requireReload(true); transitioning = true;
      refreshStats('답변은 저장됐지만 학습 통계를 갱신하지 못했습니다.');
      await loadNext();
    } catch (cause) {
      if (!live.current || controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 409 && cause.message.startsWith('다른 화면에서 자료가 변경')) {
        pendingAnswer.current = null; requireReload(true); transitioning = true; await loadNext();
      } else setError(errorText(cause));
    } finally {
      if (live.current && !transitioning) {setPhase('idle'); busyRef.current = false;}
    }
  }, [loadNext,refreshStats,requireReload]);

  const undo = useCallback(async() => {
    if (busyRef.current) return;
    if (pendingAnswer.current) {
      setError('답변의 저장 여부를 확인해야 합니다. 다시 시도를 눌러 확인한 뒤 되돌릴 수 있습니다.'); return;
    }
    busyRef.current = true; setPhase('saving'); setError('');
    const controller = new AbortController(); mutationController.current = controller;
    let transitioning = false;
    try {
      await api('/undo', {method:'POST',signal:controller.signal});
      if (!live.current || controller.signal.aborted) return;
      pendingAnswer.current = null; setAnswered(value => Math.max(0,value-1)); requireReload(true);
      playSound('tap'); transitioning = true;
      refreshStats('작업을 되돌렸지만 학습 통계를 갱신하지 못했습니다.');
      await loadNext();
    } catch (cause) {if(live.current && !controller.signal.aborted)setError(errorText(cause));}
    finally {if(live.current && !transitioning){setPhase('idle');busyRef.current=false;}}
  }, [loadNext,refreshStats,requireReload]);

  const mutate = async(action:'flag'|'suspend'|'bury') => {
    const current = visibleRef.current;
    if (!current?.card || busyRef.current || reloadRef.current) return;
    if (pendingAnswer.current) {
      setError('답변의 저장 여부를 확인해야 합니다. 다시 시도를 눌러 확인한 뒤 카드를 변경할 수 있습니다.'); return;
    }
    busyRef.current = true; setPhase('saving'); setError('');
    const controller = new AbortController(); mutationController.current = controller;
    let transitioning = false;
    try {
      await api('/cards/action',{method:'POST',body:JSON.stringify({ids:[current.card.id],action,...(action==='flag'?{value:current.flagged?0:1}:{})}),signal:controller.signal});
      if (!live.current || controller.signal.aborted) return;
      playSound('tap');
      if (action === 'flag') {
        const next = {...current,flagged:!current.flagged}; visibleRef.current = next; setVisible(next);
      } else {
        requireReload(true); transitioning = true;
        refreshStats('카드를 변경했지만 학습 통계를 갱신하지 못했습니다.'); await loadNext();
      }
    } catch (cause) {if(live.current && !controller.signal.aborted)setError(errorText(cause));}
    finally {if(live.current && !transitioning){setPhase('idle');busyRef.current=false;}}
  };

  useEffect(() => {
    const handle = (event:KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (event.repeat || element.matches('input,textarea,select,[contenteditable="true"]') || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.code === 'Space') {event.preventDefault();reveal();}
      if (/^[1-4]$/.test(event.key)) {event.preventDefault();void answer(Number(event.key));}
      if (event.key.toLowerCase() === 'z') {event.preventDefault();void undo();}
    };
    window.addEventListener('keydown',handle);
    return () => window.removeEventListener('keydown',handle);
  }, [reveal,answer,undo]);

  const speak = () => {
    const current = visibleRef.current;
    if (!current?.card || busyRef.current || reloadRef.current) return;
    if (!reader.current) {setSpeechStatus({state:'error',message:'이 브라우저에서는 음성 읽기를 지원하지 않습니다.'});return;}
    if (speechStatus.state==='loading'||speechStatus.state==='speaking') {reader.current.stop();return;}
    reader.current.play(cardReadingText(current.revealed?current.card.back:current.card.front));
  };
  const retry = () => {
    if (busyRef.current) return;
    // Resolve an uncertain save before asking for another scheduling turn. The
    // same card ID may legitimately appear again, but its answer is a new turn.
    if (pendingAnswer.current) void answer(pendingAnswer.current.rating);
    else void loadNext(true);
  };
  // Completion has no iframe to retain. An undo can therefore mount its next
  // card immediately, while all card-to-card transitions retain the old card.
  const shown = visible?.card ? visible : target || visible, frame = target || visible;
  const card = shown?.card, counts = shown?.counts || emptyCounts;
  const waiting = shown?.waiting || emptyWaiting, limits = shown?.limits || noLimits;
  const waitingForStudy = waiting.count > 0, limitReached = limits.new || limits.review;
  const nextStudyTime = waitingForStudy && waiting.nextDueAt !== null
    ? new Date(waiting.nextDueAt * 1000).toLocaleString('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})
    : '';
  const revealed = shown?.revealed || false, blocked = phase !== 'idle' || reloadRequired;
  // Future learning cards are separate from the native queue's available counts.
  const remaining = counts.new+counts.learn+counts.review+waiting.count;
  useMobileStudyLayout(rootRef, !!card);

  return <div className="study-view" ref={rootRef} tabIndex={-1} aria-busy={phase!=='idle'}>
    <div className="page-heading"><button className="text-button" onClick={onBack}><ArrowLeft size={14}/> 덱으로</button><span className="eyebrow">복습</span><button className="icon-button" onClick={onZen} aria-label={settings.zen?'집중 모드 해제':'집중 모드'}><Maximize2 size={15}/></button></div>
    <h1 className="study-deck-name">{deck.name.replaceAll('::',' / ')}</h1>
    <div className="study-meta"><span className="count-new">새 카드 {counts.new}</span><span className="count-learn">학습 {counts.learn}</span><span className="count-review">복습 {counts.review}</span></div>
    <div className="progress-track"><div style={{width:`${answered+remaining?answered/(answered+remaining)*100:0}%`}}/></div>
    {error&&<ErrorNotice error={error} onRetry={retry}/>}
    {!shown?error?<Empty title="카드를 불러오지 못했습니다"/>:<Busy label="카드를 불러오는 중…"/>:!card?<Empty
      icon={waitingForStudy?<Clock3 size={28}/>:limitReached?<Pause size={28}/>:<Check size={28}/>}
      title={waitingForStudy?'다음 학습 시간 대기':limitReached?'오늘 학습 한도 도달':'현재 복습 완료'}
      action={<div style={{display:'flex',justifyContent:'center',gap:8,flexWrap:'wrap'}}><button className={waitingForStudy||limitReached?'primary':undefined} onClick={retry} disabled={phase!=='idle'}>{phase==='fetching'?'확인 중…':'카드 다시 확인'}</button><button className={!waitingForStudy&&!limitReached?'primary':undefined} onClick={onBack}>덱으로 돌아가기</button></div>}
    >
      {waitingForStudy?<>{waiting.count}장의 학습 카드가 다음 학습 시간을 기다리고 있습니다.<br/>{nextStudyTime?<>다음 학습: {nextStudyTime}<br/></>:<>예정 시간이 되면 카드를 다시 확인해 주세요.<br/></>}</>:!limitReached?<>다음 일정에 따라 카드가 표시됩니다.<br/></>:null}
      {limits.new&&<>하루 새 카드 한도에 도달했습니다.<br/></>}
      {limits.review&&<>하루 복습 한도에 도달했습니다.<br/></>}
      {limitReached&&<>덱 옵션에서 하루 학습 한도를 변경할 수 있습니다.<br/></>}
      이번 복습: {answered}회 평가
      <span className="study-check-status" role="status" style={{display:'block',minHeight:'1.5em',marginTop:8}}>{phase==='fetching'?'출제 가능한 카드를 확인하고 있습니다…':checkMessage || '\u00a0'}</span>
    </Empty>:<>
      <div className="card-topline"><span>{card.modelName}</span><span>{revealed?'정답':'질문'}</span></div>
      <CardFrame html={((frame?.revealed?frame.card?.back:frame?.card?.front)||'').replace(/\[\[type:[^\]]+\]\]/g,'')} css={frame?.card?.css} title={frame?.revealed?'카드 정답':'카드 질문'} contentKey={frame?.id} onReady={frameReady} onError={frameFailed}/>
      {!!shown.typedFields.length&&<div className="typed-answer-area">{shown.typedFields.map(field=><label key={field.name}><span>{field.name.replace(/^cloze:/,'')} 입력</span>{!revealed?<input aria-label={`${field.name} 정답 입력`} autoComplete="off" spellCheck={false} disabled={blocked} value={shown.typed[field.name]||''} onChange={event=>setVisible(current=>{if(!current)return current;const next={...current,typed:{...current.typed,[field.name]:event.target.value}};visibleRef.current=next;return next;})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();reveal();}}} placeholder="답을 입력하고 Enter를 누르세요"/>:<div className={`typed-comparison ${(shown.typed[field.name]||'').normalize('NFC').trim()===field.expected.normalize('NFC').trim()?'matches':'differs'}`}><div><small>내 답</small><strong>{shown.typed[field.name]||'(입력하지 않음)'}</strong></div><div><small>정답</small><strong>{field.expected||'(빈 필드)'}</strong></div></div>}</label>)}</div>}
      <div className="study-tools"><button className="study-read-button" onClick={speak} disabled={blocked} aria-label={speechStatus.state==='loading'||speechStatus.state==='speaking'?'읽기 중지':'읽어주기'}>{speechStatus.state==='loading'||speechStatus.state==='speaking'?<Pause size={15}/>:<Volume2 size={15}/>} {speechStatus.state==='loading'||speechStatus.state==='speaking'?'읽기 중지':'읽어주기'}</button><button aria-pressed={shown.flagged} onClick={()=>void mutate('flag')} disabled={blocked}><Flag size={14} fill={shown.flagged?'currentColor':'none'}/> 표시</button><button onClick={()=>void mutate('bury')} disabled={blocked}>오늘 숨기기</button><button onClick={()=>void mutate('suspend')} disabled={blocked}><Pause size={14}/> 중단</button></div>
      <p className="study-speech-status" role="status" data-state={speechStatus.state}>{speechStatus.message || '\u00a0'}</p>
      <div className="answer-area">{!revealed?<button ref={revealRef} className="primary reveal-button" onClick={reveal} disabled={blocked}>정답 보기 <kbd>Space</kbd></button>:<div className="rating-grid">{card.buttons.map(button=><button key={button.rating} className={`rating rating-${button.rating}`} onClick={()=>void answer(button.rating)} disabled={blocked}><span className="rating-interval">{button.interval}</span><strong>{(['다시','어려움','알맞음','쉬움'])[button.rating-1]||button.label}</strong><kbd>{button.rating}</kbd></button>)}</div>}<span className="study-transfer-status" role="status">{phase==='saving'?'저장 중…':phase==='fetching'?'다음 카드 준비 중…':''}</span></div>
    </>}
    <footer className="study-footer"><button className="text-button" disabled={phase!=='idle'} onClick={()=>void undo()}><RotateCcw size={14}/> 되돌리기 <kbd>Z</kbd></button><span>{answered}회 평가 · {Math.floor(seconds/60)}분 {seconds%60}초{settings.remainingTime&&card&&answered>0&&remaining>0?` · 약 ${Math.max(1,Math.ceil(seconds/answered*remaining/60))}분 남음`:''}</span></footer>
    <p className="fine-print">카드 안에 입력 중이면 입력창 밖을 누른 뒤 단축키를 사용할 수 있습니다.</p>
  </div>;
}
