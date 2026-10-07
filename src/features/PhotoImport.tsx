import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { Camera, Upload, FileUp, Download, RotateCw, Crop, ScanText, Plus, Trash2, X, Check, LoaderCircle } from 'lucide-react';
import { pairOcrWords, parseVocabularyText, wordsFromTesseract, type VocabularyRow } from './vocabulary';
import { decodeVocabularyFile, MAX_VOCABULARY_FILE_BYTES, parseVocabularyFile } from './vocabularyFile';
import vocabularySample from '../../samples/sample-vocabulary.tsv?raw';
import { playSound } from './sound';
import { createPhotoImportSession, remainingAfterImport } from './photoImportSession';
import { isAnkiPackage, validateImportFile } from './packageImport';
import './features.css';

export type PhotoImportDraft = {
  photo: string; filename: string; rows: VocabularyRow[]; pasted: string; rawText: string;
};
type Props = {
  onImport(rows: { word: string; meaning: string }[]): Promise<void>; onClose(): void;
  initialDraft?: PhotoImportDraft | null;
  onDraftChange?(draft: PhotoImportDraft): void;
  onSavingChange?(saving: boolean): void;
  onAnkiFile?(file?: File): void;
};
type Rect = { x: number; y: number; width: number; height: number };
type WorkerHandle = { terminate(): Promise<unknown> };

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('사진을 열 수 없어요. JPG, PNG 또는 WebP 파일을 선택해 주세요.')); image.src = source; });
}

