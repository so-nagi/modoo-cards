import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Camera, ChevronDown, ChevronRight, Folder, Layers3, LayoutGrid, List, MoreHorizontal, Plus, Search, Star, X } from 'lucide-react';
import type { Deck } from '../types';
import { visibleDecks } from '../features/deckList';
import { Empty } from './ui';
import './deck-views.css';

type DeckView = 'list' | 'gallery';
const viewPreferenceKey = 'modoo-anki-deck-view';
function initialDeckView(): DeckView {
  try { return localStorage.getItem(viewPreferenceKey) === 'gallery' ? 'gallery' : 'list'; }
  catch { return 'list'; }
}

type Props = {
  demo?: boolean;
  decks: Deck[]; today: number; selected: number|null; date: string; favoritePending: number[];
  onSelect(id:number):void; onStudy(deck?:Deck):void; onAdd():void; onPhoto():void; onNew():void;
  onFiltered():void; onFiles():void; onOptions(deck:Deck):void; onRename(deck:Deck):void;
  onDelete(deck:Deck):void; onEmpty(deck:Deck):void; onFavorite(deck:Deck):void; onPreview(deck:Deck):void; onEdit(deck:Deck):void;
  onFilterAction(deck:Deck,action:'rebuild'|'empty'):Promise<void>;
};

