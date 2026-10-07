import React, { useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import DeckHome from '../../src/components/DeckHome';
import SidebarDecks from '../../src/components/SidebarDecks';
import type { Deck, Skin } from '../../src/types';
import { getTabTextColor } from '../../src/features/themeContrast';
import '../../src/styles.css';
import '../../src/components/tab-contrast.css';

// Real component with in-memory decks: style checks never modify a user's collection.
const initialDecks: Deck[] = [
  {id:1,name:'영어',newCount:18,learnCount:2,reviewCount:0,favorite:true},
  ...Array.from({length:24},(_,i)=>({id:i+2,name:`영어::DAY${String(i+1).padStart(2,'0')}`,newCount:3,learnCount:0,reviewCount:0,favorite:false})),
  {id:30,name:'다른 덱',newCount:0,learnCount:0,reviewCount:0},
];
const noop = () => {};
function Harness() {
  const [decks,setDecks]=useState(initialDecks),[selected,setSelected]=useState<number|null>(1);
  const [skin,setSkin]=useState<Skin>('classic'),[theme,setTheme]=useState<'light'|'neutral'|'dark'>('light'),[accent,setAccent]=useState('#c5cfd8');
  return <div className={`app-shell skin-${skin} theme-${theme}`} style={{'--accent':accent,'--active-tab-text':getTabTextColor({accent,skin,theme}),padding:'24px',minHeight:'100vh'} as CSSProperties}>
    <aside className="left-sidebar"><div className="profile-block"><strong>로컬 검증</strong></div><SidebarDecks decks={decks} selected={selected} onSelect={setSelected} onNew={()=>setDecks(items=>[...items,{id:99,name:'새 폴더',newCount:0,learnCount:0,reviewCount:0}])}/><div className="sidebar-bottom"><button>설정</button></div></aside>
    <aside className="right-sidebar"><div className="aside-memo"><h2>단어 등록</h2><p>사진에서 단어를 추출하거나 TSV·CSV 파일을 가져옵니다.</p><button>사진·파일로 추가</button></div><div className="aside-footer"><p><kbd>Space</kbd> 정답 보기</p></div></aside>
    <main className="main-workspace" style={{maxWidth:640,margin:'auto',padding:0}}>
      <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
        <select aria-label="검증 스킨" value={skin} onChange={e=>setSkin(e.target.value as Skin)}>{['classic'].map(value=><option key={value}>{value}</option>)}</select>
        <select aria-label="검증 테마" value={theme} onChange={e=>setTheme(e.target.value as typeof theme)}>{['light','neutral','dark'].map(value=><option key={value}>{value}</option>)}</select>
        <button onClick={()=>setAccent('#c5cfd8')}>파랑 회색</button><button onClick={()=>setAccent('#a57770')}>분홍 갈색</button><button onClick={()=>setAccent('#3a3632')}>짙은 회색</button>
      </div>
      <nav className="page-tabs"><button className="active">DECKS</button><button>ADD</button><button>BROWSE</button><button>STATS</button></nav>
      <section className="main-paper">
        <DeckHome decks={decks} today={0} date="덱 중요 표시 로컬 검증" selected={selected} favoritePending={[]} onSelect={setSelected} onStudy={noop} onAdd={noop} onPhoto={noop} onNew={noop} onFiltered={noop} onFiles={noop} onOptions={noop} onRename={noop} onDelete={noop} onEmpty={noop} onPreview={noop} onEdit={noop} onFilterAction={async()=>{}} onFavorite={deck=>setDecks(items=>items.map(item=>item.id===deck.id?{...item,favorite:!item.favorite}:item))}/>
      </section>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);
