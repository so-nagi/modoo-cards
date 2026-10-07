import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Camera, ImagePlus, LockKeyhole, Paperclip, Plus, UnlockKeyhole } from 'lucide-react';
import { api } from '../api';
import { playSound } from '../features/sound';
import type { Deck, Model, CardRow } from '../types';
import { CardFrame, ErrorNotice, errorText, escapeHtml, htmlText } from './ui';
import ClozeEditor, { type ClozeEditorDraft } from './ClozeEditor';
import HtmlFieldEditor from './HtmlFieldEditor';
import { isImageOcclusionModel, isTextClozeModel } from '../features/cloze-editor';
import { finishModelDraftSave, hasUnsavedModelDrafts } from '../features/note-drafts';
import NoteTypeHelp, { noteFieldLabel, noteTypeLabel } from './NoteTypeHelp';
import './note-preview.css';

type PreviewResponse = {front:string;back:string;css:string;cardOrd:number;cards:{ord:number;name:string}[];warnings:string[]};
type PreviewSnapshot = PreviewResponse & {revision:number;fields:string[];fieldNames:string[]};

function ImageSourceSection({enabled,children}:{enabled:boolean;children:ReactNode}){
  return enabled?<details className="image-note-advanced"><summary>고급: 기존 필드 원문 편집</summary>{children}</details>:<>{children}</>;
}

function previewHtml(preview:PreviewSnapshot,side:'front'|'back') {
  return preview[side].replace(/\[\[type:([^\]]+)\]\]/g,(_,name:string)=>{
    if(side==='front')return `<input type="text" readonly placeholder="정답 입력" aria-label="${escapeHtml(name)} 정답 입력 미리보기">`;
    const index=preview.fieldNames.indexOf(name.replace(/^cloze:/,''));
    let answer=index>=0?preview.fields[index]:'';
    if(name.startsWith('cloze:'))answer=Array.from(answer.matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g)).filter(match=>Number(match[1])===preview.cardOrd+1).map(match=>match[2]).join(', ');
    return `<span class="typeans">${escapeHtml(htmlText(answer).replace(/\[sound:[^\]]+\]/g,'').trim())}</span>`;
  });
}

