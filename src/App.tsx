import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Camera, Check, ChevronDown, ChevronRight, Cloud, CloudOff, FileCode2, Folder, Layers3, LogOut, Menu, MoreHorizontal, Plus, Search, Settings2, Sparkles, TrendingUp, Volume2, VolumeX, X } from 'lucide-react';
import { api, retryCloudSettings } from './api';
import { useAuth, sessionBoundary } from './auth';
import { installButtonSoundFeedback, playSound, prepareSound, setSoundPreferences } from './features/sound';
import { getTabTextColor } from './features/themeContrast';
import PhotoImport, { type PhotoImportDraft } from './features/PhotoImport';
import AddonsPanel from './features/AddonsPanel';
import type { Bootstrap, Deck, Settings, View } from './types';
import { defaultSettings } from './types';
import Study from './components/Study';
import DeckHome from './components/DeckHome';
import SidebarDecks from './components/SidebarDecks';
import DeckPreview from './components/DeckPreview';
import DeckEditor from './components/DeckEditor';
import NoteEditor from './components/NoteEditor';
import Browser from './components/Browser';
import Statistics, { Heatmap } from './components/Statistics';
import SettingsView from './components/Settings';
import Occlusion from './components/Occlusion';
import { DeckOptions, FilesPanel, FilteredDeck, ModelsEditor } from './components/Admin';
import { Busy, Empty, ErrorNotice, Modal, errorText, escapeHtml } from './components/ui';
import './styles.css';
import './components/tab-contrast.css';
import { useDiscardGuard } from './components/useDiscardGuard';

type Dialog = {kind:'preview'|'editDeck';deck:Deck}|{kind:'newDeck'|'rename'|'delete'|'empty'|'options';deck?:Deck}|{kind:'files';file?:File}|{kind:'photo'|'occlusion'|'filtered'|'addons'}|null;
const navigation:{id:View;label:string;english:string;icon:typeof Layers3}[]=[{id:'decks',label:'내 덱',english:'DECKS',icon:Layers3},{id:'add',label:'카드 추가',english:'ADD',icon:Plus},{id:'browse',label:'탐색',english:'BROWSE',icon:Search},{id:'stats',label:'기록',english:'STATS',icon:TrendingUp}];

