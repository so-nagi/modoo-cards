import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Crop, Group, Hand, ImagePlus, Redo2, RotateCw, Trash2, Undo2, Ungroup, ZoomIn, ZoomOut } from 'lucide-react';
import { api } from '../api';
import { playSound } from '../features/sound';
import type { Deck } from '../types';
import { ErrorNotice, errorText } from './ui';
import { boundedPoint, drawnRect, groupMasks, maskPayload, maskSelection, MIN_MASK_SIZE, moveMasks, problemCount, resizeFromDrag, resizeRect, selectMasks, ungroupMasks, type MaskRect, type OcclusionMask, type Point, type ResizeCorner } from './occlusionGeometry';
import { commitOcclusionHistory, createOcclusionHistory, maskHistoryShortcut, redoOcclusionHistory, undoOcclusionHistory, type OcclusionHistory, type OcclusionSnapshot } from './occlusionHistory';
import { planImageCrop, rotateMasksClockwise, transformOcclusionImage, type ImageTransform } from './occlusionImage';
import './occlusion-editor.css';

type Interaction = {
  pointerId: number;
  mode: 'draw' | 'pending' | 'move' | 'resize' | 'crop' | 'pan';
  start: Point;
  client: Point;
  initial: OcclusionMask[];
  ids: string[];
  maskId?: string;
  corner?: ResizeCorner;
  scroll?: Point;
};
const corners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
const cornerNames = { nw: '왼쪽 위', ne: '오른쪽 위', sw: '왼쪽 아래', se: '오른쪽 아래' };
const cornerPoint = (mask: MaskRect, corner: ResizeCorner): Point => ({ x: mask.x + (corner.includes('e') ? mask.width : 0), y: mask.y + (corner.includes('s') ? mask.height : 0) });
const isTextControl = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');

