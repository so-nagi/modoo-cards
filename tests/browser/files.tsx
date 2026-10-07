import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { FilesPanel } from '../../src/components/Admin';
import '../../src/styles.css';

// Explicit local-only harness: actual upload API, controlled refresh failure.
function Harness() {
  const auth = useAuth();
  const [failRefresh, setFailRefresh] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  if (!auth.ready || auth.config?.authMode !== 'local') return <p>로컬 테스트 계정이 필요합니다.</p>;
  return <main className="skin-classic" style={{maxWidth:640,margin:'32px auto',padding:24}}>
    <h1>가져오기 결과 검증</h1>
    <label><input type="checkbox" checked={failRefresh} onChange={e=>setFailRefresh(e.target.checked)}/> 목록 새로고침 실패 재현</label>
    <p>목록 갱신 횟수: {refreshCount}</p>
    <FilesPanel decks={[]} onChange={async()=>{
      if (failRefresh) throw new Error('검증용 목록 오류');
      await api('/bootstrap');
      setRefreshCount(value=>value+1);
    }}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);
