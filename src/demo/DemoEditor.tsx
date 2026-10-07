import { useState } from 'react';
import ClozeEditor from '../components/ClozeEditor';
import { CardFrame, ErrorNotice } from '../components/ui';
import { cardHtml, DEMO_CARD_CSS, type DemoCollection } from './collection';
import { parseCloze } from '../features/cloze-editor';

export type CardDraft = {deckId:number;kind:'basic'|'cloze';front:string;back:string};
export default function DemoEditor({decks,draft,onChange,onSave,onUiDirty}:{decks:DemoCollection['decks'];draft:CardDraft;onChange:(draft:CardDraft)=>void;onSave:()=>void;onUiDirty:(dirty:boolean)=>void}) {
  const [answer,setAnswer]=useState(false),[previewGroup,setPreviewGroup]=useState(1);
  const patch=(value:Partial<CardDraft>)=>onChange({...draft,...value});
  const parsed=parseCloze(draft.front),groups=draft.kind==='cloze'&&parsed.supported?[...new Set(parsed.document.blanks.map(blank=>blank.group))]:[1];
  const current=groups.includes(previewGroup)?previewGroup:groups[0]||1;
  return <div className="demo-editor"><div className="page-heading"><h1>카드 추가</h1><span className="subtle">이 브라우저에 저장</span></div>
    {!decks.length?<ErrorNotice error="내 덱에서 덱을 먼저 만드세요."/>:<>
      <div className="form-grid two"><label>덱<select value={draft.deckId} onChange={e=>patch({deckId:Number(e.target.value)})}>{decks.map(deck=><option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><label>카드 구성<select value={draft.kind} onChange={e=>patch({kind:e.target.value as CardDraft['kind']})}><option value="basic">질문 → 정답</option><option value="cloze">문장에서 빈칸 만들기</option></select></label></div>
      <div className="demo-editor-columns"><section>
        {draft.kind==='basic'?<label className="field-label">질문<input autoComplete="off" value={draft.front} maxLength={10000} placeholder="예: evidence" onChange={e=>patch({front:e.target.value})}/></label>:<ClozeEditor value={draft.front} onChange={front=>patch({front})} name="빈칸" disabled={false} onFocus={()=>{}} onSave={onSave} areaRef={()=>{}} onDraftChange={onUiDirty}/>}
        <label className="field-label">{draft.kind==='basic'?'정답':'추가 설명 (선택)'}<textarea value={draft.back} maxLength={10000} placeholder={draft.kind==='basic'?'예: 증거':'정답과 함께 보여줄 설명'} onChange={e=>patch({back:e.target.value})}/></label>
        <p className="hint">데모 입력은 텍스트로 표시됩니다. HTML 템플릿 편집과 APKG 가져오기는 설치판에서 사용할 수 있습니다.</p>
      </section><section className="demo-editor-preview"><div className="section-heading"><h2>미리보기</h2>{groups.length>1&&<select aria-label="미리볼 빈칸" value={current} onChange={e=>setPreviewGroup(Number(e.target.value))}>{groups.map(group=><option key={group} value={group}>문제 {group}</option>)}</select>}</div><div className="demo-preview-tabs"><button aria-pressed={!answer} onClick={()=>setAnswer(false)}>앞면</button><button aria-pressed={answer} onClick={()=>setAnswer(true)}>뒷면</button></div><CardFrame html={draft.front?cardHtml({id:0,...draft,group:current},answer):'<span>입력한 내용이 여기에 표시됩니다.</span>'} css={DEMO_CARD_CSS}/></section></div>
      <div className="form-footer"><span className="subtle">빈칸은 같은 문제 번호끼리 함께 가려집니다.</span><button className="primary" disabled={!draft.front.trim()} onClick={onSave}>카드 저장</button></div>
    </>}
  </div>;
}