export default function Occlusion({ decks, initialDeckId, initialImage, onSaved, onClose, onSavingChange, onDirtyChange }: {
  decks: Deck[]; initialDeckId?: number; initialImage?: { filename: string; url: string }; onSaved: () => Promise<void>; onClose: () => void;
  onSavingChange?: (saving: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [deckId, setDeckId] = useState(initialDeckId || decks[0]?.id || 0), [header, setHeader] = useState('');
  const [filename, setFilename] = useState(initialImage?.filename || ''), [imageUrl, setImageUrl] = useState(''), [imageReady, setImageReady] = useState(false);
  const [masks, setMasks] = useState<OcclusionMask[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [drawing, setDrawing] = useState<MaskRect | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [savedCount, setSavedCount] = useState<number | null>(null), [history, setHistory] = useState(() => createOcclusionHistory({ masks: [], filename, imageUrl }));
  const [zoom, setZoom] = useState(100), [tool, setTool] = useState<'mask' | 'pan' | 'crop'>('mask');
  const [cropRect, setCropRect] = useState<MaskRect | null>(null), [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null), viewportRef = useRef<HTMLDivElement>(null), imageRef = useRef<HTMLImageElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const masksRef = useRef(masks), selectedRef = useRef(selected), drawingRef = useRef(drawing), busyRef = useRef(false), historyRef = useRef(history);
  const zoomRef = useRef(zoom), spaceRef = useRef(false), toolRef = useRef(tool);
  const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const interaction = useRef<Interaction | null>(null), holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true), imageUrlRef = useRef(imageUrl), uploadSequence = useRef(0), uploadController = useRef<AbortController | null>(null), saveController = useRef<AbortController | null>(null);
  const savingChange = useRef(onSavingChange), dirtyChange = useRef(onDirtyChange); savingChange.current = onSavingChange; dirtyChange.current = onDirtyChange;
  const imageBlobs = useRef(new Set<string>());
  const pinImage = (blob: Blob) => { const url=URL.createObjectURL(blob);imageBlobs.current.add(url);return url; };

  const replaceMasks = (next: OcclusionMask[]) => { masksRef.current = next; setMasks(next); };
  const select = (next: string[]) => { selectedRef.current = next; setSelected(next); };
  const draw = (next: MaskRect | null) => { drawingRef.current = next; setDrawing(next); };
  const lock = (next: boolean) => { busyRef.current = next; setBusy(next); savingChange.current?.(next); };
  const clearHold = () => { if (holdTimer.current !== null) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const cancelInteraction = (restore = true) => {
    clearHold();
    const current = interaction.current; interaction.current = null; draw(null);
    if (restore && current && (current.mode === 'move' || current.mode === 'resize')) replaceMasks(current.initial);
    if (current && canvasRef.current?.hasPointerCapture(current.pointerId)) canvasRef.current.releasePointerCapture(current.pointerId);
  };
  const useTool = (next: typeof tool) => { cancelInteraction(); toolRef.current = next; setTool(next); setCropRect(null); };
  const applySnapshot = (snapshot: OcclusionSnapshot) => {
    if (imageUrlRef.current !== snapshot.imageUrl) { setImageReady(false); imageUrlRef.current = snapshot.imageUrl; setImageUrl(snapshot.imageUrl); }
    setFilename(snapshot.filename); replaceMasks(snapshot.masks);
    select(selectedRef.current.filter(id => snapshot.masks.some(mask => mask.id === id)));
  };
  const applyHistory = (next: OcclusionHistory) => {
    historyRef.current = next; setHistory(next); applySnapshot(next.present);
    const retained=new Set([...next.past,next.present,...next.future].map(snapshot=>snapshot.imageUrl));
    for(const url of imageBlobs.current)if(!retained.has(url)){URL.revokeObjectURL(url);imageBlobs.current.delete(url);}
  };
  const commitMasks = (next: OcclusionMask[]) => applyHistory(commitOcclusionHistory(historyRef.current, { ...historyRef.current.present, masks: next }));
  const stepHistory = (direction: 'undo' | 'redo') => {
    if (busyRef.current || savedCount !== null) return;
    cancelInteraction(); setCropRect(null);
    canvasRef.current?.focus({ preventScroll: true });
    applyHistory(direction === 'undo' ? undoOcclusionHistory(historyRef.current) : redoOcclusionHistory(historyRef.current));
  };

  useEffect(() => { dirtyChange.current?.(savedCount === null && (!!filename || !!header.trim() || masks.length > 0)); }, [filename, header, masks.length, savedCount]);
  useEffect(() => {
    live.current = true;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.occlusion-editor') && !interaction.current) { selectedRef.current = []; setSelected([]); }
    };
    const releaseSpace = () => { spaceRef.current = false; setSpaceHeld(false); };
    const keyUp = (event: globalThis.KeyboardEvent) => { if (event.code === 'Space') releaseSpace(); };
    const blur = () => { releaseSpace(); cancelInteraction(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
    return () => {
      live.current = false; uploadSequence.current++;
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      uploadController.current?.abort(); saveController.current?.abort(); savingChange.current?.(false); dirtyChange.current?.(false);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur);
      interaction.current = null;
      for(const url of imageBlobs.current)URL.revokeObjectURL(url);imageBlobs.current.clear();
    };
  }, []);

  useEffect(() => {
    if(!initialImage)return;
    const controller=new AbortController();lock(true);
    void fetch(initialImage.url,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('이미지를 불러오지 못했습니다. 다시 열어 주세요.');
      const blob=await response.blob();
      if(live.current&&!controller.signal.aborted)applyHistory(createOcclusionHistory({masks:[],filename:initialImage.filename,imageUrl:pinImage(blob)}));
    }).catch(cause=>{if(live.current&&!controller.signal.aborted)setError(errorText(cause));}).finally(()=>{if(live.current&&!controller.signal.aborted)lock(false);});
    return()=>controller.abort();
  }, []);

  const changeZoom = (next: number, anchor?: { clientX: number; clientY: number }) => {
    if (interaction.current) return;
    const rect = canvasRef.current?.getBoundingClientRect(), viewport = viewportRef.current?.getBoundingClientRect();
    const clamped = Math.max(25, Math.min(400, Math.round(next)));
    if (clamped === zoomRef.current) return;
    if (rect && viewport) {
      const clientX = anchor?.clientX ?? viewport.left + viewport.width / 2, clientY = anchor?.clientY ?? viewport.top + viewport.height / 2;
      zoomAnchor.current = { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height, clientX, clientY };
    }
    zoomRef.current = clamped; setZoom(clamped);
  };
  const zoomHandler = useRef(changeZoom); zoomHandler.current = changeZoom;
  useEffect(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      zoomHandler.current(zoomRef.current * Math.exp(-delta * .002), event);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [imageUrl]);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current, viewport = viewportRef.current, rect = canvasRef.current?.getBoundingClientRect();
    zoomAnchor.current = null;
    if (anchor && viewport && rect) { viewport.scrollLeft += rect.left + anchor.x * rect.width - anchor.clientX; viewport.scrollTop += rect.top + anchor.y * rect.height - anchor.clientY; }
  }, [zoom]);

  const upload = async (file: File) => {
    if (busyRef.current) return;
    cancelInteraction(); lock(true); setError(''); dirtyChange.current?.(true);
    const request = ++uploadSequence.current, controller = new AbortController();
    uploadController.current?.abort(); uploadController.current = controller;
    try {
      const body = new FormData(); body.append('file', file);
      const result = await api<{ filename: string; url: string }>('/media', { method: 'POST', body, signal: controller.signal });
      if (!live.current || controller.signal.aborted || request !== uploadSequence.current) return;
      // Keep editable images locally; signed server URLs expire after five minutes.
      applyHistory(createOcclusionHistory({ masks: [], filename: result.filename, imageUrl: pinImage(file) }));
      select([]); setSavedCount(null); zoomRef.current = 100; setZoom(100); useTool('mask');
    } catch (cause) { if (live.current && !controller.signal.aborted) { setError(errorText(cause)); dirtyChange.current?.(!!historyRef.current.present.filename || !!header.trim()); } }
    finally { if (live.current && request === uploadSequence.current) lock(false); }
  };

  const transformImage = async (transform: ImageTransform, nextMasks: OcclusionMask[]) => {
    const image = imageRef.current;
    if (busyRef.current || savedCount !== null || !imageReady || !image) return;
    cancelInteraction(); lock(true); setError('');
    const controller = new AbortController(); uploadController.current = controller;
    try {
      const file = await transformOcclusionImage(image, transform, filename);
      if (!live.current || controller.signal.aborted) return;
      const body = new FormData(); body.append('file', file);
      const result = await api<{ filename: string; url: string }>('/media', { method: 'POST', body, signal: controller.signal });
      if (!live.current || controller.signal.aborted) return;
      applyHistory(commitOcclusionHistory(historyRef.current, { masks: nextMasks, filename: result.filename, imageUrl: pinImage(file) }));
      useTool('mask');
    } catch (cause) { if (live.current && !controller.signal.aborted) setError(errorText(cause)); }
    finally { if (live.current) lock(false); }
  };
  const point = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: (event.clientX - rect.left) / Math.max(1, rect.width), y: (event.clientY - rect.top) / Math.max(1, rect.height) } : { x: 0, y: 0 };
  };
  const choose = (id: string, additive = false) => {
    const next = selectMasks(selectedRef.current, maskSelection(masksRef.current, id), additive); select(next); return next;
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (busyRef.current || !imageReady || savedCount !== null || event.button !== 0 || interaction.current) return;
    const element = event.target as Element, handle = element.closest<HTMLButtonElement>('[data-mask-handle]');
    const id = handle?.dataset.maskId || element.closest<SVGRectElement>('[data-mask-id]')?.dataset.maskId;
    const current = point(event), base: Interaction = { pointerId: event.pointerId, mode: 'draw', start: current, client: { x: event.clientX, y: event.clientY }, initial: masksRef.current, ids: [] };
    event.preventDefault(); (handle || event.currentTarget).focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    if (spaceRef.current || toolRef.current === 'pan') {
      base.mode = 'pan'; base.scroll = { x: viewportRef.current?.scrollLeft || 0, y: viewportRef.current?.scrollTop || 0 };
    } else if (toolRef.current === 'crop') { base.mode = 'crop'; setCropRect(null); draw({ ...boundedPoint(current), width: 0, height: 0 }); }
    else if (id) {
      const wasSelected = selectedRef.current.includes(id);
      base.ids = event.shiftKey && !handle ? choose(id, true) : wasSelected ? selectedRef.current : choose(id); base.maskId = id;
      if (handle) { base.mode = 'resize'; base.corner = handle.dataset.maskHandle as ResizeCorner; }
      else if (wasSelected && !event.shiftKey) base.mode = 'move';
      else {
        base.mode = 'pending';
        if (!event.shiftKey) holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          if (!live.current || interaction.current !== base || busyRef.current) return;
          base.mode = 'move';
        }, 350);
      }
    } else { select([]); draw({ ...boundedPoint(current), width: 0, height: 0 }); }
    interaction.current = base;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = interaction.current; if (!current || current.pointerId !== event.pointerId) return;
    const at = point(event);
    if (current.mode === 'pending') { if (Math.hypot(event.clientX - current.client.x, event.clientY - current.client.y) > 6) clearHold(); }
    else if (current.mode === 'pan') {
      if (viewportRef.current && current.scroll) { viewportRef.current.scrollLeft = current.scroll.x + current.client.x - event.clientX; viewportRef.current.scrollTop = current.scroll.y + current.client.y - event.clientY; }
    } else if (current.mode === 'draw' || current.mode === 'crop') draw(drawnRect(current.start, at));
    else if (current.mode === 'move') replaceMasks(moveMasks(current.initial, current.ids, { x: at.x - current.start.x, y: at.y - current.start.y }));
    else if (current.maskId && current.corner) {
      const mask = current.initial.find(item => item.id === current.maskId);
      if (mask) replaceMasks(current.initial.map(item => item.id === mask.id ? { ...item, ...resizeFromDrag(mask, current.corner!, current.start, at) } : item));
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = interaction.current; if (!current || current.pointerId !== event.pointerId) return;
    clearHold(); const rectangle = drawingRef.current;
    if (rectangle && rectangle.width >= MIN_MASK_SIZE && rectangle.height >= MIN_MASK_SIZE) {
      if (current.mode === 'draw') { const mask = { ...rectangle, id: crypto.randomUUID() }; commitMasks([...masksRef.current, mask]); select([mask.id]); }
      else if (current.mode === 'crop') setCropRect(rectangle);
    } else if (current.mode === 'move' || current.mode === 'resize') commitMasks(masksRef.current);
    interaction.current = null; draw(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const removeSelected = () => {
    if (busyRef.current || savedCount !== null) return;
    canvasRef.current?.focus({ preventScroll: true });
    cancelInteraction(); commitMasks(masksRef.current.filter(mask => !selectedRef.current.includes(mask.id))); select([]);
  };
  const makeGroup = () => { if (busyRef.current || savedCount !== null || selectedRef.current.length < 2) return; cancelInteraction(); commitMasks(groupMasks(masksRef.current, selectedRef.current, crypto.randomUUID())); playSound('tap'); };
  const ungroup = () => { if (busyRef.current || savedCount !== null) return; cancelInteraction(); commitMasks(ungroupMasks(masksRef.current, selectedRef.current)); playSound('tap'); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busyRef.current || savedCount !== null || isTextControl(event.target)) return;
    const shortcut = maskHistoryShortcut(event.key, event.ctrlKey, event.metaKey, event.shiftKey);
    if (shortcut) { event.preventDefault(); event.stopPropagation(); stepHistory(shortcut); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelInteraction(); if (toolRef.current !== 'mask') useTool('mask'); else select([]); return; }
    const element = event.target as Element;
    if (!element.closest('.mask-canvas')) return;
    if (event.code === 'Space') { event.preventDefault(); spaceRef.current = true; setSpaceHeld(true); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
    const id = element.closest<HTMLElement>('[data-mask-id]')?.dataset.maskId;
    if (event.key === 'Enter' && id) { event.preventDefault(); if (!selectedRef.current.includes(id)) choose(id, event.shiftKey); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !selectedRef.current.length || toolRef.current !== 'mask') return;
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const amount = event.shiftKey ? 10 : 1, delta = { x: (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0) / Math.max(1, rect.width), y: (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) / Math.max(1, rect.height) };
    const corner = element.closest<HTMLElement>('[data-mask-handle]')?.dataset.maskHandle as ResizeCorner | undefined, mask = id ? masksRef.current.find(item => item.id === id) : null;
    if (corner && mask) { const anchor = cornerPoint(mask, corner); commitMasks(masksRef.current.map(item => item.id === id ? { ...item, ...resizeRect(item, corner, { x: anchor.x + delta.x, y: anchor.y + delta.y }) } : item)); }
    else commitMasks(moveMasks(masksRef.current, selectedRef.current, delta));
  };
  const save = async () => {
    if (busyRef.current || savedCount !== null || !imageReady || !masksRef.current.length) return;
    cancelInteraction(); lock(true); setError('');
    const controller = new AbortController(); saveController.current = controller;
    try {
      const result = await api<{ added: number }>('/occlusion', { method: 'POST', body: JSON.stringify({ deckId, imageFilename: filename, masks: maskPayload(masksRef.current), header }), signal: controller.signal });
      if (!live.current || controller.signal.aborted) return;
      setSavedCount(result.added); dirtyChange.current?.(false); playSound('save');
      try { await onSaved(); if (live.current) { savingChange.current?.(false); onClose(); } }
      catch (cause) { if (live.current) setError(`${result.added}장의 카드는 저장됐지만 목록을 갱신하지 못했습니다. 닫은 뒤 새로고침해 주세요. ${errorText(cause)}`); }
    } catch (cause) { if (live.current && !controller.signal.aborted) setError(errorText(cause)); }
    finally { if (live.current) lock(false); }
  };
  const disabled = busy || savedCount !== null, selectedMasks = masks.filter(mask => selected.includes(mask.id));
  const groupIds = [...new Set(masks.flatMap(mask => mask.groupId ? [mask.groupId] : []))];
  const allOneGroup = selectedMasks.length > 1 && !!selectedMasks[0].groupId && selectedMasks.every(mask => mask.groupId === selectedMasks[0].groupId);
  const count = problemCount(masks), activeCrop = tool === 'crop' ? drawing || cropRect : null;
  const cropPlan = cropRect && imageSize.width && imageSize.height ? planImageCrop(imageSize.width, imageSize.height, cropRect, masks) : null;

  return <div className="occlusion-editor" onKeyDown={keyDown}>
    <p className="subtle">이미지 위에서 드래그해 가릴 박스를 만듭니다. 같은 그룹의 박스는 한 문제로 등록됩니다.</p>
    <div className="form-grid two"><label>덱<select value={deckId} disabled={disabled} onChange={event => setDeckId(Number(event.target.value))}>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><label>질문·제목<input value={header} disabled={disabled} onChange={event => setHeader(event.target.value)} placeholder="이 부분의 이름은?" /></label></div>
    <input ref={fileRef} hidden type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
    {!imageUrl ? <button className="image-drop" onClick={() => fileRef.current?.click()} disabled={busy}><ImagePlus size={28} /><strong>{busy ? '이미지 업로드 중…' : '가릴 이미지 선택'}</strong><span>교과서 그림, 지도, 해부도, 도표</span></button> : <>
      <div className="occlusion-toolbar"><span>{masks.length}개 박스 · {count}개 문제</span><div className="occlusion-history-controls"><button disabled={disabled || !history.past.length} onClick={() => stepHistory('undo')} title="Ctrl+Z / ⌘Z"><Undo2 size={14} />실행 취소</button><button disabled={disabled || !history.future.length} onClick={() => stepHistory('redo')} title="Ctrl+Y / Ctrl+Shift+Z / ⌘⇧Z"><Redo2 size={14} />다시 실행</button></div><button disabled={disabled} onClick={() => fileRef.current?.click()}>이미지 변경</button></div>
      <div className="occlusion-image-tools" aria-label="이미지 편집">
        <div className="occlusion-zoom"><button disabled={zoom <= 25 || disabled} onClick={() => changeZoom(zoom - 25)} aria-label="이미지 축소"><ZoomOut size={15} /></button><button disabled={disabled} onClick={() => changeZoom(100)} title="100%로 맞추기">{zoom}%</button><button disabled={zoom >= 400 || disabled} onClick={() => changeZoom(zoom + 25)} aria-label="이미지 확대"><ZoomIn size={15} /></button></div>
        <button disabled={disabled} aria-pressed={tool === 'pan'} onClick={() => useTool(tool === 'pan' ? 'mask' : 'pan')}><Hand size={14} />화면 이동</button>
        <button disabled={disabled || !imageReady} aria-pressed={tool === 'crop'} onClick={() => useTool(tool === 'crop' ? 'mask' : 'crop')}><Crop size={14} />자르기</button>
        <button disabled={disabled || !imageReady} onClick={() => void transformImage({ kind: 'rotate-clockwise' }, rotateMasksClockwise(masksRef.current))}><RotateCw size={14} />90° 회전</button>
        <span className="occlusion-image-size">{imageSize.width} × {imageSize.height}px</span>
      </div>
      <div className="occlusion-edit-toolbar" aria-label="가리기 박스 편집"><span role="status">{selected.length ? `${selected.length}개 선택 · 모서리로 크기 조절, 가운데로 이동` : '선택한 박스 없음'}</span><button disabled={disabled || selected.length < 2 || allOneGroup} onClick={makeGroup}><Group size={13} />그룹 만들기</button><button disabled={disabled || !selectedMasks.some(mask => mask.groupId)} onClick={ungroup}><Ungroup size={13} />그룹 해제</button><button disabled={disabled || !selected.length} onClick={removeSelected}><Trash2 size={13} />선택 삭제</button></div>
      {tool === 'crop' && <div className="occlusion-crop-controls"><span>{cropPlan ? `${cropPlan.rect.width} × ${cropPlan.rect.height}px · 영역 밖 박스 ${cropPlan.removedCount}개 삭제 · 경계 박스 ${cropPlan.clippedCount}개 잘림` : '이미지에서 남길 영역을 드래그하세요.'}</span><button disabled={disabled || !cropPlan} className="primary" onClick={() => { if (cropPlan) void transformImage({ kind: 'crop', rect: cropPlan.rect }, cropPlan.masks); }}>자르기 적용</button><button disabled={disabled} onClick={() => useTool('mask')}>자르기 취소</button></div>}
      <div ref={viewportRef} className={`mask-viewport ${tool === 'pan' || spaceHeld ? 'is-panning' : ''}`}>
        <div className="mask-stage" style={{ width: `${zoom}%` }}>
          <div ref={canvasRef} className={`mask-canvas ${!imageReady ? 'is-loading' : ''} ${tool === 'crop' ? 'is-cropping' : ''}`} tabIndex={0} role="region" aria-label="이미지 가리기 편집 영역" aria-describedby="mask-instructions" aria-busy={busy || !imageReady} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={event => { if (interaction.current?.pointerId === event.pointerId) cancelInteraction(); }} onLostPointerCapture={event => { if (interaction.current?.pointerId === event.pointerId) cancelInteraction(); }}>
            <img ref={imageRef} key={imageUrl} src={imageUrl} alt="가릴 영역을 편집하는 원본 이미지" draggable={false} onLoad={event => { if (live.current && imageUrlRef.current === imageUrl) { setImageReady(true); setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); } }} onError={() => { if (live.current && imageUrlRef.current === imageUrl) { setImageReady(false); setError('이미지를 불러오지 못했습니다. 이미지 변경을 눌러 다시 선택해 주세요.'); } }} />
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="가리기 박스">
              {masks.map((mask, index) => <rect key={mask.id} x={mask.x} y={mask.y} width={mask.width} height={mask.height} data-mask-id={mask.id} className={`mask-box ${selected.includes(mask.id) ? 'is-selected' : ''} ${mask.groupId ? 'is-grouped' : ''}`} role="button" tabIndex={disabled ? -1 : 0} aria-label={`박스 ${index + 1}${mask.groupId ? `, 그룹 ${groupIds.indexOf(mask.groupId) + 1}` : ''}`} aria-pressed={selected.includes(mask.id)} vectorEffect="non-scaling-stroke" />)}
              {drawing && tool !== 'crop' && <rect {...drawing} className="mask-drawing" vectorEffect="non-scaling-stroke" />}
              {activeCrop && <rect {...activeCrop} className="mask-crop-rect" vectorEffect="non-scaling-stroke" />}
            </svg>
            {masks.map((mask, index) => <span key={mask.id} className={`mask-label ${selected.includes(mask.id) ? 'is-selected' : ''}`} style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%` }}>{index + 1}{mask.groupId ? ` · G${groupIds.indexOf(mask.groupId) + 1}` : ''}</span>)}
            {!disabled && tool === 'mask' && !spaceHeld && selectedMasks.flatMap(mask => corners.map(corner => { const at = cornerPoint(mask, corner); return <button key={`${mask.id}-${corner}`} type="button" className={`mask-handle mask-handle-${corner}`} data-mask-id={mask.id} data-mask-handle={corner} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} aria-label={`박스 ${masks.indexOf(mask) + 1} ${cornerNames[corner]} 크기 조절`} />; }))}
          </div>
        </div>
      </div>
      <div className="mask-list" aria-label="가리기 박스 목록">{masks.map((mask, index) => <button key={mask.id} disabled={disabled} aria-pressed={selected.includes(mask.id)} onClick={event => choose(mask.id, event.shiftKey)}>박스 {index + 1}{mask.groupId && <small>그룹 {groupIds.indexOf(mask.groupId) + 1}</small>}</button>)}</div>
      <p className="fine-print mask-instructions" id="mask-instructions">박스를 선택하면 모서리를 바로 드래그해 크기를 조절할 수 있습니다. 선택한 박스의 가운데를 드래그하면 이동합니다. Shift+클릭은 여러 박스 선택, Delete는 삭제, Ctrl+Z는 실행 취소, Ctrl+Y는 다시 실행입니다. Ctrl+휠로 확대하고 Space+드래그로 화면을 이동합니다. Mac에서는 Ctrl 대신 ⌘를 사용하며 다시 실행은 ⌘⇧Z입니다. 선택 후 방향키는 이동, 모서리에 초점을 둔 뒤 방향키는 크기 조절, Esc는 편집 취소·선택 해제입니다.</p>
    </>}
    {error && <ErrorNotice error={error} />}
    <div className="form-footer"><button disabled={busy} onClick={onClose}>취소</button><button className="primary" disabled={disabled || !masks.length || !deckId || !imageReady || tool === 'crop'} onClick={() => void save()}>{savedCount !== null ? '등록 완료' : busy ? '처리 중…' : `${count}장 만들기`}</button></div>
  </div>;
}