function NotePreview({modelId,fields,fieldNames,initialOrd=0}:{modelId:number;fields:string[];fieldNames:string[];initialOrd?:number}) {
  const [cardOrd,setCardOrd]=useState(initialOrd),[side,setSide]=useState<'front'|'back'>('front');
  const [preview,setPreview]=useState<PreviewSnapshot|null>(null),[pending,setPending]=useState(true),[error,setError]=useState(''),[frameError,setFrameError]=useState(''),[retry,setRetry]=useState(0);
  const sequence=useRef(0);
  useEffect(()=>{setCardOrd(initialOrd);setSide('front');setPreview(null);},[modelId,initialOrd]);
  useEffect(()=>{
    const revision=++sequence.current,controller=new AbortController();
    setPending(true);setError('');setFrameError('');
    const timeout=window.setTimeout(async()=>{
      if(!modelId||fields.length!==fieldNames.length){setPending(false);return;}
      try{
        const result=await api<PreviewResponse>('/preview-note',{method:'POST',body:JSON.stringify({modelId,fields,cardOrd}),signal:controller.signal});
        if(controller.signal.aborted||sequence.current!==revision)return;
        setPreview({...result,revision,fields:[...fields],fieldNames:[...fieldNames]});
        if(result.cardOrd!==cardOrd)setCardOrd(result.cardOrd);
      }catch(cause){if(!controller.signal.aborted&&sequence.current===revision)setError(errorText(cause));}
      finally{if(!controller.signal.aborted&&sequence.current===revision)setPending(false);}
    },300);
    return()=>{window.clearTimeout(timeout);controller.abort();};
  },[modelId,fields,fieldNames,cardOrd,retry]);
  const actualOrd=preview?.cards.some(card=>card.ord===cardOrd)?cardOrd:preview?.cardOrd??cardOrd;
  return <aside className="note-preview" aria-label="작성 중인 카드 미리보기" aria-busy={pending}>
    <div className="note-preview-heading"><h2>미리보기</h2><span role="status">{pending?'갱신 중…':''}</span></div>
    <label className="note-preview-card-label">미리볼 카드<select value={preview?.cards.length?actualOrd:''} disabled={pending||!preview?.cards.length} onChange={event=>setCardOrd(Number(event.target.value))}>{preview?.cards.length?preview.cards.map(card=><option key={card.ord} value={card.ord}>{card.name}</option>):<option value="">생성 가능한 카드 없음</option>}</select></label>
    <div className="note-preview-tabs" role="group" aria-label="카드 면"><button aria-pressed={side==='front'} onClick={()=>{setSide('front');setFrameError('');}}>앞면</button><button aria-pressed={side==='back'} onClick={()=>{setSide('back');setFrameError('');}}>뒷면</button></div>
    {preview&&preview.cards.length?<CardFrame html={previewHtml(preview,side)} css={preview.css} title={`작성 중인 카드 ${side==='front'?'앞면':'뒷면'} 미리보기`} contentKey={`${preview.revision}-${side}`} onError={(_,message)=>setFrameError(message)}/>:<div className="note-preview-empty">{pending?'미리보기를 준비하는 중…':'필드를 입력하면 카드가 표시됩니다.'}</div>}
    {(error||frameError)&&<div className="note-preview-error" role="status"><span>{error||frameError}</span><button onClick={()=>setRetry(value=>value+1)}>다시 시도</button></div>}
    {!!preview?.warnings.length&&<ul className="note-preview-warnings">{preview.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
  </aside>;
}

export default function NoteEditor({decks,models,initialDeckId,onSaved,onPhoto,onOcclusion,editing,onClose,onSavingChange,onDirtyChange}:{decks:Deck[];models:Model[];initialDeckId?:number;onSaved:()=>Promise<void>;onPhoto?:(deckId:number)=>void;onOcclusion?:(deckId:number)=>void;editing?:CardRow;onClose?:()=>void;onSavingChange?:(saving:boolean)=>void;onDirtyChange?:(dirty:boolean)=>void}){
 const [deckId,setDeckId]=useState(editing?.deckId||initialDeckId||decks[0]?.id||0),[modelId,setModelId]=useState(models.find(m=>m.name===editing?.modelName)?.id||models.find(m=>m.fields.length===2)?.id||models[0]?.id||0);
 const model=models.find(m=>m.id===modelId); const names=editing?.fieldNames||model?.fields||[];
 const [fields,setFields]=useState<string[]>(editing?.fields||names.map(()=>'')),[frozen,setFrozen]=useState<number[]>([]),[tags,setTags]=useState(editing?.tags.join(' ')||'');
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[activeField,setActiveField]=useState(0);
 const [baseline,setBaseline]=useState(()=>JSON.stringify({fields:editing?.fields||names.map(()=>''),tags:editing?.tags.join(' ')||''})),[draftDirty,setDraftDirty]=useState<Record<number,boolean>>({}),[resetRevision,setResetRevision]=useState(0);
 const [authorTab,setAuthorTab]=useState<'write'|'help'>('write'),[fieldModes,setFieldModes]=useState<Record<number,'text'|'html'|'preview'>>({});
 type ModelDraft={fields:string[];frozen:number[];baseline:string;draftDirty:Record<number,boolean>;clozeUi:Record<number,ClozeEditorDraft>};
 const modelDrafts=useRef(new Map<number,ModelDraft>()),clozeUi=useRef<Record<number,ClozeEditorDraft>>({}),activeModelId=useRef(modelId);activeModelId.current=modelId;
 const dirtyChange=useRef(onDirtyChange);dirtyChange.current=onDirtyChange;
 const cachedDirty=hasUnsavedModelDrafts(modelDrafts.current,modelId);
 const dirty=JSON.stringify({fields,tags})!==baseline||Object.values(draftDirty).some(Boolean)||cachedDirty;
 useEffect(()=>{dirtyChange.current?.(dirty);},[dirty]);
 useEffect(()=>()=>{dirtyChange.current?.(false);},[]);
 const textCloze=isTextClozeModel(model);
 const imageModel=isImageOcclusionModel(model);
 const clozeNames=textCloze?Array.from(new Set((model?.templates||[]).flatMap(template=>Array.from(template.qfmt.matchAll(/\{\{cloze:([^}]+)\}\}/g),match=>match[1])))):[];
 if(textCloze&&!clozeNames.length&&names[0])clozeNames.push(names[0]);
 const clozeModel=models.find(isTextClozeModel);
 const refs=useRef<(HTMLTextAreaElement|null)[]>([]); const mediaRef=useRef<HTMLInputElement>(null);
 const pendingNote=useRef<{key:string;requestId:string}|null>(null);
 const busyRef=useRef(false),savingChange=useRef(onSavingChange);savingChange.current=onSavingChange;
 const setWorking=(value:boolean)=>{busyRef.current=value;setBusy(value);savingChange.current?.(value);};
 useEffect(()=>()=>{savingChange.current?.(false);},[]);
 const changeModel=(id:number)=>{if(editing||busyRef.current||id===modelId)return;const next=models.find(item=>item.id===id);if(!next)return;modelDrafts.current.set(modelId,{fields:[...fields],frozen:[...frozen],baseline,draftDirty:{...draftDirty},clozeUi:{...clozeUi.current}});const restored=modelDrafts.current.get(id);const nextFields=restored?.fields||(isImageOcclusionModel(next)?next.fields.map(()=>''):next.fields.map((name,index)=>{const previous=names.indexOf(name);return fields[previous>=0?previous:index]||'';}));setFields(nextFields);setBaseline(restored?.baseline||JSON.stringify({fields:next.fields.map(()=>''),tags:JSON.parse(baseline).tags}));setModelId(id);setActiveField(0);setFrozen(restored?.frozen||[]);setDraftDirty(restored?.draftDirty||{});clozeUi.current=restored?.clozeUi||{};setFieldModes({});setMessage('');};
 const update=(index:number,value:string)=>setFields(all=>all.map((text,i)=>index===i?value:text));
 const insert=(before:string,after='')=>{const area=refs.current[activeField];if(!area)return;const start=area.selectionStart,end=area.selectionEnd;update(activeField,fields[activeField].slice(0,start)+before+fields[activeField].slice(start,end)+after+fields[activeField].slice(end));requestAnimationFrame(()=>{area.focus();area.setSelectionRange(start+before.length,end+before.length);});};
 const save=async()=>{if(busyRef.current||(!editing&&imageModel))return;if(!fields[0]?.trim()){setError('첫 번째 필드를 입력해 주세요.');return;}if(textCloze&&!names.some((name,index)=>clozeNames.includes(name)&&/\{\{c[1-9]\d*::/.test(fields[index]||''))){setError('문장에서 가릴 부분을 선택해 빈칸을 만들어 주세요.');return;}if(Object.values(draftDirty).some(Boolean)){setError('입력한 힌트를 빈칸에 적용하거나 지운 뒤 저장해 주세요.');return;}setWorking(true);setError('');setMessage('');let saved=false;try{const payload={fields,tags:tags.split(/\s+/).filter(Boolean)};if(editing){await api(`/notes/${editing.noteId}`,{method:'PUT',body:JSON.stringify(payload)});}else{const key=JSON.stringify({deckId,modelId,rows:[payload]});if(pendingNote.current?.key!==key)pendingNote.current={key,requestId:crypto.randomUUID()};await api('/notes/batch',{method:'POST',body:JSON.stringify({deckId,modelId,rows:[payload],requestId:pendingNote.current.requestId})});pendingNote.current=null;setFields(current=>current.map((text,index)=>frozen.includes(index)?text:''));}const nextFields=editing?fields:fields.map((text,index)=>frozen.includes(index)?text:'');modelDrafts.current=finishModelDraftSave(modelDrafts.current,modelId,tags);const remainingDrafts=!editing&&hasUnsavedModelDrafts(modelDrafts.current,modelId);clozeUi.current={};setBaseline(JSON.stringify({fields:nextFields,tags}));setDraftDirty({});setResetRevision(value=>value+1);dirtyChange.current?.(remainingDrafts);playSound('save');setMessage(editing?'변경 내용을 저장했어요.':remainingDrafts?'카드를 등록했어요. 다른 유형의 작성 내용은 유지돼요.':'카드를 등록했어요. 다음 단어를 이어서 입력하세요.');try{await onSaved();}catch(err){setError(`카드는 저장됐지만 목록을 갱신하지 못했어요. ${errorText(err)}`);}saved=true;}catch(err){setError(errorText(err));}finally{setWorking(false);}if(saved){if(editing){dirtyChange.current?.(false);onClose?.();}else requestAnimationFrame(()=>refs.current[0]?.focus());}};
 const upload=async(file:File)=>{if(busyRef.current)return;setWorking(true);setError('');try{const body=new FormData();body.append('file',file);const result=await api<{filename:string;url:string}>('/media',{method:'POST',body});const value=file.type.startsWith('audio/')?`[sound:${result.filename}]`:`<img src="${escapeHtml(result.filename)}">`;update(activeField,(fields[activeField]||'')+value);setMessage('미디어가 업로드되었어요. 카드를 저장해 주세요.');}catch(err){setError(errorText(err));}finally{setWorking(false);}};
 return <div className="note-editor"><fieldset className="note-editor-controls" disabled={busy} onKeyDown={event=>{if(!event.defaultPrevented&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void save();}}}>
  <div className="page-heading"><div><h1>{editing?'노트 편집':'새 카드 추가'}</h1></div>{!editing&&<button className="soft" onClick={()=>onPhoto?.(deckId)}><Camera size={15}/> 사진·파일로 등록</button>}</div>
  <div className="form-grid two"><label>덱<select value={deckId} onChange={event=>setDeckId(Number(event.target.value))} disabled={!!editing}>{decks.map(deck=><option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><label>노트 유형<select value={modelId} onChange={event=>changeModel(Number(event.target.value))} disabled={!!editing}>{models.map(item=><option key={item.id} value={item.id}>{noteTypeLabel(item)}</option>)}</select></label></div>
  <div className="note-author-tabs" role="group" aria-label="카드 작성과 안내"><button type="button" aria-pressed={authorTab==='write'} onClick={()=>setAuthorTab('write')}>작성</button><button type="button" aria-pressed={authorTab==='help'} onClick={()=>setAuthorTab('help')}>만드는 방법</button></div>
  <div hidden={authorTab!=='write'}>
   {imageModel&&!editing?<section className="image-note-workflow" aria-label="이미지 가리기 카드 만들기"><h2>사진 위에 박스를 그려 카드를 만듭니다.</h2><p>이미지를 선택한 뒤 숨길 부분을 드래그하세요. 박스를 각각 복습하거나 여러 박스를 한 문제로 묶을 수 있습니다.</p><button type="button" className="primary" onClick={()=>onOcclusion?.(deckId)} disabled={!onOcclusion||!deckId}><ImagePlus size={16}/> 이미지 가리기 편집기 열기</button><small>다른 노트 유형에서 입력한 내용은 유형을 다시 선택하면 복원됩니다.</small></section>:<>
    {imageModel&&editing&&<p className="image-note-advanced">이미지 가리기 노트의 기존 필드입니다. 이미지와 가리기 정보는 원문으로 보존됩니다. 새 이미지를 가리는 카드는 카드 추가 화면의 이미지 가리기 편집기에서 만드세요.</p>}
    <div className="editor-toolbar" hidden={imageModel}>{fieldModes[activeField]==='html'&&!clozeNames.includes(names[activeField])&&<button title="선택한 글자를 굵게" aria-label="굵게" onClick={()=>insert('<b>','</b>')}><Bold size={14}/></button>}{!editing&&model?.type!==1&&<button disabled={!clozeModel} onClick={()=>{if(clozeModel){changeModel(clozeModel.id);setMessage('문장에서 가릴 부분을 선택한 뒤 빈칸으로 만드세요.');}}}>빈칸 카드로 전환</button>}<button onClick={()=>mediaRef.current?.click()} disabled={busy}><Paperclip size={14}/> 미디어</button>{!editing&&<button onClick={()=>onOcclusion?.(deckId)}><ImagePlus size={14}/> 이미지 가리기</button>}<input ref={mediaRef} type="file" hidden accept="image/*,audio/*" onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></div>
    <ImageSourceSection enabled={imageModel}><div className={`note-editor-layout ${imageModel?'note-editor-layout-single':''}`}><div className="note-editor-fields">
     {names.map((name,index)=>{
      const label=noteFieldLabel(model,name,index);
      return <div key={index} className="editor-field"><span><span className="editor-field-name">{label}{label!==name&&<small>{name}</small>}</span><button type="button" className={`icon-button ${frozen.includes(index)?'selected':''}`} aria-label={`${name} 필드 고정 ${frozen.includes(index)?'해제':''}`} aria-pressed={frozen.includes(index)} onClick={()=>setFrozen(all=>all.includes(index)?all.filter(i=>i!==index):[...all,index])}>{frozen.includes(index)?<LockKeyhole size={14}/>:<UnlockKeyhole size={14}/>}</button></span>
       {clozeNames.includes(name)?<ClozeEditor key={`${modelId}-${index}-${resetRevision}`} name={name} value={fields[index]||''} disabled={busy} onChange={value=>update(index,value)} onFocus={()=>setActiveField(index)} onSave={()=>void save()} areaRef={element=>{refs.current[index]=element;}} initialDraft={clozeUi.current[index]} onUiDraftChange={draft=>{if(activeModelId.current===modelId)clozeUi.current[index]=draft;}} onDraftChange={value=>{if(activeModelId.current===modelId)setDraftDirty(current=>current[index]===value?current:{...current,[index]:value});}}/>:imageModel?<textarea ref={element=>{refs.current[index]=element;}} aria-label={`${name} 원문`} rows={index===0?3:4} value={fields[index]||''} onFocus={()=>setActiveField(index)} onChange={event=>update(index,event.target.value)} spellCheck={false}/>:<HtmlFieldEditor key={`${modelId}-${index}-${resetRevision}`} name={label} value={fields[index]||''} disabled={busy} placeholder={index===0?'예: apple 또는 대한민국의 수도는?':index===1?'예: 사과 또는 서울':name} rows={index===0?3:4} inputRef={element=>{refs.current[index]=element;}} onFocus={()=>setActiveField(index)} onChange={value=>update(index,value)} onModeChange={mode=>setFieldModes(current=>current[index]===mode?current:{...current,[index]:mode})}/>}
      </div>;
     })}
     <label className="field-label">태그<input placeholder="영어 시험 10월 (공백으로 구분)" value={tags} onChange={event=>setTags(event.target.value)}/></label><p className="fine-print"><LockKeyhole size={12}/> 필드를 고정하면 다음 카드를 추가할 때도 내용이 유지돼요.</p>
    </div>{!imageModel&&<NotePreview modelId={modelId} fields={fields} fieldNames={names} initialOrd={editing?.ord||0}/>}</div></ImageSourceSection>
    {error&&<ErrorNotice error={error}/>} {message&&<p className="success-notice" role="status">{message}</p>}<div className="form-footer"><span className="fine-print">저장 단축키: Ctrl + Enter</span><button className="primary" onClick={()=>void save()} disabled={busy||!deckId||!modelId}><Plus size={15}/>{busy?'저장 중…':editing?'변경 저장':'카드 추가'}</button></div>
   </>}
  </div>
  <div hidden={authorTab!=='help'}><NoteTypeHelp model={model}/></div>
 </fieldset></div>;
}