export default function DeckHome(props:Props) {
  const {decks,today,selected,onSelect,onStudy,onAdd,onPhoto,onNew,onFiltered,onFiles,onOptions,onRename,onDelete,onEmpty,onFavorite,onPreview,onEdit,onFilterAction,date,favoritePending}=props;
  const [collapsed,setCollapsed]=useState<string[]>([]),[menu,setMenu]=useState<number|null>(null);
  const [query,setQuery]=useState(''),[favoritesOnly,setFavoritesOnly]=useState(false);
  const [deckView,setDeckView]=useState<DeckView>(initialDeckView);
  const needle=query.normalize('NFC').trim().toLocaleLowerCase();
  const filtering=!!needle||favoritesOnly;
  const matches=visibleDecks(decks,{favoritesOnly,query});
  const shown=visibleDecks(decks,{favoritesOnly,query,collapsed});
  const due=decks.filter(deck=>!deck.name.includes('::')).reduce((sum,deck)=>sum+deck.newCount+deck.learnCount+deck.reviewCount,0);
  // Search, favorites and collapsed branches only change the list, never the study target.
  const current=selected===null?(decks.find(deck=>deck.newCount+deck.learnCount+deck.reviewCount>0)||decks[0]):decks.find(deck=>deck.id===selected);
  useEffect(()=>{if(selected===null&&current)onSelect(current.id);},[current?.id,selected,onSelect]);
  useEffect(()=>{try{localStorage.setItem(viewPreferenceKey,deckView);}catch{/* View preference is optional when storage is unavailable. */}},[deckView]);
  useEffect(()=>{setMenu(null);},[deckView,query,favoritesOnly]);
  useEffect(()=>{if(menu===null)return;const close=(event:MouseEvent)=>{if(!(event.target as HTMLElement).closest('.deck-menu-wrap'))setMenu(null);};document.addEventListener('click',close);return()=>document.removeEventListener('click',close);},[menu]);
  return <div className="decks-view">
    <div className="page-heading"><h1>{date}</h1><button className="icon-button" aria-label="새 덱 만들기" onClick={onNew}><Plus size={18}/></button></div>
    <div className="daily-line"><span>오늘 학습</span><span>{today}회 복습 · {due}장 대기</span></div>
    <div className="progress-track"><div style={{width:`${today+due?today/(today+due)*100:0}%`}}/></div>
    <div className="capture-strip"><button onClick={()=>{if(current)onSelect(current.id);onPhoto();}}><Camera size={18}/><span><strong>사진·파일로 단어 등록</strong><small>{props.demo?'사진 OCR · TSV/CSV 파일 가져오기':'사진 OCR · APKG · TSV/CSV 파일 가져오기'}</small></span><ChevronRight size={15}/></button></div>
    <div className="study-start"><div><span className="subtle">선택한 덱</span><strong title={current?.name}>{current?current.name.replaceAll('::',' / '):'덱을 선택하세요'}</strong></div><button className="primary" disabled={!current} onClick={()=>{if(current)onStudy(current);}}>복습 시작 <ArrowRight size={15}/></button></div>
    <div className="section-heading"><h2>내 덱 <span>{filtering?`${matches.length} / ${decks.length}`:decks.length}</span></h2><div className="deck-section-actions"><div className="deck-view-toggle" role="group" aria-label="덱 보기 방식"><button type="button" aria-label="목록 보기" title="목록 보기" aria-pressed={deckView==='list'} onClick={()=>setDeckView('list')}><List size={15}/></button><button type="button" aria-label="갤러리 보기" title="갤러리 보기" aria-pressed={deckView==='gallery'} onClick={()=>setDeckView('gallery')}><LayoutGrid size={14}/></button></div><button className="text-button" onClick={onNew}><Plus size={12}/> 만들기</button></div></div>
    <div className="deck-search-tools">
      <div className="deck-search"><Search size={14}/><input aria-label="덱 검색" placeholder="덱 검색" value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button className="icon-button" aria-label="덱 검색 지우기" onClick={()=>setQuery('')}><X size={13}/></button>}</div>
      <button className={`deck-important-filter ${favoritesOnly?'selected':''}`} aria-pressed={favoritesOnly} onClick={()=>setFavoritesOnly(value=>!value)}><Star size={13} fill={favoritesOnly?'currentColor':'none'}/> 중요 덱만</button>
    </div>
    {!decks.length?<Empty icon={<Layers3 size={29}/>} title="등록된 덱이 없습니다" action={<button className="primary" onClick={onNew}>새 덱 만들기</button>}>새 덱을 만든 다음 카드를 추가할 수 있습니다.</Empty>:!matches.length?<Empty title="조건에 맞는 덱이 없습니다" action={<button onClick={()=>{setQuery('');setFavoritesOnly(false);}}>전체 덱 보기</button>}>검색어 또는 중요 덱 필터를 변경하세요.</Empty>:<>
      {deckView==='list'&&<div className="deck-table-heading"><span>덱 이름</span><span>새 카드</span><span>학습</span><span>복습</span><span/></div>}
      <div className={deckView==='gallery'?'deck-gallery':'deck-list'}>{shown.map(item=>{
        const depth=item.name.split('::').length-1,hasChildren=matches.some(child=>child.name.startsWith(`${item.name}::`));
        return <div className={`deck-row ${deckView==='gallery'?'deck-gallery-card':''} ${item.favorite?'is-important':''} ${current?.id===item.id?'selected':''} ${menu===item.id?'menu-open':''}`} key={item.id}>
          <div className="deck-name" style={{paddingLeft:`${!!needle||deckView==='gallery'?0:Math.min(depth,5)*15}px`}}>
            {hasChildren&&!needle?<button className="tree-toggle" aria-label={`${item.name} 하위 덱 ${collapsed.includes(item.name)?'펼치기':'접기'}`} onClick={()=>setCollapsed(list=>list.includes(item.name)?list.filter(name=>name!==item.name):[...list,item.name])}>{collapsed.includes(item.name)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>:<span className="tree-spacer"/>}
            <button className={`deck-star ${item.favorite?'is-important':''}`} aria-label={`${item.name} 중요 표시`} aria-pressed={!!item.favorite} disabled={favoritePending.includes(item.id)} onClick={()=>onFavorite(item)} title={item.favorite?'중요 표시 해제':'중요 덱으로 표시'}><Star size={14} fill={item.favorite?'currentColor':'none'}/></button>
            <button className="deck-title-button" onClick={()=>{onSelect(item.id);if(hasChildren)setCollapsed(list=>list.filter(name=>name!==item.name));}} onDoubleClick={()=>onStudy(item)} title={item.name} aria-pressed={current?.id===item.id}><Folder size={14}/><span>{!!needle||deckView==='gallery'?item.name.replaceAll('::',' / '):item.name.split('::').at(-1)}</span></button>
          </div>
          <span className="count-new"><small className="deck-count-label">새 카드</small><b>{item.newCount}</b></span><span className="count-learn"><small className="deck-count-label">학습</small><b>{item.learnCount}</b></span><span className="count-review"><small className="deck-count-label">복습</small><b>{item.reviewCount}</b></span>
          <div className="deck-menu-wrap"><button className="icon-button" aria-label={`${item.name} 메뉴`} aria-expanded={menu===item.id} onClick={()=>setMenu(menu===item.id?null:item.id)}><MoreHorizontal size={16}/></button>{menu===item.id&&<div className="deck-menu">
            <button onClick={()=>{onEdit(item);setMenu(null);}}>덱 편집</button><button onClick={()=>{onPreview(item);setMenu(null);}}>카드 미리보기</button><button onClick={()=>{onStudy(item);setMenu(null);}}>복습 시작</button>{!props.demo&&<button onClick={()=>{onOptions(item);setMenu(null);}}>덱 옵션</button>}<button onClick={()=>{onRename(item);setMenu(null);}}>이름 바꾸기</button>
            {item.filtered?<><button onClick={()=>{void onFilterAction(item,'rebuild');setMenu(null);}}>필터 다시 모으기</button><button onClick={()=>{void onFilterAction(item,'empty');setMenu(null);}}>원래 덱으로 돌려보내기</button></>:<button className="danger-text" onClick={()=>{onEmpty(item);setMenu(null);}}>덱 비우기</button>}
            <button className="danger-text" onClick={()=>{onDelete(item);setMenu(null);}}>덱 삭제</button>
          </div>}</div>
        </div>;
      })}</div>
    </>}
    <div className="deck-bottom-tools"><button onClick={()=>{if(current)onSelect(current.id);onAdd();}}><Plus size={13}/> 직접 추가</button>{!props.demo&&<button onClick={onFiltered}>집중 복습 만들기</button>}<button onClick={onFiles}><ArrowDownToLine size={13}/> 가져오기</button></div>
  </div>;
}
