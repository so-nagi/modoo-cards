import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { Busy, ErrorNotice, Modal } from '../../src/components/ui';
import { useDiscardGuard } from '../../src/components/useDiscardGuard';
import Occlusion from '../../src/components/Occlusion';
import type { Deck, Skin } from '../../src/types';
import '../../src/styles.css';

// Development-only component harness. It exercises the real component with a
// local QA account and explicit fixture prop; no injected UI events/state.
function Harness(){
 const auth=useAuth(),[input,setInput]=useState<{deck:Deck;image:{filename:string;url:string}}|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[saved,setSaved]=useState(false),[skin,setSkin]=useState<Skin>('classic');
 const dirty=useRef(false),busy=useRef(false),guard=useDiscardGuard();
 useEffect(()=>{if(auth.ready&&auth.config?.authMode==='local')fetch('/tests/browser/qa-input.json').then(response=>response.json()).then(setInput).catch(cause=>setError(String(cause)));},[auth.ready,auth.config]);
 const close=()=>guard.request(()=>setOpen(false),dirty.current,busy.current);
 return <div className={`app-shell skin-${skin}`} data-theme="light" style={{minHeight:'100vh',padding:24}}>
 <h1>이미지 편집 로컬 검증</h1><label>스킨<select value={skin} onChange={event=>setSkin(event.target.value as Skin)}>{['classic'].map(value=><option key={value}>{value}</option>)}</select></label>
 {!auth.ready?<Busy/>:auth.config?.authMode!=='local'?<p>로컬 QA 계정에서만 실행합니다.</p>:input?<button onClick={()=>{setSaved(false);setOpen(true);}}>검증 이미지 열기</button>:<Busy/>}
 {error&&<ErrorNotice error={error}/>} {saved&&<p role="status">검증 카드 저장 완료</p>}
 {open&&input&&<Modal title="이미지 가리기" wide onClose={close}><Occlusion decks={[input.deck]} initialDeckId={input.deck.id} initialImage={input.image} onDirtyChange={value=>{dirty.current=value;}} onSavingChange={value=>{busy.current=value;}} onClose={close} onSaved={async()=>{await api('/bootstrap');setSaved(true);}}/></Modal>}
 {guard.confirmation}
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);
