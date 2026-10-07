import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw, Volume2 } from 'lucide-react';
import { CardFrame, Empty } from '../components/ui';
import { useMobileStudyLayout } from '../components/useMobileStudyLayout';
import { playSound } from '../features/sound';
import { createCardReader, type SpeechStatus } from '../features/speech';
import { cardHtml, DEMO_CARD_CSS, gradePractice, type DemoCard } from './collection';
import '../components/study-mobile.css';

export default function DemoStudy({name,cards,onAnswer,onUndo,onBack}:{name:string;cards:DemoCard[];onAnswer:(id:number,rating:number)=>void;onUndo:()=>void;onBack:()=>void}) {
  const [queue,setQueue]=useState(()=>cards.map(card=>card.id)),[revealed,setRevealed]=useState(false),[ready,setReady]=useState(false),[step,setStep]=useState(0),[undo,setUndo]=useState<number[][]>([]),[speech,setSpeech]=useState<SpeechStatus>({state:'idle',message:''});
  const card=cards.find(item=>item.id===queue[0]);
  const root=useRef<HTMLDivElement>(null),revealButton=useRef<HTMLButtonElement>(null),reader=useRef<ReturnType<typeof createCardReader>|null>(null);
  useMobileStudyLayout(root,!!card);
  useEffect(()=>{
    if(!('speechSynthesis' in window))return;
    const instance=createCardReader({synthesis:window.speechSynthesis,createUtterance:text=>new SpeechSynthesisUtterance(text),setTimer:(fn,ms)=>window.setTimeout(fn,ms),clearTimer:id=>window.clearTimeout(id)},setSpeech);
    reader.current=instance;instance.prepare();window.speechSynthesis.addEventListener('voiceschanged',instance.prepare);
    return()=>{instance.dispose();reader.current=null;window.speechSynthesis.removeEventListener('voiceschanged',instance.prepare);};
  },[]);
  useEffect(()=>{reader.current?.stop();},[card?.id,revealed]);
  const reveal=useCallback(()=>{if(!card||revealed||!ready)return;setReady(false);setRevealed(true);playSound('reveal');},[card,revealed,ready]);
  const grade=useCallback((rating:number)=>{
    if(!card||!revealed||!ready)return;
    setReady(false);setUndo(history=>[...history,queue]);setQueue(gradePractice(queue,rating));setRevealed(false);setStep(n=>n+1);onAnswer(card.id,rating);playSound((['again','hard','good','easy'] as const)[rating-1]);
  },[card,queue,revealed,ready,onAnswer]);
  const back=useCallback(()=>{if(!undo.length)return;setQueue(undo.at(-1)!);setUndo(undo.slice(0,-1));setReady(false);setRevealed(false);setStep(n=>n+1);onUndo();},[undo,onUndo]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]'))return;
      if(event.code==='Space'){event.preventDefault();reveal();}
      if(/^[1-4]$/.test(event.key)){event.preventDefault();grade(Number(event.key));}
      if(event.key.toLowerCase()==='z'){event.preventDefault();back();}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[reveal,grade,back]);
  const contentKey=`${step}-${revealed}`;
  const frameReady=useCallback(()=>{setReady(true);if(!revealed)revealButton.current?.focus({preventScroll:true});},[contentKey]);
  const restart=()=>{setQueue(cards.map(item=>item.id));setUndo([]);setRevealed(false);setReady(false);setStep(n=>n+1);};
  return <div className="study-view demo-study" ref={root} tabIndex={-1}>
    <div className="study-heading"><button className="text-button" onClick={onBack}><ArrowLeft size={14}/> 덱으로</button><span>복습 화면 체험</span><span>{queue.length}장 남음</span></div>
    <h1 className="demo-study-name">{name}</h1>
    <p className="demo-study-note">다시·어려움은 뒤에서 재등장합니다. 실제 복습 날짜는 계산하지 않습니다.</p>
    {card?<>
      <div className="study-card-label"><span>{card.kind==='cloze'?'문장 빈칸':card.kind==='diagram'?'이미지 가리기 샘플':'기본 카드'}</span><span>{revealed?'정답':'질문'}</span></div>
      <CardFrame html={cardHtml(card,revealed)} css={DEMO_CARD_CSS} contentKey={contentKey} onReady={frameReady}/>
      <div className="answer-area">
        <div className="study-tools"><button onClick={()=>{const doc=new DOMParser().parseFromString(cardHtml(card,revealed),'text/html');reader.current?.play(doc.body.textContent||'');}} disabled={!reader.current}><Volume2 size={14}/> 읽어주기</button><span aria-live="polite">{speech.state==='error'?speech.message:speech.state==='speaking'?'읽는 중…':''}</span></div>
        {!revealed?<button ref={revealButton} className="primary demo-reveal" disabled={!ready} onClick={reveal}>정답 보기 <kbd>Space</kbd></button>:<div className="rating-grid">{['다시','어려움','알맞음','쉬움'].map((label,index)=><button key={label} className={`rating rating-${index+1}`} disabled={!ready} onClick={()=>grade(index+1)}><span className="rating-interval">{index<2?'뒤에서 한 번 더':'이 연습에서 완료'}</span><strong>{label}</strong><kbd>{index+1}</kbd></button>)}</div>}
      </div>
    </>:<Empty title="샘플 복습을 마쳤습니다" action={<><button className="primary" onClick={restart}>한 번 더 체험</button><button onClick={onBack}>덱으로</button></>}>기록은 이 브라우저에 저장됩니다.</Empty>}
    <div className="study-footer"><button className="text-button" disabled={!undo.length} onClick={back}><RotateCcw size={13}/> 되돌리기 <kbd>Z</kbd></button><span>체험용 반복 순서 · Anki 일정 계산 없음</span></div>
  </div>;
}
