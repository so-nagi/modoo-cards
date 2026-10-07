import { Folder, Plus } from 'lucide-react';
import type { Deck } from '../types';
import { visibleDecks } from '../features/deckList';

export default function SidebarDecks({decks,selected,onSelect,onNew}:{decks:Deck[];selected:number|null;onSelect:(id:number)=>void;onNew:()=>void}) {
  return <div className="sidebar-decks">
    <div className="sidebar-section-title"><span>내 덱 <small>{decks.length}</small></span><button className="icon-button" title="덱 만들기" aria-label="덱 만들기" onClick={onNew}><Plus size={13}/></button></div>
    <nav className="sidebar-deck-list" aria-label="내 덱 목록">{visibleDecks(decks).map(item=><button key={item.id} className={`sidebar-deck ${selected===item.id?'selected':''}`} aria-current={selected===item.id?'true':undefined} title={item.name.replaceAll('::',' / ')} style={{paddingLeft:`${10+Math.min(item.name.split('::').length-1,4)*10}px`}} onClick={()=>onSelect(item.id)}><Folder size={12}/><span>{item.name.split('::').at(-1)}</span>{item.reviewCount>0&&<small>{item.reviewCount}</small>}</button>)}</nav>
  </div>;
}
