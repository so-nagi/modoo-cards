import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { addClozeBlank, editClozeText, nextClozeGroup, parseCloze, updateClozeSource } from '../features/cloze-editor';
import type { ClozeDocument } from '../features/cloze-editor';
import './cloze-editor.css';

export type ClozeEditorDraft={raw:boolean;selection:{start:number;end:number};hint:string;group:string};
export default function ClozeEditor({value,onChange,name,disabled,onFocus,onSave,areaRef,onDraftChange,initialDraft,onUiDraftChange}:{value:string;onChange:(value:string)=>void;name:string;disabled:boolean;onFocus:()=>void;onSave:()=>void;areaRef:(area:HTMLTextAreaElement|null)=>void;onDraftChange?:(dirty:boolean)=>void;initialDraft?:ClozeEditorDraft;onUiDraftChange?:(draft:ClozeEditorDraft)=>void}){
  const parsed=useMemo(()=>parseCloze(value),[value]);
  const [raw,setRaw]=useState(initialDraft?.raw||false),[selection,setSelection]=useState(initialDraft?.selection||{start:0,end:0}),[hint,setHint]=useState(initialDraft?.hint||''),[group,setGroup]=useState(initialDraft?.group||'new'),[notice,setNotice]=useState('');
  const area=useRef<HTMLTextAreaElement|null>(null);
  const draftChange=useRef(onDraftChange);draftChange.current=onDraftChange;
  const uiDraftChange=useRef(onUiDraftChange);uiDraftChange.current=onUiDraftChange;
  useEffect(()=>{uiDraftChange.current?.({raw,selection,hint,group});},[raw,selection,hint,group]);
  useEffect(()=>{draftChange.current?.(hint.length>0);},[hint]);
  useEffect(()=>()=>{draftChange.current?.(false);},[]);
  const document=parsed.supported?parsed.document:null;
  const groups=document?[...new Set(document.blanks.map(blank=>blank.group))].sort((a,b)=>a-b):[];
  const selected=document?.text.slice(selection.start,selection.end)||'';
  const overlap=!!document?.blanks.some(blank=>selection.start<blank.end&&selection.end>blank.start);
  const update=(next:ClozeDocument)=>onChange(updateClozeSource(value,next));
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();onSave();}};
  const registerArea=(node:HTMLTextAreaElement|null)=>{area.current=node;areaRef(node);};
  const readSelection=()=>{if(area.current)setSelection({start:area.current.selectionStart,end:area.current.selectionEnd});};
  const addBlank=()=>{
    if(disabled||!document)return;
    const chosenGroup=group==='new'||!groups.includes(Number(group))?nextClozeGroup(document):Number(group);
    const next=addClozeBlank(document,selection.start,selection.end,chosenGroup,hint);
    if(!next)return;
    update(next);setHint('');setNotice(`문제 ${chosenGroup}에 빈칸을 추가했습니다.`);setSelection({start:selection.end,end:selection.end});
    requestAnimationFrame(()=>{area.current?.focus();area.current?.setSelectionRange(selection.end,selection.end);});
  };
  const sourceMode=raw||!document;
  return <div className="cloze-builder">
    <div className="cloze-mode-bar"><span>{sourceMode?'Anki 원문 편집':'문장에서 가릴 부분을 선택하세요.'}</span><button type="button" onClick={()=>{setRaw(!sourceMode);setNotice('');}} disabled={!parsed.supported}>{sourceMode?'문장 편집으로':'원문 편집'}</button></div>
    {!parsed.supported&&<p className="cloze-source-notice">{parsed.reason}</p>}
    {sourceMode?<textarea ref={registerArea} aria-label={`${name} 원문`} value={value} onFocus={onFocus} onChange={event=>onChange(event.target.value)} onKeyDown={keyDown} rows={5} spellCheck={false}/>:<>
      <textarea ref={registerArea} aria-label={`${name} 문장`} placeholder="예: 대한민국의 수도는 서울이다." value={document.text} onFocus={onFocus} onChange={event=>{update(editClozeText(document,event.target.value));setNotice('');}} onSelect={readSelection} onKeyDown={keyDown} rows={5}/>
      <div className="cloze-selection" aria-live="polite">{selected.trim()?<>선택: <strong>{selected}</strong>{overlap&&<span>이미 빈칸인 부분과 겹칩니다.</span>}</>:'가릴 단어나 구절을 마우스 또는 키보드로 선택하세요.'}</div>
      <div className="cloze-create-fields"><label>힌트 (선택)<input value={hint} onChange={event=>setHint(event.target.value)} placeholder="예: 도시 이름"/></label><label>문제 구성<select value={group==='new'||groups.includes(Number(group))?group:'new'} onChange={event=>setGroup(event.target.value)}><option value="new">새 문제로 만들기</option>{groups.map(number=><option key={number} value={number}>문제 {number}과 함께 가리기</option>)}</select></label></div>
      <button type="button" className="soft cloze-create-button" disabled={!selected.trim()||overlap||disabled} onClick={addBlank}>선택한 부분을 빈칸으로</button>
      {!!document.blanks.length&&<div className="cloze-blanks"><div className="cloze-blanks-heading"><strong>빈칸 {document.blanks.length}개 · 생성할 카드 {groups.length}장</strong><span>같은 문제의 빈칸은 함께 가려집니다.</span></div>{document.blanks.map((blank,index)=><div className="cloze-blank-row" key={`${index}-${blank.start}`}><div className="cloze-blank-title"><mark>{document.text.slice(blank.start,blank.end)}</mark><button type="button" aria-label={`${index+1}번째 빈칸 해제`} onClick={()=>update({...document,blanks:document.blanks.filter((_,i)=>i!==index)})}>해제</button></div><div className="cloze-blank-options"><label>가릴 문제<select aria-label={`${index+1}번째 빈칸 문제`} value={blank.group} onChange={event=>update({...document,blanks:document.blanks.map((item,i)=>i===index?{...item,group:event.target.value==='new'?nextClozeGroup(document):Number(event.target.value)}:item)})}>{groups.map(number=><option key={number} value={number}>문제 {number}</option>)}<option value="new">별도 문제로 나누기</option></select></label><label>힌트<input aria-label={`${index+1}번째 빈칸 힌트`} value={blank.hint} placeholder="선택 사항" onChange={event=>update({...document,blanks:document.blanks.map((item,i)=>i===index?{...item,hint:event.target.value}:item)})}/></label></div></div>)}</div>}
    </>}
    <span className="cloze-editor-status" role="status">{notice}</span>
  </div>;
}