export default function App(){
 const auth=useAuth();
 if(auth.loading)return <div className="auth-screen"><div className="auth-card"><div className="brand-mark"><BookOpen size={25}/></div><h1>모두카드</h1><Busy label="앱을 불러오는 중…"/></div></div>;
 if(!auth.ready)return <div className="auth-screen"><main className="auth-card"><div className="brand-mark"><BookOpen size={25}/></div><h1>모두카드</h1><p>덱과 카드를 관리하고<br/>복습 일정을 확인합니다.</p><div className="auth-paper"><span>사진 등록 · 카드 관리 · 복습</span><div><Camera size={20}/><ArrowRight size={14}/><Layers3 size={20}/><ArrowRight size={14}/><Check size={20}/></div></div><button className="google-button" disabled={auth.config?.authMode!=='firebase'} onClick={()=>void auth.signIn()}><span className="google-g">G</span>Google 로그인</button>{auth.error&&<ErrorNotice error={auth.error}/>}<p className="fine-print">같은 Google 계정으로 로그인하면 덱과 복습 기록을 공유할 수 있습니다.</p></main></div>;
 return <Workspace key={auth.user?.uid||'local'} auth={auth}/>;
}
function Workspace({auth}:{auth:ReturnType<typeof useAuth>}){
 const [syncWarning,setSyncWarning]=useState(''),[syncRetrying,setSyncRetrying]=useState(false);const syncRetryPending=useRef(false);
 const [browseDeck,setBrowseDeck]=useState<Deck|null>(null);
 const [favoritePending,setFavoritePending]=useState<number[]>([]);const favoriteRequests=useRef(new Set<number>());
 const discardGuard=useDiscardGuard();
 const addDirty=useRef(false),addSaving=useRef(false),occlusionDirty=useRef(false);
 const updateAddDirty=useCallback((dirty:boolean)=>{addDirty.current=dirty;},[]),updateAddSaving=useCallback((saving:boolean)=>{addSaving.current=saving;},[]),updateOcclusionDirty=useCallback((dirty:boolean)=>{occlusionDirty.current=dirty;},[]);
 const occlusionSaving=useRef(false);const updateOcclusionSaving=useCallback((saving:boolean)=>{occlusionSaving.current=saving;},[]);const closeOcclusion=()=>discardGuard.request(()=>{occlusionDirty.current=false;setDialog(null);},occlusionDirty.current,occlusionSaving.current);
 const [data,setData]=useState<Bootstrap|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[view,setView]=useState<View>('decks'),[selectedDeck,setSelectedDeck]=useState<number|null>(null),[dialog,setDialog]=useState<Dialog>(null),[mobileOpen,setMobileOpen]=useState(false),[deckName,setDeckName]=useState(''),[busy,setBusy]=useState(false),[dialogError,setDialogError]=useState(''),[toast,setToast]=useState(''),[online,setOnline]=useState(navigator.onLine),[lastSync,setLastSync]=useState<Date|null>(null),[searchQuery,setSearchQuery]=useState('');
 const filesBusy=useRef(false);
 const photoDraftRef=useRef<PhotoImportDraft|null>(null),photoSavingRef=useRef(false); const [photoSaving,setPhotoSaving]=useState(false); const closePhoto=()=>{const draft=photoDraftRef.current;discardGuard.request(()=>{photoDraftRef.current=null;setDialog(null);},!!draft&&(!!draft.photo||!!draft.pasted.trim()||!!draft.rawText.trim()||draft.rows.length>0),photoSavingRef.current);}; const rememberPhotoDraft=useCallback((draft:PhotoImportDraft)=>{photoDraftRef.current=draft;},[]); const updatePhotoSaving=useCallback((saving:boolean)=>{photoSavingRef.current=saving;setPhotoSaving(saving);},[]); const refreshCounter=useRef(0); const photoRequest=useRef<{payload:string;id:string}|null>(null); const currentSettings=useRef<Settings>(defaultSettings),settingChain=useRef<Promise<unknown>>(Promise.resolve()),settingsRevision=useRef(0),settingsPending=useRef(0),mounted=useRef(true);
 const settings=data?.settings||defaultSettings;currentSettings.current=settings;
 const refresh=useCallback(async()=>{const request=++refreshCounter.current;const settingsAtStart=settingsRevision.current;const settingsWerePending=settingsPending.current>0;const result=await api<Bootstrap>('/bootstrap');if(mounted.current&&request===refreshCounter.current){setData(current=>({...result,decks:result.decks.map(item=>favoriteRequests.current.has(item.id)?{...item,favorite:current?.decks.find(existing=>existing.id===item.id)?.favorite}:item),settings:!settingsWerePending&&settingsPending.current===0&&settingsAtStart===settingsRevision.current?result.settings:currentSettings.current}));setLastSync(new Date());setError('');}},[]);
 useEffect(()=>{mounted.current=true;void refresh().catch(err=>setError(errorText(err))).finally(()=>setLoading(false));const connected=()=>setOnline(navigator.onLine);window.addEventListener('online',connected);window.addEventListener('offline',connected);return()=>{mounted.current=false;window.removeEventListener('online',connected);window.removeEventListener('offline',connected);if ("speechSynthesis" in window) window.speechSynthesis.cancel();};},[refresh]);
 useEffect(()=>{const onFocus=()=>{if(document.visibilityState==='visible'&&online)void refresh().catch(err=>setError(errorText(err)));};window.addEventListener('focus',onFocus);const interval=window.setInterval(onFocus,30000);return()=>{window.removeEventListener('focus',onFocus);window.clearInterval(interval);};},[refresh,online]);
 useEffect(()=>{setSoundPreferences({enabled:settings.sounds,volume:settings.volume});},[settings.sounds,settings.volume]);
 useEffect(()=>{const removeButtonSounds=installButtonSoundFeedback();window.addEventListener('pointerdown',prepareSound,{capture:true,passive:true});window.addEventListener('keydown',prepareSound,true);return()=>{removeButtonSounds();window.removeEventListener('pointerdown',prepareSound,true);window.removeEventListener('keydown',prepareSound,true);};},[]);
 useEffect(()=>{const warn=(event:Event)=>setSyncWarning(String((event as CustomEvent).detail??''));window.addEventListener('modoo:sync-warning',warn);return()=>window.removeEventListener('modoo:sync-warning',warn);},[]);
 useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(''),4500);return()=>window.clearTimeout(timer);},[toast]);
 const changeSettings=async(patch:Partial<Settings>)=>{const session=sessionBoundary.capture();const revision=++settingsRevision.current;settingsPending.current++;const optimistic={...currentSettings.current,...patch};currentSettings.current=optimistic;setData(current=>current?{...current,settings:optimistic}:current);setSoundPreferences({enabled:optimistic.sounds,volume:optimistic.volume});const pending=settingChain.current.catch(()=>undefined).then(async()=>{sessionBoundary.assertCurrent(session);const saved=await api<Settings>('/settings',{method:'PUT',body:JSON.stringify(patch)});if(revision===settingsRevision.current && mounted.current){setData(current=>current?{...current,settings:saved}:current);setLastSync(new Date());}});settingChain.current=pending;try{await pending;}catch(err){setError(`설정을 저장하지 못했어요. ${errorText(err)}`);}finally{settingsPending.current--;}};
 const retrySettingsSync=async()=>{
   if(syncRetryPending.current)return;
   const session=sessionBoundary.capture();syncRetryPending.current=true;setSyncRetrying(true);
   const pending=settingChain.current.catch(()=>undefined).then(async()=>{sessionBoundary.assertCurrent(session);return retryCloudSettings();});
   settingChain.current=pending;
   try{await pending;}catch(err){if(mounted.current){try{sessionBoundary.assertCurrent(session);}catch{return;}setSyncWarning(`설정 사본을 다시 저장하지 못했어요. ${errorText(err)}`);}}
   finally{syncRetryPending.current=false;if(mounted.current)setSyncRetrying(false);}
 };
 const go=(next:View)=>{if(next===view){setMobileOpen(false);return;}discardGuard.request(()=>{addDirty.current=false;setView(next);setMobileOpen(false);playSound('navigate');},view==='add'&&addDirty.current,view==='add'&&addSaving.current);};
 const open=(next:NonNullable<Dialog>)=>{setDialogError('');setDeckName('deck' in next?next.deck?.name||'':'');setDialog(next);playSound('tap');};
 const deck=data?.decks.find(item=>item.id===selectedDeck)||data?.decks[0];
 const study=(item?:Deck)=>{const target=item||deck;if(target){setSelectedDeck(target.id);go('study');}};
 const toggleFavorite=async(item:Deck)=>{
   if(favoriteRequests.current.has(item.id))return;
   refreshCounter.current++;favoriteRequests.current.add(item.id);setFavoritePending([...favoriteRequests.current]);
   const favorite=!item.favorite;
   setData(current=>current?{...current,decks:current.decks.map(entry=>entry.id===item.id?{...entry,favorite}:entry)}:current);
   playSound('tap');
   try{const saved=await api<Deck>(`/decks/${item.id}/favorite`,{method:'PUT',body:JSON.stringify({favorite})});if(mounted.current)setData(current=>current?{...current,decks:current.decks.map(entry=>entry.id===item.id?{...entry,favorite:saved.favorite}:entry)}:current);}
   catch(err){if(mounted.current){setData(current=>current?{...current,decks:current.decks.map(entry=>entry.id===item.id?{...entry,favorite:!!item.favorite}:entry)}:current);setError(errorText(err));}}
   finally{refreshCounter.current++;favoriteRequests.current.delete(item.id);if(mounted.current)setFavoritePending([...favoriteRequests.current]);}
 };
 const emptyDeck=async()=>{
   if(dialog?.kind!=='empty'||!dialog.deck||busy)return;
   setBusy(true);setDialogError('');
   try{const result=await api<{ok:boolean;removed:number;decks:Deck[]}>(`/decks/${dialog.deck.id}/empty`,{method:'POST'});
     setData(current=>current?{...current,decks:result.decks}:current);setDialog(null);playSound('delete');setToast(`${result.removed}장의 카드를 삭제했어요. 덱은 유지돼요.`);
     try{await refresh();}catch(err){setError(`덱 비우기는 완료했지만 목록을 갱신하지 못했어요. ${errorText(err)}`);}
   }catch(err){setDialogError(errorText(err));}finally{setBusy(false);}
 };
 const saveDeck=async()=>{if(!dialog||busy)return;setBusy(true);setDialogError('');try{if(dialog.kind==='delete'&&dialog.deck){
   const removed=dialog.deck;
   const result=await api<{ok:boolean;decks?:Deck[]}>(`/decks/${removed.id}`,{method:'DELETE'});
   const remaining=result.decks||(data?.decks||[]).filter(item=>item.id!==removed.id&&!item.name.startsWith(`${removed.name}::`));
   setData(current=>current?{...current,decks:remaining}:current);
   setSelectedDeck(current=>remaining.some(item=>item.id===current)?current:null);
   setDialog(null);playSound('delete');setToast('덱을 삭제했어요.');
   try{await refresh();}catch(err){setError(`덱 삭제는 완료했어요. 나머지 정보를 새로 불러오지 못했어요. ${errorText(err)}`);}
   return;
 }else if(dialog.kind==='rename'&&dialog.deck){await api(`/decks/${dialog.deck.id}`,{method:'PATCH',body:JSON.stringify({name:deckName})});playSound('save');}else{const created=await api<Deck>('/decks',{method:'POST',body:JSON.stringify({name:deckName})});setSelectedDeck(created.id);playSound('save');setToast('새 덱을 만들었어요. 카드를 추가해 보세요.');}await refresh();setDialog(null);}catch(err){setDialogError(errorText(err));}finally{setBusy(false);}};
 const photoImport=async(rows:{word:string;meaning:string}[])=>{if(!data||!deck)throw new Error('등록할 덱을 먼저 만들어 주세요.');const model=data.models.find(item=>item.fields.length===2&&item.type!==1)||data.models.find(item=>item.fields.length>=2);if(!model)throw new Error('앞면과 뒷면 필드가 있는 노트 유형이 필요해요.');const payloadKey=JSON.stringify({deckId:deck.id,modelId:model.id,rows}); if(photoRequest.current?.payload!==payloadKey) photoRequest.current={payload:payloadKey,id:crypto.randomUUID()}; const result=await api<{added:number}>('/notes/batch',{method:'POST',body:JSON.stringify({deckId:deck.id,modelId:model.id,rows:rows.map(row=>({fields:model.fields.map((_,index)=>index===0?escapeHtml(row.word):index===1?escapeHtml(row.meaning).replace(/\r?\n/g,'<br>'):''),tags:['단어등록']})),requestId:photoRequest.current.id})});photoRequest.current=null;setToast(`${result.added}개의 단어를 등록했어요.`);try{await refresh();}catch(err){setError(`단어는 등록됐지만 목록을 새로 불러오지 못했어요. ${errorText(err)}`);}};
 const filterAction=async(item:Deck,action:'rebuild'|'empty')=>{try{await api(`/filtered-decks/${item.id}/${action}`,{method:'POST'});await refresh();setToast(action==='rebuild'?'필터 덱을 다시 모았어요.':'카드를 원래 덱으로 돌려보냈어요.');}catch(err){setError(errorText(err));}};
 const account=<div className="account-details">{auth.config?.authMode==='local'?<><CloudOff size={19}/><div><strong>이 기기에서 사용 중</strong><small>로컬 서버의 컬렉션 · Google 로그인 전</small></div></>:<><Cloud size={19}/><div><strong>{auth.user?.displayName||'내 계정'}</strong><small>{auth.user?.email}</small></div><button onClick={()=>void auth.signOut()}><LogOut size={14}/> 로그아웃</button></>}</div>;
 const isZen=view==='study'&&settings.zen;
 const date=new Date();const displayDate=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(date);
 return <div className={`app-shell skin-classic theme-${settings.theme} ${isZen?'zen-mode':''}`} style={{'--accent':settings.accent,'--active-tab-text':getTabTextColor(settings),'--card-font-size':`${settings.cardFontSize??20}px`} as CSSProperties}>
 <header className="mobile-header"><button className="icon-button" aria-label="메뉴 열기" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><strong>모두카드</strong><button className="icon-button" aria-label="설정" onClick={()=>go('settings')}><Settings2 size={19}/></button></header>
 {mobileOpen&&<button className="drawer-shade" aria-label="메뉴 닫기" onClick={()=>setMobileOpen(false)}/>}
 <aside className={`left-sidebar ${mobileOpen?'open':''}`}><button className="mobile-close icon-button" aria-label="메뉴 닫기" onClick={()=>setMobileOpen(false)}><X size={18}/></button><div className="profile-block"><button className="avatar" onClick={()=>go('settings')} aria-label="계정 설정">{auth.user?.photoURL?<img src={auth.user.photoURL} alt="" referrerPolicy="no-referrer"/>:<BookOpen size={23}/>}</button><strong>{auth.user?.displayName?`${auth.user.displayName} 계정`:'내 계정'}</strong><span>{auth.config?.authMode==='local'?'이 기기에서 사용 중':'Google 계정 연결됨'}</span></div><div className="sidebar-date"><span>{date.getFullYear()}</span><strong>{date.getMonth()+1}월 {date.getDate()}일</strong></div><SidebarDecks decks={data?.decks||[]} selected={selectedDeck} onNew={()=>open({kind:'newDeck'})} onSelect={id=>{setSelectedDeck(id);go('decks');}}/><div className="sidebar-bottom"><button onClick={()=>{setDialog({kind:'files'});setMobileOpen(false);}}><ArrowDownToLine size={14}/> 가져오기 · 내보내기</button><button onClick={()=>go('models')}><FileCode2 size={14}/> 노트 유형</button><button onClick={()=>open({kind:'addons'})}><Sparkles size={14}/> 내장 기능</button><button onClick={()=>go('settings')}><Settings2 size={14}/> 설정</button><div className="sidebar-sound"><button aria-label={settings.sounds?'효과음 끄기':'효과음 켜기'} onClick={()=>void changeSettings({sounds:!settings.sounds})}>{settings.sounds?<Volume2 size={14}/>:<VolumeX size={14}/>}<span>효과음</span></button></div></div></aside>
 <main className="main-workspace"><div className="workspace-inner"><div className="workspace-topline"><span>모두카드</span><button className={`sync-status ${!online?'offline':''}`} disabled={loading} onClick={()=>void refresh().then(()=>setToast('서버의 최신 자료를 불러왔어요.')).catch(err=>setError(errorText(err)))}>{online?<Cloud size={12}/>:<CloudOff size={12}/>} {online?lastSync?'새로고침':'연결 중':'오프라인'}</button></div><nav className="page-tabs" aria-label="페이지 탭">{navigation.map(item=><button key={item.id} className={view===item.id||(view==='study'&&item.id==='decks')?'active':''} aria-current={view===item.id?'page':undefined} onClick={()=>go(item.id)}>{item.english}</button>)}</nav><section className="main-paper">
 {!online&&<div className="connection-note"><CloudOff size={14}/> 서버 연결이 필요해요. 연결 후 저장과 복습을 다시 시도해 주세요.</div>}{error&&<ErrorNotice error={error} onRetry={()=>{setLoading(true);void refresh().catch(err=>setError(errorText(err))).finally(()=>setLoading(false));}}/>}
 {syncWarning&&<ErrorNotice error={syncRetrying?'설정 사본을 다시 저장하는 중이에요.':syncWarning} onRetry={syncRetrying?undefined:()=>void retrySettingsSync()}/>}
 {loading?<Busy label="컬렉션을 불러오는 중…"/>:data&&<>
 {view==='decks'&&<DeckHome decks={data.decks} today={data.stats.today} selected={selectedDeck} onSelect={setSelectedDeck} onStudy={study} onAdd={()=>go('add')} onPhoto={()=>open({kind:'photo'})} onNew={()=>open({kind:'newDeck'})} onFiltered={()=>open({kind:'filtered'})} onFiles={()=>open({kind:'files'})} onOptions={item=>open({kind:'options',deck:item})} onRename={item=>open({kind:'rename',deck:item})} onDelete={item=>open({kind:'delete',deck:item})} onEmpty={item=>open({kind:'empty',deck:item})} onFavorite={item=>void toggleFavorite(item)} favoritePending={favoritePending} onPreview={item=>open({kind:'preview',deck:item})} onEdit={item=>open({kind:'editDeck',deck:item})} onFilterAction={filterAction} date={displayDate}/>}
 {view==='study'&&(deck?<Study key={deck.id} deck={deck} settings={settings} onBack={()=>go('decks')} onChange={refresh} onZen={()=>void changeSettings({zen:!settings.zen})}/>:<Empty title="복습할 덱이 없어요" action={<button onClick={()=>open({kind:'newDeck'})}>덱 만들기</button>}/>)}
 {view==='add'&&(data.decks.length?<NoteEditor decks={data.decks} models={data.models} initialDeckId={deck?.id} onSaved={refresh} onDirtyChange={updateAddDirty} onSavingChange={updateAddSaving} onPhoto={id=>{setSelectedDeck(id);open({kind:'photo'});}} onOcclusion={id=>{setSelectedDeck(id);open({kind:'occlusion'});}}/>:<Empty title="카드를 담을 덱을 먼저 만들어 주세요" action={<button className="primary" onClick={()=>open({kind:'newDeck'})}>덱 만들기</button>}/>)}
 {view==='browse'&&<Browser key={browseDeck?.id??'all'} decks={data.decks} models={data.models} initialQuery={searchQuery} onChange={refresh} scopeDeck={data.decks.find(item=>item.id===browseDeck?.id)||browseDeck||undefined} onLeaveScope={()=>{setSearchQuery('');setBrowseDeck(null);}}/>}
 {view==='stats'&&<Statistics stats={data.stats}/>}
 {view==='models'&&<ModelsEditor models={data.models} onChange={refresh}/>}
 {view==='settings'&&<SettingsView settings={settings} onChange={changeSettings} onAddons={()=>open({kind:'addons'})} account={account} engineVersion={auth.config?.engineVersion}/>}
 </>}</section><div className="workspace-footnote"><span>Anki core {auth.config?.engineVersion}</span><a href={import.meta.env.VITE_SOURCE_URL || "/open-source.txt"} target="_blank" rel="noopener noreferrer">소스 코드 · AGPL-3.0</a></div></div></main>
 <aside className="right-sidebar"><div className="side-note"><span className="eyebrow">오늘 복습</span><strong>{data?.stats.today||0}<small>회 완료</small></strong></div>{data&&settings.heatmap&&<div className="sidebar-heatmap"><h2>복습 달력</h2><Heatmap stats={data.stats} compact/><span className="streak-line">연속 학습 {data.stats.streak}일</span></div>}<div className="aside-memo"><h2>단어 등록</h2><p>사진에서 단어를 추출하거나 TSV·CSV 파일을 가져옵니다.</p><button onClick={()=>open({kind:'photo'})}><Camera size={14}/> 사진·파일로 추가</button></div><div className="aside-footer"><span>복습 단축키</span><p><kbd>Space</kbd> 정답 보기</p><p><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> 답변 평가</p><p><kbd>Z</kbd> 마지막 작업 되돌리기</p></div></aside>
 <nav className="bottom-nav" aria-label="모바일 탐색">{navigation.map(item=><button key={item.id} className={view===item.id?'active':''} onClick={()=>go(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}<button className={view==='settings'?'active':''} onClick={()=>go('settings')}><Settings2 size={18}/><span>설정</span></button></nav>
 {toast&&<div className="toast" role="status"><Check size={15}/>{toast}</div>}
 {dialog&&(dialog.kind==='newDeck'||dialog.kind==='rename'||dialog.kind==='delete')&&<Modal title={dialog.kind==='newDeck'?'새 덱 만들기':dialog.kind==='rename'?'덱 이름 바꾸기':'덱 삭제'} onClose={()=>setDialog(null)}>{dialog.kind==='delete'?<><p><strong>{dialog.deck?.name}</strong> 덱을 삭제할까요?</p><p className="hint">{dialog.deck?.filtered?'이 집중 복습 덱을 삭제하고 카드는 원래 덱으로 돌려보내요.':dialog.deck?.id===1?'안에 있는 카드와 하위 덱을 삭제하고 비어 있는 기본 덱은 목록에서 숨겨요.':'하위 덱과 그 안의 카드도 함께 삭제돼요. 다른 덱에 카드가 남아 있는 노트는 보존돼요.'}</p></>:<label className="field-label">덱 이름<input autoFocus value={deckName} onChange={e=>setDeckName(e.target.value)} placeholder="예: 영어::독해" onKeyDown={e=>{if(e.key==='Enter'&&deckName.trim())void saveDeck();}}/><small>::를 넣으면 하위 덱으로 만들 수 있어요.</small></label>}{dialogError&&<ErrorNotice error={dialogError}/>}<div className="form-footer"><button onClick={()=>setDialog(null)}>취소</button><button className={dialog.kind==='delete'?'danger':'primary'} disabled={busy||(dialog.kind!=='delete'&&!deckName.trim())} onClick={()=>void saveDeck()}>{busy?(dialog.kind==='delete'?'삭제 중…':'저장 중…'):dialog.kind==='delete'?'삭제':'저장'}</button></div></Modal>}
 {dialog?.kind==='empty'&&dialog.deck&&<Modal title="덱 비우기" onClose={()=>{if(!busy)setDialog(null);}}><p><strong>{dialog.deck.name}</strong> 덱의 카드를 모두 삭제할까요?</p><p className="hint">이 덱과 하위 덱의 카드를 삭제합니다. 덱 이름과 하위 덱 구조는 유지하며 다른 덱에 카드가 남아 있는 노트는 보존합니다.</p>{dialogError&&<ErrorNotice error={dialogError}/>}<div className="form-footer"><button disabled={busy} onClick={()=>setDialog(null)}>취소</button><button className="danger" disabled={busy} onClick={()=>void emptyDeck()}>{busy?'비우는 중…':'카드 모두 삭제'}</button></div></Modal>}
 {dialog?.kind==='editDeck'&&<DeckEditor key={dialog.deck.id} deck={dialog.deck} onClose={()=>setDialog(null)} onSaved={refresh} onCards={()=>{setSelectedDeck(dialog.deck.id);setBrowseDeck(dialog.deck);setSearchQuery('');setDialog(null);go('browse');}} onAdd={()=>{setSelectedDeck(dialog.deck.id);setDialog(null);go('add');}}/>}
 {dialog?.kind==='preview'&&<Modal title="카드 미리보기" className="deck-preview-modal" onClose={()=>setDialog(null)}><DeckPreview key={dialog.deck.id} deck={dialog.deck} onClose={()=>setDialog(null)}/></Modal>}
 {dialog?.kind==='options'&&dialog.deck&&<Modal title="덱 옵션" onClose={()=>setDialog(null)}><DeckOptions deck={dialog.deck} onClose={()=>{setDialog(null);void refresh().catch(err=>setError(errorText(err)));}}/></Modal>}
 {dialog?.kind==='files'&&data&&<Modal title="가져오기 · 내보내기" onClose={()=>{if(!filesBusy.current)setDialog(null);}}><FilesPanel decks={data.decks} onChange={refresh} initialFile={dialog.file} onBusyChange={value=>{filesBusy.current=value;}}/></Modal>}
 {dialog?.kind==='filtered'&&<Modal title="필터 덱 만들기" onClose={()=>setDialog(null)}><FilteredDeck onSaved={refresh} onClose={()=>setDialog(null)}/></Modal>}
 {dialog?.kind==='photo'&&data&&<Modal title="사진·파일에서 단어 가져오기" wide onClose={closePhoto}>{!deck?<Empty title="등록할 덱을 먼저 만들어 주세요" action={<><button className="primary" onClick={()=>open({kind:'newDeck'})}>덱 만들기</button><button onClick={()=>setDialog({kind:'files'})}>Anki 덱 (.apkg) 가져오기</button></>}/>:<><div className="photo-destination"><label>등록할 덱<select value={deck.id} disabled={photoSaving} onChange={e=>setSelectedDeck(Number(e.target.value))}>{data.decks.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><PhotoImport onImport={photoImport} onClose={closePhoto} initialDraft={photoDraftRef.current} onDraftChange={rememberPhotoDraft} onSavingChange={updatePhotoSaving} onAnkiFile={file=>setDialog({kind:'files',file})}/></>}</Modal>}
 {dialog?.kind==='occlusion'&&data&&<Modal title="이미지 가리기" wide onClose={closeOcclusion}><Occlusion decks={data.decks} initialDeckId={deck?.id} onSaved={refresh} onClose={closeOcclusion} onSavingChange={updateOcclusionSaving} onDirtyChange={updateOcclusionDirty}/></Modal>}
 {discardGuard.confirmation}
 {dialog?.kind==='addons'&&<Modal title="애드온과 내장 기능" wide onClose={()=>setDialog(null)}><AddonsPanel onClose={()=>setDialog(null)}/></Modal>}
 </div>;
}
