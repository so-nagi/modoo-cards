import { useRef, useState } from 'react';
import { CalendarDays, Pin, Table2, Scan, Timer, Keyboard, Volume2, PackageSearch, X, ExternalLink } from 'lucide-react';
import { inspectAddon, type AddonInspection } from './addonInspector';
import './features.css';

const equivalents = [
  { icon: CalendarDays, name: '복습 히트맵', source: 'Review Heatmap', description: '날짜별 복습량과 연속 학습일을 통계에서 확인해요.', url: 'https://github.com/glutanimate/review-heatmap' },
  { icon: Pin, name: '필드 고정', source: 'Frozen Fields', description: '카드 추가 화면에서 핀을 누르면 다음 카드에도 필드 내용이 남아요.', url: 'https://github.com/glutanimate/frozen-fields' },
  { icon: Table2, name: '카드 탐색기', source: 'Advanced Browser', description: '검색식, 열 선택, 정렬로 카드를 찾아 편집하고 일괄 작업해요.', url: 'https://github.com/AnKing-VIP/advanced-browser' },
  { icon: Scan, name: '이미지 가리기', source: 'Image Occlusion', description: '사진 위에 사각형을 그려 가려진 부분을 맞히는 카드를 만들어요.', url: 'https://docs.ankiweb.net/editing.html#image-occlusion' },
  { icon: Timer, name: '복습 진행과 집중 모드', source: '앱 기본 기능', description: '남은 카드와 예상 시간을 확인하고 집중 모드로 복습해요.' },
  { icon: Keyboard, name: '키보드 복습', source: '앱 기본 기능', description: 'Space로 답 보기, 1–4로 평가, Z로 되돌리기.' },
  { icon: Volume2, name: '단어 읽어주기', source: '기기의 음성', description: '브라우저에 설치된 음성으로 단어를 들어요. 사용 가능한 언어·음성은 기기마다 달라요.' },
];

export default function AddonsPanel({ onClose }: { onClose(): void }) {
  const [inspection, setInspection] = useState<AddonInspection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function inspect(file?: File) {
    if (!file) return;
    setError(''); setInspection(null);
    if (!/\.(?:ankiaddon|zip)$/i.test(file.name)) { setError('.ankiaddon 또는 ZIP 패키지를 선택해 주세요.'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('확장 패키지는 25MB 이하로 선택해 주세요.'); return; }
    setBusy(true);
    try { setInspection(inspectAddon(new Uint8Array(await file.arrayBuffer()), file.name)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '패키지를 읽을 수 없어요.'); }
    finally { setBusy(false); }
  }

  return <section className="feature-panel addons-panel" aria-labelledby="addons-title">
    <header className="feature-heading"><div><p className="feature-eyebrow">BUILT-IN FEATURES</p><h2 id="addons-title">기본으로 들어 있는 확장 기능</h2></div><button type="button" className="icon-button" aria-label="확장 기능 닫기" onClick={onClose}><X size={20} /></button></header>
    <p className="feature-muted">자주 쓰이는 안키 확장 기능의 역할을 웹앱에 담았어요. 별도 설치 없이 각 화면에서 사용할 수 있어요.</p>
    <div className="addons-list">{equivalents.map(({ icon: Icon, name, source, description, url }) => <article className="addon-row" key={name}><Icon size={19} aria-hidden="true" /><div><h3>{name}</h3><p>{description}</p>{url ? <a href={url} target="_blank" rel="noreferrer">{source} 참고 <ExternalLink size={10} /></a> : <span className="feature-muted">{source}</span>}</div><span className="addon-badge">내장</span></article>)}</div>
    <div className="addon-inspection">
      <h3>가지고 있는 안키 확장 확인</h3>
      <p className="feature-muted">안키의 .ankiaddon은 데스크톱 Python·Qt 환경에서 동작해요. 이 웹앱에 그대로 설치하거나 실행할 수는 없어요. 패키지를 선택하면 이름과 의존성을 살펴보고 대응하는 내장 기능을 안내해요.</p>
      <input type="file" ref={inputRef} hidden accept=".ankiaddon,.zip" onChange={event => { void inspect(event.target.files?.[0]); event.target.value = ''; }} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}><PackageSearch size={17} />{busy ? '확인하는 중' : '확장 패키지 확인'}</button>
      <p className="feature-privacy">파일은 이 브라우저에서만 살펴봐요. 확장 코드를 실행하지 않아요.</p>
      {error && <p className="feature-error" role="alert">{error}</p>}
      {inspection && <div role="status"><span className="unsupported">{inspection.compatibility === 'desktop-only' ? '데스크톱 전용 · 웹 실행 미지원' : '지원하지 않는 확장 형식'}</span><dl><dt>이름</dt><dd>{inspection.name}</dd><dt>버전</dt><dd>{inspection.version}</dd><dt>패키지</dt><dd>{inspection.package}</dd><dt>파일</dt><dd>{inspection.fileCount}개 · Python {inspection.pythonFiles}개</dd><dt>발견한 의존성</dt><dd>{inspection.dependencies.join(', ') || '정적 검사에서 식별되지 않음'}</dd><dt>내장 기능</dt><dd>{inspection.equivalent || '직접 대응하는 내장 기능을 찾지 못했어요.'}</dd></dl>{inspection.warnings.length > 0 && <ul>{inspection.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}<p className="feature-muted">패키지 확인은 정적 분석이에요. 의존성이나 호환성을 모두 검증하는 것은 아니에요.</p></div>}
    </div>
  </section>;
}
