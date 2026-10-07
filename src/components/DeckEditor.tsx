import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Pencil, Plus } from 'lucide-react';
import { api } from '../api';
import type { Deck } from '../types';
import { playSound } from '../features/sound';
import HtmlFieldEditor from './HtmlFieldEditor';
import { Busy, ErrorNotice, Modal, errorText } from './ui';
import { useDiscardGuard } from './useDiscardGuard';
import './deck-editor.css';

type DeckDetails = Deck & { description: string; canEditDescription: boolean; descriptionFormat: 'html'|'markdown' };
type Props = { deck: Deck; onClose:()=>void; onSaved:()=>Promise<void>; onCards:()=>void; onAdd:()=>void };

export default function DeckEditor({deck,onClose,onSaved,onCards,onAdd}:Props) {
  const [original,setOriginal]=useState<DeckDetails|null>(null),[name,setName]=useState(deck.name),[description,setDescription]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
  const guard=useDiscardGuard(),busyRef=useRef(false),live=useRef(true);
  const dirty=!!original&&(name!==original.name||description!==original.description);
  const leave=(action:()=>void)=>guard.request(action,dirty,busyRef.current);
  useEffect(()=>{
    live.current=true;
    const controller=new AbortController();setLoading(true);setError('');
    void api<DeckDetails>(`/decks/${deck.id}`,{signal:controller.signal}).then(result=>{
      if(controller.signal.aborted)return;
      setOriginal(result);setName(result.name);setDescription(result.description);
    }).catch(cause=>{if(!controller.signal.aborted)setError(errorText(cause));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>{live.current=false;controller.abort();};
  },[deck.id,retry]);
  const save=async()=>{
    if(busyRef.current||!original||!dirty||!name.trim())return;
    busyRef.current=true;setBusy(true);setError('');setNotice('');
    try{
      const result=await api<DeckDetails>(`/decks/${deck.id}`,{method:'PATCH',body:JSON.stringify({name:name.trim(),...(original.canEditDescription?{description,descriptionFormat:original.descriptionFormat}:{})})});
      if(!live.current)return;
      setOriginal(result);setName(result.name);setDescription(result.description);playSound('save');setNotice('덱 정보를 저장했습니다.');
      try{await onSaved();}catch(cause){if(live.current)setError(`저장은 완료했지만 덱 목록을 갱신하지 못했습니다. ${errorText(cause)}`);}
    }catch(cause){if(live.current)setError(errorText(cause));}
    finally{busyRef.current=false;if(live.current)setBusy(false);}
  };
  return <>
    <Modal title="덱 편집" className="deck-editor-modal" onClose={()=>leave(onClose)}>
      {loading?<Busy label="덱 정보를 불러오는 중…"/>:original?<>
        <form className="deck-editor-form" onSubmit={event=>{event.preventDefault();void save();}} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void save();}}}>
          <label className="field-label">덱 이름<input autoFocus value={name} disabled={busy} maxLength={200} onChange={event=>{setName(event.target.value);setNotice('');}} placeholder="예: 영어::독해"/><small>상위 덱::하위 덱 형식으로 덱을 배치할 수 있습니다.</small></label>
          {original.canEditDescription?<div className="deck-description-field"><span className="field-label">설명 <small>선택</small></span>
            {original.descriptionFormat==='markdown'?<><textarea aria-label="덱 설명" rows={4} value={description} disabled={busy} placeholder="이 덱에 담은 내용이나 학습 범위를 입력하세요." onChange={event=>{setDescription(event.target.value);setNotice('');}}/><small className="subtle">가져온 덱의 Markdown 형식을 유지합니다.</small></>:<HtmlFieldEditor name="덱 설명" value={description} onChange={value=>{setDescription(value);setNotice('');}} rows={4} disabled={busy} placeholder="이 덱에 담은 내용이나 학습 범위를 입력하세요."/>}
          </div>:<p className="hint">필터 덱은 이름을 수정할 수 있습니다. 카드는 원래 덱의 복습 정보를 유지합니다.</p>}
          {error&&<ErrorNotice error={error}/>}{notice&&<p className="deck-editor-notice" role="status">{notice}</p>}
          <div className="form-footer"><button type="button" disabled={busy} onClick={()=>leave(onClose)}>닫기</button><button className="primary" type="submit" disabled={busy||!dirty||!name.trim()}>{busy?'저장 중…':'변경 저장'}</button></div>
        </form>
        <section className="deck-editor-tools" aria-label="덱 카드 관리"><h3>카드 관리</h3><button disabled={busy} onClick={()=>leave(onCards)}><Pencil size={15}/><span><strong>카드 편집</strong><small>이 덱과 하위 덱의 카드를 검색하고 수정합니다.</small></span><ArrowRight size={15}/></button>{!deck.filtered&&<button disabled={busy} onClick={()=>leave(onAdd)}><Plus size={15}/><span><strong>카드 추가</strong><small>이 덱에 새 카드를 만듭니다.</small></span><ArrowRight size={15}/></button>}</section>
      </>:<ErrorNotice error={error||'덱 정보를 불러오지 못했습니다.'} onRetry={()=>setRetry(value=>value+1)}/>}
    </Modal>
    {guard.confirmation}
  </>;
}