async function transform(source: string, rotation = false, crop?: Rect): Promise<string> {
  const image = await loadImage(source);
  const width = crop ? Math.max(1, Math.round(image.naturalWidth * crop.width)) : image.naturalWidth;
  const height = crop ? Math.max(1, Math.round(image.naturalHeight * crop.height)) : image.naturalHeight;
  const scale = Math.min(1, 2400 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((rotation ? height : width) * scale);
  canvas.height = Math.round((rotation ? width : height) * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이 브라우저에서 사진을 처리할 수 없어요.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (rotation) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
  context.drawImage(image, crop ? image.naturalWidth * crop.x : 0, crop ? image.naturalHeight * crop.y : 0, width, height, 0, 0, width * scale, height * scale);
  return canvas.toDataURL('image/png');
}

export default function PhotoImport({ onImport, onClose, initialDraft, onDraftChange, onSavingChange, onAnkiFile }: Props) {
  const [photo, setPhoto] = useState(initialDraft?.photo || '');
  const [filename, setFilename] = useState(initialDraft?.filename || '');
  const [rows, setRows] = useState<VocabularyRow[]>(() => initialDraft?.rows.map(row => ({ ...row })) || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [success, setSuccess] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [pasted, setPasted] = useState(initialDraft?.pasted || '');
  const [rawText, setRawText] = useState(initialDraft?.rawText || '');
  const workerRef = useRef<WorkerHandle | null>(null);
  const runRef = useRef(0);
  const imageRunRef = useRef(0);
  const preparingRef = useRef(false);
  const importSession = useRef(createPhotoImportSession());
  const latestDraft = useRef<PhotoImportDraft>({ photo, filename, rows, pasted, rawText });
  latestDraft.current = { photo, filename, rows, pasted, rawText };
  const draftCallback = useRef(onDraftChange);
  draftCallback.current = onDraftChange;
  const cropStart = useRef<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const vocabularyFileRef = useRef<HTMLInputElement>(null);
  const selected = rows.filter(row => row.selected && row.word.trim() && row.meaning.trim());

  useEffect(() => () => { runRef.current++; imageRunRef.current++; void workerRef.current?.terminate(); }, []);
  useEffect(() => { onDraftChange?.({ photo, filename, rows, pasted, rawText }); }, [photo, filename, rows, pasted, rawText, onDraftChange]);

  async function chooseFile(file?: File) {
    if (!file || busy || saving || importSession.current.submitting) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('사진 파일을 선택해 주세요.'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('사진은 25MB 이하로 올려 주세요.'); return; }
    const imageRun = ++imageRunRef.current;
    preparingRef.current = true; setPreparing(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const source = await transform(objectUrl);
      if (imageRun !== imageRunRef.current) return;
      setPhoto(source); setFilename(file.name); setRows([]); setRawText(''); setSelection(null); setCropMode(false); setSuccess('');
      playSound('tap');
    } catch (cause) { if (imageRun === imageRunRef.current) setError(cause instanceof Error ? cause.message : '사진을 열지 못했어요.'); }
    finally { URL.revokeObjectURL(objectUrl); if (imageRun === imageRunRef.current) { preparingRef.current = false; setPreparing(false); } }
  }

  async function chooseVocabularyFile(file?: File) {
    if (!file || busy || saving || importSession.current.submitting) return;
    setError('');
    if (isAnkiPackage(file.name)) {
      const problem = validateImportFile(file);
      if (problem) { setError(problem); return; }
      if (!onAnkiFile) { setError('Anki 파일은 가져오기 · 내보내기에서 선택하세요.'); return; }
      onAnkiFile(file);
      return;
    }
    if (file.size > MAX_VOCABULARY_FILE_BYTES) { setError('단어 파일은 5MB 이하로 선택해 주세요.'); return; }
    const fileRun = ++imageRunRef.current;
    preparingRef.current = true; setPreparing(true);
    try {
      const text = decodeVocabularyFile(await file.arrayBuffer());
      const parsed = parseVocabularyFile(text, file.name);
      if (fileRun !== imageRunRef.current) return;
      setRows(parsed); setRawText(text); setFilename(file.name); setPhoto(''); setSelection(null); setCropMode(false);
      setSuccess(`${parsed.length}개 항목을 불러왔어요. 내용을 확인하고 등록할 단어를 선택해 주세요.`);
      playSound('tap');
    } catch (cause) { if (fileRun === imageRunRef.current) setError(cause instanceof Error ? cause.message : '단어 파일을 읽지 못했어요.'); }
    finally { if (fileRun === imageRunRef.current) { preparingRef.current = false; setPreparing(false); } }
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob(['\uFEFF', vocabularySample], { type: 'text/tab-separated-values;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'sample-vocabulary.tsv'; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function changePhoto(rotation: boolean) {
    if (!photo || busy || saving || preparingRef.current) return;
    const imageRun = ++imageRunRef.current;
    preparingRef.current = true; setPreparing(true);
    try {
      const source = await transform(photo, rotation, !rotation && selection ? selection : undefined);
      if (imageRun !== imageRunRef.current) return;
      setPhoto(source); setSelection(null); setCropMode(false); playSound('tap');
    }
    catch (cause) { if (imageRun === imageRunRef.current) setError(String(cause)); }
    finally { if (imageRun === imageRunRef.current) { preparingRef.current = false; setPreparing(false); } }
  }

  async function recognize() {
    if (!photo || busy || saving || preparingRef.current) return;
    const run = ++runRef.current;
    setBusy(true); setError(''); setSuccess(''); setProgress(0); setStatus('한글·영문 인식기 준비 중');
    let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
    try {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      worker = await createWorker(['kor', 'eng'], OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js', corePath: '/ocr/core/tesseract-core-lstm.wasm.js', langPath: '/ocr', gzip: false,
        logger(message) {
          if (run !== runRef.current) return;
          const recognizing = message.status === 'recognizing text';
          setStatus(recognizing ? '단어와 뜻 읽는 중' : '한글·영문 인식기 준비 중');
          setProgress(recognizing ? Math.round(message.progress * 100) : 0);
        },
      });
      if (run !== runRef.current) { await worker.terminate(); return; }
      workerRef.current = worker;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      const result = await worker.recognize(photo, {}, { text: true, blocks: true });
      if (run !== runRef.current) return;
      const words = wordsFromTesseract(result.data);
      const recognized = words.length ? pairOcrWords(words) : parseVocabularyText(result.data.text, result.data.confidence);
      setRawText(result.data.text);
      setRows(recognized);
      setStatus(`${recognized.length}개 항목을 읽었어요`);
      if (!recognized.length) setError('읽을 수 있는 단어가 없어요. 단어장 부분을 잘라내거나 사진을 밝게 찍어 다시 시도해 주세요.');
      playSound('save');
    } catch (cause) {
      if (run === runRef.current) setError(cause instanceof Error ? `사진 인식에 실패했어요: ${cause.message}` : '사진 인식에 실패했어요.');
    } finally {
      if (worker) await worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if (run === runRef.current) setBusy(false);
    }
  }

  function cancel() {
    runRef.current++; void workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setStatus('인식을 취소했어요.');
  }

  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }

  function cropPointer(event: PointerEvent<HTMLDivElement>, start: boolean) {
    if (!cropMode || busy) return;
    event.preventDefault();
    if (start) { event.currentTarget.setPointerCapture(event.pointerId); cropStart.current = point(event); }
    const origin = cropStart.current;
    if (!origin) return;
    const end = point(event);
    setSelection({ x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y) });
  }

  function updateRow(id: string, value: Partial<VocabularyRow>) { setRows(current => current.map(row => row.id === id ? { ...row, ...value } : row)); }

  async function save() {
    if (!selected.length || saving || importSession.current.submitting || preparingRef.current) return;
    setSaving(true); onSavingChange?.(true); setError(''); setSuccess('');
    try {
      const completed = await importSession.current.submit(rows, onImport);
      if (!completed) return;
      setRows(current => remainingAfterImport(current, completed.submittedIds));
      // Also update the parent's memory snapshot if it has already closed the modal.
      const draft = { ...latestDraft.current, rows: remainingAfterImport(latestDraft.current.rows, completed.submittedIds) };
      latestDraft.current = draft;
      draftCallback.current?.(draft);
      setSuccess(`${completed.count}개 단어를 등록했어요. 남은 항목을 이어서 등록하거나 다른 사진·파일을 가져올 수 있어요.`);
      playSound('save');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '등록에 실패했어요. 다시 시도해 주세요.'); }
    finally { setSaving(false); onSavingChange?.(false); }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && /\.(apkg|colpkg|tsv|csv|txt)$/i.test(file.name)) void chooseVocabularyFile(file);
    else void chooseFile(file);
  }

  return <section className="feature-panel photo-import" aria-labelledby="photo-title">
    <header className="feature-heading"><div><h2 id="photo-title">사진·파일로 단어 가져오기</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="단어 가져오기 닫기" disabled={saving}><X size={20} /></button></header>
    <p className="feature-muted">단어와 한글 뜻이 있는 사진이나 TSV·CSV 파일을 가져오세요. 내용을 확인하고 수정한 뒤 선택한 단어를 한 번에 등록해요.</p>
    <input ref={inputRef} type="file" accept="image/*" hidden onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={vocabularyFileRef} type="file" accept=".apkg,.colpkg,.tsv,.csv,.txt,text/tab-separated-values,text/csv,text/plain" aria-label="Anki·TSV·CSV 파일" hidden onChange={event => { void chooseVocabularyFile(event.target.files?.[0]); event.target.value = ''; }} />
    <div className="feature-upload" onDragOver={event => event.preventDefault()} onDrop={drop}>
      <div className="feature-button-row"><button type="button" onClick={() => vocabularyFileRef.current?.click()} disabled={busy || saving || preparing}><FileUp size={17} /> 단어 파일 선택</button><button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || saving || preparing}><Camera size={17} /> 사진 찍기</button><button type="button" onClick={() => inputRef.current?.click()} disabled={busy || saving || preparing}><Upload size={17} /> 사진 선택</button></div>
      <span className="feature-muted">Anki APKG · TSV · CSV / JPG · PNG · WebP — 파일을 여기에 놓아도 돼요</span>
      {onAnkiFile&&<p className="feature-muted">Anki 파일은 덱 구조와 카드 서식을 유지하는 가져오기 화면에서 처리해요. <button type="button" disabled={busy||saving||preparing} onClick={()=>onAnkiFile()}>Anki 덱 (.apkg) 가져오기</button></p>}
      {rows.length > 0 && <p className="feature-muted">다른 사진·파일을 선택하면 현재 목록이 바뀌어요. 남은 항목은 먼저 등록해 주세요.</p>}
    </div>
    <div className="feature-button-row"><button type="button" onClick={downloadSample}><Download size={16} /> 샘플 TSV 다운로드</button><span className="feature-muted">단어 / 한글 뜻 두 열 · UTF-8 · 최대 2,000개</span></div>
    <p className="feature-muted">AI에게 “단어와 한글 뜻 두 열의 UTF-8 TSV 파일로 만들어 줘”라고 요청해 보세요. 샘플은 형식 확인용이며 자동 등록되지 않아요.</p>
    {filename && !photo && <p className="feature-muted">가져온 파일: {filename}</p>}
    {photo && <div className="photo-workspace">
      <div className={`photo-preview ${cropMode ? 'is-cropping' : ''}`} onPointerDown={event => cropPointer(event, true)} onPointerMove={event => cropPointer(event, false)} onPointerUp={() => { cropStart.current = null; }} onPointerCancel={() => { cropStart.current = null; }}>
        <img src={photo} alt={`인식할 사진: ${filename}`} draggable={false} />
        {selection && <span className="photo-crop-selection" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />}
      </div>
      <div className="feature-button-row"><button type="button" onClick={() => void changePhoto(true)} disabled={busy || saving || preparing}><RotateCw size={16} /> 회전</button><button type="button" aria-pressed={cropMode} onClick={() => { setCropMode(!cropMode); setSelection(null); }} disabled={busy || saving || preparing}><Crop size={16} /> 범위 선택</button>{cropMode && <button type="button" onClick={() => void changePhoto(false)} disabled={busy || saving || preparing || !selection || selection.width < 0.01 || selection.height < 0.01}><Check size={16} /> 선택 범위 자르기</button>}<button type="button" className="primary" onClick={() => void recognize()} disabled={busy || saving || preparing}><ScanText size={17} /> {rows.length ? '다시 읽기' : '단어 읽어오기'}</button></div>
      {cropMode && <p className="feature-muted">사진 위에서 단어장 영역을 드래그해 주세요.</p>}
    </div>}
    {busy && <div className="ocr-progress" role="status"><LoaderCircle className="feature-spin" size={18} /><span>{status} {progress > 0 && `${progress}%`}</span><progress value={progress} max={100} aria-label="사진 인식 진행률" /><button type="button" onClick={cancel}>취소</button></div>}
    {preparing && <p className="feature-muted" role="status">파일을 준비하고 있어요…</p>}
    {success && <p className="feature-success" role="status"><Check size={17} />{success}</p>}
    {error && <p className="feature-error" role="alert">{error}</p>}
    <details className="feature-details"><summary>텍스트 붙여넣기로 등록하기</summary><label className="feature-field">단어와 뜻<textarea value={pasted} onChange={event => setPasted(event.target.value)} placeholder={'apple 사과\ncarry 나르다, 휴대하다'} rows={4} /></label><button type="button" onClick={() => { setRows(parseVocabularyText(pasted)); setRawText(pasted); setSuccess(''); }} disabled={!pasted.trim() || busy || saving || preparing}>목록으로 바꾸기</button>{rows.length > 0 && <p className="feature-muted">붙여넣은 내용으로 현재 목록을 바꿔요.</p>}</details>
    {rows.length > 0 && <>
      <div className="feature-list-heading"><h3>단어 확인 <span>{rows.length}</span></h3><label><input type="checkbox" checked={rows.every(row => row.selected)} onChange={event => setRows(current => current.map(row => ({ ...row, selected: event.target.checked })))} disabled={saving} /> 모두 선택</label></div>
      <p className="feature-muted">여러 뜻과 줄바꿈은 그대로 저장해요. 파일의 예문 열은 뜻 뒤에 ‘예문:’으로 붙어요. 뜻이 비어 있거나 흐리게 읽힌 항목은 직접 확인해 주세요. 이 목록 안의 같은 단어·뜻은 처음에 한 번만 선택해요.</p>
      <div className="vocabulary-table-wrap"><table className="vocabulary-table"><thead><tr><th scope="col">선택</th><th scope="col">단어</th><th scope="col">한글 뜻</th><th scope="col">인식 상태</th><th scope="col">삭제</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} className={!row.word.trim() || !row.meaning.trim() ? 'needs-review' : ''}>
        <td><input type="checkbox" aria-label={`${index + 1}번 단어 선택`} checked={row.selected} onChange={event => updateRow(row.id, { selected: event.target.checked })} disabled={saving} /></td>
        <td><input aria-label={`${index + 1}번 단어`} value={row.word} onChange={event => updateRow(row.id, { word: event.target.value })} disabled={saving} /></td>
        <td><textarea aria-label={`${index + 1}번 한글 뜻`} value={row.meaning} onChange={event => updateRow(row.id, { meaning: event.target.value })} rows={2} disabled={saving} /></td>
        <td><span className="feature-status">{row.duplicate ? '중복' : row.confidence === 0 ? '직접 확인' : row.confidence < 75 ? `확인 필요 ${row.confidence}%` : `${row.confidence}%`}</span><details><summary>원문</summary><pre>{row.source}</pre></details></td>
        <td><button type="button" className="icon-button" aria-label={`${index + 1}번 단어 삭제`} onClick={() => { setRows(current => current.filter(item => item.id !== row.id)); playSound('delete'); }} disabled={saving}><Trash2 size={16} /></button></td>
      </tr>)}</tbody></table></div>
      {rawText && <details className="feature-details"><summary>가져온 전체 원문</summary><pre className="ocr-raw">{rawText}</pre></details>}
    </>}
    <footer className="feature-footer"><button type="button" onClick={() => setRows(current => [...current, { id: `manual-${crypto.randomUUID()}`, word: '', meaning: '', selected: true, confidence: 0, source: '직접 입력' }])} disabled={busy || saving || preparing}><Plus size={17} /> 직접 추가</button><button type="button" className="primary" onClick={() => void save()} disabled={!selected.length || saving || busy || preparing}>{saving ? <LoaderCircle className="feature-spin" size={17} /> : <Check size={17} />}{saving ? '등록하는 중' : `${selected.length}개 단어 등록`}</button></footer>
    <p className="feature-privacy">사진 인식과 파일 읽기는 이 브라우저에서 처리해요. 선택한 단어와 뜻만 등록돼요.</p>
    {onDraftChange && <p className="feature-privacy">닫았다가 다시 열면 미등록 내용을 이어서 편집할 수 있어요. 새로고침하거나 로그아웃하면 초안은 초기화돼요.</p>}
  </section>;
}
