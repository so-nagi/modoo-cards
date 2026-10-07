import { useRef, useState } from 'react';
import { Modal } from './ui';
import './discard-guard.css';

/** All dismiss paths use this guard; successful saves clear dirty state first. */
export function useDiscardGuard() {
  const pending = useRef<null | (() => void)>(null);
  const [asking, setAsking] = useState(false);
  const stay = () => { pending.current = null; setAsking(false); };
  const request = (action: () => void, dirty: boolean, blocked = false) => {
    if (blocked || pending.current) return;
    if (!dirty) { action(); return; }
    pending.current = action;
    setAsking(true);
  };
  const discard = () => {
    const action = pending.current;
    pending.current = null;
    setAsking(false);
    action?.();
  };
  const confirmation = asking ? <Modal title="작성 내용을 버릴까요?" role="alertdialog" className="discard-confirmation" onClose={stay}>
    <p>저장하지 않은 내용이 있습니다. 닫으면 작성 중인 내용이 사라집니다.</p>
    <div className="form-footer"><button autoFocus data-modal-initial-focus className="primary" onClick={stay}>계속 작성</button><button className="danger" onClick={discard}>작성 내용 버리고 닫기</button></div>
  </Modal> : null;
  return { request, confirmation };
}
