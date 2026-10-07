import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';
import type { CardRow, Deck } from '../types';
import { CardFrame, Empty, ErrorNotice, errorText, escapeHtml, htmlText } from './ui';
import './deck-preview.css';

type PreviewResponse = { index:number; total:number; card:CardRow|null };
type Presentation = PreviewResponse & { side:'front'|'back'; key:number };

function cardHtml(card:CardRow, side:'front'|'back') {
  return card[side].replace(/\[\[type:([^\]]+)\]\]/g, (_,name:string) => {
    if (side === 'front') return `<input type="text" readonly placeholder="정답 입력" aria-label="${escapeHtml(name)} 정답 입력 미리보기">`;
    const index = card.fieldNames.indexOf(name.replace(/^cloze:/, ''));
    let answer = index >= 0 ? card.fields[index] : '';
    if (name.startsWith('cloze:')) {
      answer = Array.from(answer.matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g))
        .filter(match => Number(match[1]) === (card.ord || 0) + 1).map(match => match[2]).join(', ');
    }
    return `<span class="typeans">${escapeHtml(htmlText(answer).replace(/\[sound:[^\]]+\]/g, '').trim())}</span>`;
  });
}

export default function DeckPreview({deck,onClose}:{deck:Deck;onClose:()=>void}) {
  const [target,setTarget] = useState<Presentation|null>(null);
  const [shown,setShown] = useState<Presentation|null>(null);
  const [busy,setBusy] = useState(true), [error,setError] = useState('');
  const controller = useRef<AbortController|null>(null), sequence = useRef(0);
  const busyRef = useRef(true), targetRef = useRef(target), requestedIndex = useRef(0);
  targetRef.current = target;
  const working = (value:boolean) => {busyRef.current=value;setBusy(value);};

  const load = useCallback(async(index:number) => {
    controller.current?.abort();
    const request = new AbortController(), key = ++sequence.current;
    controller.current = request; requestedIndex.current = index;
    working(true); setError('');
    try {
      const result = await api<PreviewResponse>(`/decks/${deck.id}/preview?index=${index}`, {signal:request.signal});
      if (request.signal.aborted || key !== sequence.current) return;
      const next:Presentation = {...result, side:'front', key};
      targetRef.current = next; setTarget(next);
      if (!next.card) {setShown(next);working(false);}
    } catch (cause) {
      if (!request.signal.aborted && key === sequence.current) {setError(errorText(cause));working(false);}
    }
  }, [deck.id]);

  useEffect(() => {
    void load(0);
    return () => {controller.current?.abort();sequence.current++;};
  }, [load]);

  const flip = (side:'front'|'back') => {
    if (busyRef.current || !shown?.card || shown.side === side) return;
    working(true); setError('');
    const next = {...shown, side, key:++sequence.current};
    targetRef.current = next; setTarget(next);
  };
  const move = (delta:number) => {
    if (busyRef.current || !shown?.card) return;
    const index = shown.index + delta;
    if (index >= 0 && index < shown.total) void load(index);
  };
  const ready = (key?:string|number) => {
    const next = targetRef.current;
    if (next?.key !== key) return;
    setShown(next); working(false);
  };
  const failed = (key:string|number|undefined, message:string) => {
    if (targetRef.current?.key !== key) return;
    setError(message);working(false);
  };
  const active = shown || target;

  return <section className="deck-card-preview" aria-label={`${deck.name} 카드 미리보기`} aria-busy={busy}>
    <div className="deck-preview-description"><strong>{deck.name.replaceAll('::',' / ')}</strong><p>복습 기록과 일정은 변경되지 않습니다.</p></div>
    <div className="deck-preview-toolbar">
      <div className="deck-preview-sides" role="group" aria-label="미리보기 카드 면">
        <button aria-pressed={active?.side!=='back'} disabled={busy||!shown?.card} onClick={()=>flip('front')}>앞면</button>
        <button aria-pressed={active?.side==='back'} disabled={busy||!shown?.card} onClick={()=>flip('back')}>뒷면</button>
      </div>
      <span className="deck-preview-progress" role="status">{busy?'불러오는 중…':active?.card?`${active.index+1} / ${active.total}장`:''}</span>
    </div>
    {target?.card?<CardFrame html={cardHtml(target.card,target.side)} css={target.card.css} title={`덱 카드 ${target.side==='front'?'앞면':'뒷면'} 미리보기`} contentKey={target.key} onReady={ready} onError={failed} onEscape={onClose}/>:<div className="deck-preview-placeholder">{!busy&&!error?<Empty title="미리볼 카드가 없습니다">이 덱에 카드를 추가하면 미리볼 수 있습니다.</Empty>:<span>{busy?'카드를 불러오는 중…':'카드를 불러오지 못했습니다.'}</span>}</div>}
    {error&&<ErrorNotice error={error} onRetry={()=>void load(requestedIndex.current)}/>}
    <div className="deck-preview-details"><span>{active?.card?.modelName||'\u00a0'}</span>{active?.card&&active.card.deckName!==deck.name&&<span>{active.card.deckName.replaceAll('::',' / ')}</span>}</div>
    <div className="deck-preview-navigation">
      <button disabled={busy||!shown?.card||shown.index===0} onClick={()=>move(-1)}><ChevronLeft size={15}/> 이전 카드</button>
      <button disabled={busy||!shown?.card||shown.index>=shown.total-1} onClick={()=>move(1)}>다음 카드 <ChevronRight size={15}/></button>
    </div>
  </section>;
}
