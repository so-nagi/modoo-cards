import { useEffect, useMemo, useRef, useState, type KeyboardEventHandler } from 'react';
import { htmlFieldMode, readPlainHtmlField, updatePlainHtmlField, type HtmlFieldMode } from './htmlField';
import './html-field-editor.css';

type Props = {
  name: string;
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  onFocus?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  inputRef?: (element: HTMLTextAreaElement | null) => void;
  onModeChange?: (mode: HtmlFieldMode) => void;
};

function previewDocument(value: string): string {
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta,link,form,input,button,textarea,select,audio,video,source').forEach(element => element.remove());
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['href', 'xlink:href', 'srcset', 'action', 'formaction', 'autofocus', 'contenteditable', 'tabindex'].includes(name)) element.removeAttribute(attribute.name);
      if (name === 'src' && !(element.localName === 'img' && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(attribute.value))) element.removeAttribute(attribute.name);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>html{color-scheme:light}body{margin:0;padding:12px;color:#333;background:#fff;font-family:Arial,sans-serif;font-size:15px;line-height:1.8;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${template.innerHTML}</body></html>`;
}

/** Canonical HTML stays in the parent; plain input and source viewing never rewrite on mount. */
export default function HtmlFieldEditor({ name, value, onChange, disabled = false, placeholder, rows = 3, onFocus, onKeyDown, inputRef, onModeChange }: Props) {
  const [sourceRequested, setSourceRequested] = useState(false);
  const mode = htmlFieldMode(value, sourceRequested), plain = readPlainHtmlField(value);
  const modeCallback = useRef(onModeChange); modeCallback.current = onModeChange;
  useEffect(() => { modeCallback.current?.(mode); }, [mode]);
  const preview = useMemo(() => mode === 'preview' ? previewDocument(value) : '', [mode, value]);
  return <div className="html-field-editor" onFocusCapture={onFocus}>
    <div className="html-field-mode"><span>{mode === 'html' ? 'HTML 원문 편집' : mode === 'preview' ? '서식 미리보기' : '텍스트 입력'}</span><button type="button" disabled={disabled} aria-pressed={sourceRequested} onClick={() => setSourceRequested(current => !current)}>{sourceRequested ? plain.editable ? '텍스트 입력으로 돌아가기' : '서식 미리보기로 돌아가기' : 'HTML 원문'}</button></div>
    {mode === 'preview' ? <>
      <iframe className="html-field-preview" title={`${name} 서식 미리보기`} sandbox="" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={preview} />
      <p className="html-field-notice">가져온 서식은 유지됩니다. 수정하려면 HTML 원문을 여세요. 미디어를 포함한 최종 모양은 카드 미리보기에서 확인할 수 있습니다.</p>
    </> : <textarea ref={inputRef} aria-label={name} className={mode === 'html' ? 'html-field-source' : undefined} rows={rows} disabled={disabled} placeholder={mode === 'html' ? 'HTML 원문' : placeholder} value={mode === 'html' ? value : plain.editable ? plain.text : ''} onKeyDown={onKeyDown} onChange={event => {
      const next = mode === 'html' ? event.target.value : updatePlainHtmlField(value, event.target.value);
      if (next !== value) onChange(next);
    }} />}
  </div>;
}
