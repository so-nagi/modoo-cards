import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Check, Moon, Sun, Volume2 } from 'lucide-react';
import { getSoundDiagnostics, playSound, setSoundPreferences, soundUrl, subscribeSoundDiagnostics } from '../features/sound';
import type { Settings as AppSettings } from '../types';
import { CardFrame, Toggle } from './ui';
import { CARD_FONT_SIZE, normalizeCardFontSize } from './cardAppearance';
import './settings-card-font.css';
import SchedulerSettings from './SchedulerSettings';

const fontSample = '<div>gravity</div><hr><div>중력</div>';
function NativeSoundPreview({enabled,volume}:{enabled:boolean;volume:number}) {
 const media = useRef<HTMLAudioElement>(null);
 const [duration,setDuration]=useState<number|null>(null),[state,setState]=useState('재생 전');
 useEffect(()=>{const audio=media.current;if(!audio)return;audio.volume=volume;audio.muted=!enabled;if(!enabled||volume===0)audio.pause();},[enabled,volume]);
 return <details className="fine-print"><summary>음원 직접 재생</summary><p>클릭음 한 개는 0.12~0.19초여서 기본 재생기에 0:00으로 표시됩니다. 아래는 같은 음원 7개를 이어 붙인 약 4초 확인용 파일입니다.</p><audio ref={media} controls={enabled} preload="metadata" src="/sounds/banana-split-lubed/preview.wav" aria-label="Banana Split 7종 연속 재생" style={{width:'100%',maxWidth:360}} onLoadedMetadata={event=>{const seconds=event.currentTarget.duration;setDuration(Number.isFinite(seconds)?seconds:null);setState('음원 준비 완료');}} onError={event=>setState(`음원 오류 (${event.currentTarget.error?.code??'확인 필요'})`)} onPlaying={()=>setState('브라우저 재생 중')} onEnded={()=>setState('브라우저 재생 완료')} onPlay={event=>{event.currentTarget.volume=volume;event.currentTarget.muted=!enabled;if(!enabled||volume===0)event.currentTarget.pause();}}/><p role="status">{state}{duration!==null?` · ${duration.toFixed(2)}초`:''}</p><a href={soundUrl('save')} target="_blank" rel="noreferrer">클릭음 한 개를 새 탭에서 열기</a>{!enabled&&<p>효과음을 켜면 재생할 수 있습니다.</p>}</details>;
}
function CardFontSizeSetting({size,onChange}:{size:number;onChange:(size:number)=>Promise<void>}) {
 const normalized = normalizeCardFontSize(size), [preview,setPreview] = useState(normalized), committed = useRef(normalized), inputId = useId();
 useEffect(()=>{setPreview(normalized);committed.current=normalized;},[normalized]);
 const commit=(size:number)=>{const next=normalizeCardFontSize(size);setPreview(next);if(committed.current===next)return;committed.current=next;void onChange(next);};
 return <section className="settings-section card-font-settings">
  <h2><label htmlFor={inputId}>카드 글자 크기</label></h2>
  <p className="fine-print">복습과 모든 카드 미리보기에 적용됩니다.</p>
  <div className="card-font-controls">
   <input id={inputId} type="range" min={CARD_FONT_SIZE.min} max={CARD_FONT_SIZE.max} step={1} value={preview} aria-valuetext={`${preview}픽셀`} onChange={event=>setPreview(normalizeCardFontSize(Number(event.target.value)))} onPointerUp={event=>commit(Number(event.currentTarget.value))} onPointerCancel={event=>commit(Number(event.currentTarget.value))} onKeyUp={event=>commit(Number(event.currentTarget.value))} onBlur={event=>commit(Number(event.currentTarget.value))}/>
   <output htmlFor={inputId}>{preview}px</output>
   <button type="button" disabled={preview===CARD_FONT_SIZE.default} onClick={()=>commit(CARD_FONT_SIZE.default)}>기본값 {CARD_FONT_SIZE.default}px</button>
  </div>
  <div className="card-font-sample" data-card-font-size-preview style={{'--card-font-size':`${preview}px`} as CSSProperties}>
   <CardFrame html={fontSample} title="카드 글자 크기 미리보기" contentKey="font-size-sample"/>
  </div>
  <p className="fine-print">가져온 카드의 기본 글자는 원래 크기에 비례해 조절됩니다. 개별 문장에 지정된 크기와 이미지는 유지됩니다.</p>
 </section>;
}
export default function Settings({settings,onChange,onAddons,account,engineVersion}:{settings:AppSettings;onChange:(patch:Partial<AppSettings>)=>Promise<void>;onAddons:()=>void;account:React.ReactNode;engineVersion?:string}){
 const [volume,setVolume]=useState(settings.volume);
 const [soundStatus,setSoundStatus]=useState(getSoundDiagnostics);
 useEffect(()=>subscribeSoundDiagnostics(setSoundStatus),[]);
 useEffect(()=>setVolume(settings.volume),[settings.volume]);
 return <div className="settings-view"><div className="page-heading"><div><h1>설정</h1></div></div><section className="settings-section"><h2>테마와 포인트색</h2><div className="theme-options">{([{key:'light',name:'라이트',icon:<Sun size={15}/>},{key:'neutral',name:'내추럴',icon:<span className="neutral-icon"/>},{key:'dark',name:'다크',icon:<Moon size={15}/>} ] as const).map(theme=><button key={theme.key} className={settings.theme===theme.key?'selected':''} aria-pressed={settings.theme===theme.key} onClick={()=>void onChange({theme:theme.key})}>{theme.icon}{theme.name}</button>)}</div><div className="accent-row"><span>포인트색</span><div className="swatches">{['#3a3632','#5f7467','#6b8195','#a57770','#978458','#847391'].map(color=><button key={color} className="swatch" title={color} aria-label={`포인트색 ${color}`} aria-pressed={settings.accent===color} style={{background:color}} onClick={()=>void onChange({accent:color})}>{settings.accent===color&&<Check size={12}/>}</button>)}<label className="custom-color" title="직접 고른 색"><input type="color" aria-label="포인트색 직접 고르기" value={settings.accent} onChange={e=>void onChange({accent:e.target.value})}/><span>+</span></label></div></div><p className="fine-print">기본 글꼴 · Pretendard. 가져온 카드에 지정된 글꼴은 유지됩니다.</p></section><CardFontSizeSetting size={settings.cardFontSize} onChange={cardFontSize=>onChange({cardFontSize})}/><section className="settings-section" data-sound-phase={soundStatus.phase} data-sound-context={soundStatus.contextState} data-sound-plays={soundStatus.playCount} data-sound-time={soundStatus.currentTimeSeconds??undefined} data-sound-duration={soundStatus.durationSeconds??undefined} data-sound-message={soundStatus.message}><h2>클릭 효과음</h2><Toggle label="효과음" description="Banana Split Lubed · 7종. 메뉴 이동, 정답 확인, 답변 선택 시 재생합니다." checked={settings.sounds} onChange={sounds=>void onChange({sounds})}/><div className="volume-row"><Volume2 size={15}/><input type="range" aria-label="효과음 음량" min="0" max="1" step="0.01" value={volume} disabled={!settings.sounds} onChange={e=>{const value=Number(e.target.value);setVolume(value);setSoundPreferences({enabled:settings.sounds,volume:value});}} onPointerUp={()=>void onChange({volume})} onKeyUp={()=>void onChange({volume})}/><span>{Math.round(volume*100)}%</span><button disabled={!settings.sounds} onClick={()=>{setSoundPreferences({enabled:settings.sounds,volume});playSound('save');}}>들어보기</button></div><p className="fine-print" role="status">{soundStatus.message}{soundStatus.durationSeconds!==null?` · 클릭음 ${Math.round(soundStatus.durationSeconds*1000)}ms`:''}{` · 음량 ${Math.round(volume*100)}%`}</p><details className="fine-print"><summary>재생 상태 자세히</summary><p>{soundStatus.contextState} · 재생 확인 {soundStatus.playCount}회</p><p>준비 단계 {soundStatus.readyState??'—'} · 네트워크 단계 {soundStatus.networkState??'—'} · 파일 오류 {soundStatus.mediaError??'없음'}</p><p>브라우저의 재생 완료 표시는 실제 스피커 출력 여부와 다를 수 있습니다.</p></details><NativeSoundPreview enabled={settings.sounds} volume={volume}/></section><SchedulerSettings/><section className="settings-section"><h2>학습 도구</h2><Toggle label="학습 달력" description="날짜별 복습 횟수를 표시합니다." checked={settings.heatmap} onChange={heatmap=>void onChange({heatmap})}/><Toggle label="남은 시간 예상" description="평균 답변 시간으로 남은 복습 시간을 계산합니다." checked={settings.remainingTime} onChange={remainingTime=>void onChange({remainingTime})}/><Toggle label="집중 모드" description="복습 중 좌우 패널을 숨깁니다." checked={settings.zen} onChange={zen=>void onChange({zen})}/><div className="addon-shortcut"><span>내장 기능 목록</span><button onClick={onAddons}>내장 기능 보기 →</button></div></section><section className="settings-section"><h2>계정과 동기화</h2>{account}<p className="fine-print">학습 데이터는 서버의 계정별 Anki 컬렉션에 저장돼요. 복습하려면 서버 연결이 필요해요.</p></section><p className="version-note">모두카드 · Anki core {engineVersion||'연결 중'}</p></div>;
}

