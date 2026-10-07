import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, LoaderCircle, X } from 'lucide-react';
import { cancelFrame, createFrameBuffer, finishFrame, stageFrame, type FrameBuffer } from './frameBuffer';
import { cardDocumentHtml, cardFont } from './cardAppearance';
import { useCardAppearance } from './useCardAppearance';
import './card-appearance.css';

export function Busy({label='불러오는 중…'}:{label?:string}) { return <div className="busy" role="status"><LoaderCircle className="spin" size={18}/><span>{label}</span></div>; }
export function ErrorNotice({error, onRetry}:{error:string;onRetry?:()=>void}) { return <div className="error-notice" role="alert"><AlertCircle size={16}/><span>{error}</span>{onRetry && <button onClick={onRetry}>다시 시도</button>}</div>; }
export function Empty({icon, title, children, action}:{icon?:ReactNode;title:string;children?:ReactNode;action?:ReactNode}) {return <div className="empty-state">{icon && <div className="empty-symbol">{icon}</div>}<h3>{title}</h3><p>{children}</p>{action}</div>;}
const modalStack: HTMLDivElement[] = [];
let originalBodyOverflow = '';
export function Modal({title,children,onClose,wide=false,className='',role='dialog'}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean;className?:string;role?:'dialog'|'alertdialog'}) {
 const ref=useRef<HTMLDivElement>(null),backdropStarted=useRef(false),returnFocus=useRef(document.activeElement as HTMLElement|null); const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
   const before=returnFocus.current, panel=ref.current;
   if(!panel)return;
   if(!modalStack.length){originalBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
   modalStack.push(panel);panel.closest<HTMLElement>('.modal-backdrop')!.style.zIndex=String(100+modalStack.length);
   if(!panel.contains(document.activeElement))(panel.querySelector<HTMLElement>('[autofocus],[data-modal-initial-focus]')||panel).focus();
   const listener=(event:KeyboardEvent)=>{
     if(modalStack.at(-1)!==panel||event.defaultPrevented)return;
     if(event.key==='Escape'){event.preventDefault();closeRef.current();}
     if(event.key==='Tab'){
       const list=Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')).filter(el=>el.offsetParent!==null);
       const first=list[0],last=list[list.length-1];
       if(!first){event.preventDefault();return;}
       if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}
       else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault();first.focus();}
     }
   };
   document.addEventListener('keydown',listener);
   return()=>{document.removeEventListener('keydown',listener);const index=modalStack.indexOf(panel);if(index>=0)modalStack.splice(index,1);if(!modalStack.length)document.body.style.overflow=originalBodyOverflow;if(before?.isConnected)before.focus();};
 },[]);
 return <div className="modal-backdrop" onPointerDown={e=>{backdropStarted.current=e.target===e.currentTarget;}} onClick={e=>{if(e.target===e.currentTarget&&backdropStarted.current)onClose();backdropStarted.current=false;}}><div ref={ref} tabIndex={-1} role={role} aria-modal="true" aria-label={title} className={`modal ${wide?'modal-wide':''} ${className}`}><header className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={18}/></button></header>{children}</div></div>;
}
export function Toggle({label,description,checked,onChange}:{label:string;description?:string;checked:boolean;onChange:(checked:boolean)=>void}){return <label className="toggle-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" className="switch" checked={checked} onChange={e=>onChange(e.target.checked)}/></label>;}
export function htmlText(html:string){const doc=new DOMParser().parseFromString(html,'text/html');return doc.body.textContent?.trim()||'';}
export function escapeHtml(text:string){return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
export function errorText(error:unknown){return error instanceof Error?error.message:'요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';}
export function CardFrame({html,css='',title='카드 미리보기',className='',contentKey,onReady,onError,onEscape}:{html:string;css?:string;title?:string;className?:string;contentKey?:string|number;onReady?:(key?:string|number)=>void;onError?:(key:string|number|undefined,message:string)=>void;onEscape?:()=>void}){
 const origin=window.location.origin;const escapeEnabled=!!onEscape;const frameElements=useRef<(HTMLIFrameElement|null)[]>([]),frameRef=useRef<HTMLDivElement>(null);
 const appearance=useCardAppearance(frameRef),appearanceRef=useRef(appearance);appearanceRef.current=appearance;
 const documentHtml=useMemo(()=>cardDocumentHtml(html,css,origin,escapeEnabled,apiOrigin),[html,css,origin,escapeEnabled]);
 const [buffer,setBuffer]=useState(createFrameBuffer),[frameError,setFrameError]=useState('');
 const bufferRef=useRef(buffer),revision=useRef(0),live=useRef(true),animationFrames=useRef(new Set<number>());
 const callbacks=useRef({onReady,onError,onEscape});callbacks.current={onReady,onError,onEscape};
 const update=useCallback((change:(current:FrameBuffer)=>FrameBuffer)=>{const next=change(bufferRef.current);bufferRef.current=next;setBuffer(next);return next;},[]);
 useEffect(()=>{live.current=true;return()=>{live.current=false;animationFrames.current.forEach(cancelAnimationFrame);animationFrames.current.clear();};},[]);
 useLayoutEffect(()=>{
   const nextRevision=++revision.current;
   setFrameError('');
   update(current=>stageFrame(current,{revision:nextRevision,documentHtml,title,contentKey}));
   const timeout=window.setTimeout(()=>{
     if(!live.current||bufferRef.current.pending!==nextRevision)return;
     update(current=>cancelFrame(current,nextRevision));
     const message='카드 화면을 준비하지 못했어요. 다시 시도해 주세요.';
     setFrameError(message);callbacks.current.onError?.(contentKey,message);
   },20000);
   return()=>window.clearTimeout(timeout);
 },[documentHtml,contentKey,title,update]);
 const loaded=useCallback((loadedRevision:number)=>{
   if(bufferRef.current.pending!==loadedRevision)return;
   // Retain the old frame through the new document's load and a paint boundary.
   // Only the iframe that is already laid out becomes visible; no cross-fade.
   const nextPaint=(callback:()=>void)=>{const handle=requestAnimationFrame(()=>{animationFrames.current.delete(handle);if(live.current)callback();});animationFrames.current.add(handle);};
   nextPaint(()=>nextPaint(()=>{
     if(bufferRef.current.pending!==loadedRevision)return;
     const next=update(current=>finishFrame(current,loadedRevision));
     const ready=next.active===null?null:next.slots[next.active];
     if(ready?.revision===loadedRevision)callbacks.current.onReady?.(ready.contentKey);
   }));
 },[update]);
 useEffect(()=>{
   const receive=(event:MessageEvent)=>{
     const slot=frameElements.current.findIndex(frame=>frame&&event.source===frame.contentWindow);
     if(slot<0)return;
     if(event.data?.type==='modoo-card-appearance-ready'&&bufferRef.current.slots[slot]?.revision===event.data.revision)loaded(event.data.revision);
     if(escapeEnabled&&slot===bufferRef.current.active&&event.data?.type==='modoo-card-preview-escape')callbacks.current.onEscape?.();
   };
   window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
 },[escapeEnabled,loaded]);
 useEffect(()=>{frameElements.current.forEach(frame=>frame?.contentWindow?.postMessage({type:'modoo-card-appearance',appearance},'*'));},[appearance]);
 const initialize=(slot:number,loadedRevision:number)=>{
   const frame=frameElements.current[slot];
   if(!frame||bufferRef.current.pending!==loadedRevision)return;
   void cardFont(origin).then(font=>{
     if(!live.current||frameElements.current[slot]!==frame||bufferRef.current.pending!==loadedRevision)return;
     frame.contentWindow?.postMessage({type:'modoo-card-appearance',appearance:appearanceRef.current,font,revision:loadedRevision},'*');
   });
 };
 return <div ref={frameRef} className={`card-frame card-frame-themed ${className}`} data-card-skin={appearance.skin} aria-busy={buffer.pending!==null}>
   <span className="card-frame-chrome" aria-hidden="true"/>
   {buffer.active===null&&<div className="card-frame-placeholder" role="status">{frameError||'카드 화면 준비 중…'}</div>}
   {buffer.slots.map((document,slot)=>document&&<iframe ref={element=>{frameElements.current[slot]=element;}} key={document.revision} className="card-frame-layer" title={document.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document.documentHtml} aria-hidden={buffer.active!==slot} tabIndex={buffer.active===slot?0:-1} style={{visibility:buffer.active===slot?'visible':'hidden',pointerEvents:buffer.active===slot?'auto':'none'}} onLoad={()=>initialize(slot,document.revision)}/>)}
 </div>;
}

import { apiOrigin } from '../backend';
