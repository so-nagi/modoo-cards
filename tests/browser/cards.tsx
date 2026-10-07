import React, { useCallback, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { CardFrame } from '../../src/components/ui';
import type { Skin } from '../../src/types';
import '../../src/styles.css';

// Development-only real-component harness. Constants intentionally stay unchanged
// while skin/theme controls rerender the parent, exposing unintended iframe reloads.
const stockCss = `.card {
  font-family: arial;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: black;
  background-color: white;
}`;
const stockHtml = '<div>gravity</div><hr><div>중력</div><p><input aria-label="입력 유지 확인" placeholder="입력 유지 확인" value=""></p>';
const customCss = '.card { font-family: Georgia, serif; font-size: 26px; line-height: 1.6; color: #173a2e; background-color: #fff0c2; text-align: center; } .custom-label { font-weight: 700; color: #6a2244; }';
const customHtml = '<div class="custom-label">Custom template</div><hr><div>Georgia · #173a2e · #fff0c2</div><p><input aria-label="사용자 카드 입력 유지 확인" placeholder="사용자 카드 입력 유지 확인" value=""></p>';

function Harness() {
  const [skin, setSkin] = useState<Skin>('classic');
  const [fontSize, setFontSize] = useState(20);
  const [theme, setTheme] = useState('light'), [accent, setAccent] = useState('#3a3632');
  const [stockReady, setStockReady] = useState(0), [customReady, setCustomReady] = useState(0);
  const readyStock = useCallback(() => setStockReady(count => count + 1), []);
  const readyCustom = useCallback(() => setCustomReady(count => count + 1), []);
  return <div className={`app-shell card-qa skin-${skin} theme-${theme}`} style={{ '--accent': accent, '--card-font-size': `${fontSize}px`, padding: 24, minHeight: '100vh' } as CSSProperties}>
    <style>{`.card-qa-content{max-width:640px;margin:auto}.card-qa-controls{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:20px 0}.card-qa-controls label{display:grid;gap:6px;font-size:.75rem}.card-qa-controls select{width:170px}.card-qa-controls input[type=color]{width:54px;height:42px}.card-qa-section{margin:24px 0}.card-qa-section>.card-frame{height:330px;min-height:330px}.card-qa-state{display:flex;gap:20px;font-size:.7rem;color:var(--text-soft)}.card-qa-section>h2{font-size:.8rem}`}</style>
    <main className="card-qa-content">
      <h1>카드 스킨 로컬 검증</h1>
      <div className="card-qa-controls">
        <label>검증 스킨<select aria-label="검증 스킨" value={skin} onChange={event => setSkin(event.target.value as Skin)}>{['classic'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>검증 테마<select aria-label="검증 테마" value={theme} onChange={event => setTheme(event.target.value)}>{['light', 'dark', 'neutral'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>검증 글자 크기<input type="number" aria-label="검증 글자 크기" min={14} max={40} value={fontSize} onChange={event=>setFontSize(Number(event.target.value))}/></label>
        <label>검증 강조색<input aria-label="검증 강조색" type="color" value={accent} onChange={event => setAccent(event.target.value)} /></label>
        <button onClick={() => setAccent('#c5cfd8')}>파랑 회색</button>
        <button onClick={() => setAccent('#a57770')}>분홍 갈색</button>
      </div>
      <div className="card-qa-state" role="status"><span data-testid="stock-ready">기본 카드 준비: {stockReady}회</span><span data-testid="custom-ready">사용자 카드 준비: {customReady}회</span></div>
      <nav className="page-tabs" aria-label="상단 탭 검증">{['DECKS', 'ADD', 'BROWSE', 'STATS'].map((name,index) => <button key={name} className={index===0?'active':''}>{name}</button>)}</nav>
      <section className="card-qa-section" data-testid="stock-card">
        <h2>기본 Anki 카드 · 테마와 PretendardLocal 적용</h2>
        <CardFrame html={stockHtml} css={stockCss} title="기본 카드 스킨 검증" contentKey="qa-stock-stable" onReady={readyStock} />
      </section>
      <section className="card-qa-section" data-testid="custom-card">
        <h2>사용자 지정 카드 · Georgia와 지정 색상 유지</h2>
        <CardFrame html={customHtml} css={customCss} title="사용자 지정 카드 스킨 검증" contentKey="qa-custom-stable" onReady={readyCustom} />
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
