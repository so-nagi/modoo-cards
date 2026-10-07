export type CardSkin = 'classic';
export const CARD_FONT_SIZE = { min: 14, max: 40, default: 20 } as const;
export function normalizeCardFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(CARD_FONT_SIZE.min, Math.min(CARD_FONT_SIZE.max, Math.round(value)))
    : CARD_FONT_SIZE.default;
}
export type CardAppearance = {
  skin: CardSkin;
  dark: boolean;
  fontSize: number;
  colors: { paper: string; surface: string; text: string; muted: string; line: string; accent: string };
};
export const DEFAULT_CARD_APPEARANCE: CardAppearance = {
  skin: 'classic', dark: false, fontSize: CARD_FONT_SIZE.default,
  colors: { paper: '#fff', surface: '#f8f8f8', text: '#333', muted: '#96928d', line: '#eee', accent: '#3a3632' },
};

// Exact stock rules obtained from the installed Anki 26.9.3 core. Older stock cards omit line-height.
const stockBase = '.card{font-family:arial;font-size:20px;line-height:1.5;text-align:center;color:black;background-color:white;}';
const stockOldBase = stockBase.replace('line-height:1.5;', '');
const stockCloze = '.cloze{font-weight:bold;color:blue;}.nightMode .cloze{color:lightblue;}';
const stockOcclusion = '#image-occlusion-canvas{--inactive-shape-color:#ffeba2;--active-shape-color:#ff8e8e;--inactive-shape-border:1px #212121;--active-shape-border:1px #212121;--highlight-shape-color:#ff8e8e00;--highlight-shape-border:1px #ff8e8e;}';
const compact = (css: string) => css.replace(/\s+/g, '').toLowerCase();
const stockStyles = new Map<string, 'basic' | 'cloze' | 'occlusion'>([
  [compact(stockBase), 'basic'], [compact(stockOldBase), 'basic'],
  [compact(stockBase + stockCloze), 'cloze'], [compact(stockOldBase + stockCloze), 'cloze'],
  [compact(stockOcclusion + stockOldBase), 'occlusion'],
]);

export function cardTemplateAppearance(css: string): { css: string; themed: boolean } {
  if (!css.trim()) return { css, themed: true };
  const stock = stockStyles.get(compact(css));
  if (!stock) return { css, themed: false };
  if (stock === 'occlusion') return { css: stockOcclusion, themed: true };
  if (stock === 'cloze') return { css: '.cloze{font-weight:700;color:var(--modoo-cloze);background:color-mix(in srgb,var(--modoo-accent) 24%,transparent);padding:.04em .22em;border-radius:.2em;-webkit-box-decoration-break:clone;box-decoration-break:clone}', themed: true };
  return { css: '', themed: true };
}

const escapeStyle = (css: string) => css.replace(/<\/style/gi, '<\\/style');
const scriptLiteral = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');

/** One underscore per visible character; preserve word boundaries without exposing the answer. */
export function clozeCharacterMask(text: string): string {
  const content = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const characters = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(content), item => item.segment)
    : Array.from(content);
  return characters.map(character => /\s/u.test(character) ? ' ' : '_').join('');
}
export function countClozeCharacters(text: string): number {
  return clozeCharacterMask(text).replace(/ /g, '').length;
}

/** A sandboxed document receives only presentation data; Anki note and template sources stay intact. */
export function cardDocumentHtml(html: string, css: string, origin: string, escapeEnabled: boolean, mediaOrigin = ''): string {
  const mediaSources = mediaOrigin && new URL(mediaOrigin).origin === mediaOrigin && mediaOrigin.startsWith('https://') ? `${origin} ${mediaOrigin}` : origin;
  const template = cardTemplateAppearance(css);
  const clozeMask = template.themed && stockStyles.get(compact(css)) === 'cloze';
  const bridge = `(()=>{
    let fontPromise=Promise.resolve();
    let templateFontSize,originalFontSize,originalFontPriority;
    const keys={paper:'--modoo-paper',surface:'--modoo-surface',text:'--modoo-text',muted:'--modoo-muted',line:'--modoo-line',accent:'--modoo-accent'};
    ${clozeMask ? `const blankCharacterMask=${clozeCharacterMask.toString()};
    const decorateClozeBlanks=()=>{
      document.querySelectorAll('.cloze[data-cloze]:not([data-modoo-masked])').forEach(blank=>{
        const source=document.createElement('template');source.innerHTML=blank.getAttribute('data-cloze')||'';
        source.content.querySelectorAll('script,style,template,noscript,[hidden],[aria-hidden="true"]').forEach(node=>node.remove());
        source.content.querySelectorAll('br,hr').forEach(node=>node.replaceWith(' '));
        source.content.querySelectorAll('p,div,li,tr').forEach(node=>node.append(' '));
        const maskText=blankCharacterMask(source.content.textContent||'');
        const count=maskText.replace(/ /g,'').length;
        const original=(blank.textContent||'').trim();
        const hint=/^\\[(?:\\.{3}|…)\\]$/.test(original)?'':original.replace(/^\\[([\\s\\S]*)\\]$/,'$1');
        const description='빈칸'+(count?', 공백 제외 '+count+'자':'')+(hint?', 힌트: '+hint:'');
        const mask=document.createElement('span');mask.className='modoo-cloze-mask';mask.setAttribute('aria-hidden','true');
        mask.textContent=maskText||'　';
        blank.dataset.modooMasked='true';blank.setAttribute('role','img');blank.setAttribute('aria-label',description);blank.setAttribute('title',description);
        blank.replaceChildren(mask);
        if(hint){const hintLabel=document.createElement('small');hintLabel.className='modoo-cloze-hint';hintLabel.textContent='힌트: '+hint;hintLabel.setAttribute('aria-hidden','true');blank.append(hintLabel);}
      });
    };
    document.addEventListener('DOMContentLoaded',decorateClozeBlanks);` : ''}
    addEventListener('message',event=>{
      if(event.source!==parent||event.origin!==${scriptLiteral(origin)}||event.data?.type!=='modoo-card-appearance')return;
      const data=event.data,appearance=data.appearance;
      if(!appearance||appearance.skin!=='classic')return;
      const root=document.documentElement;
      ${clozeMask ? 'decorateClozeBlanks();' : ''}
      const fontSize=typeof appearance.fontSize==='number'&&Number.isFinite(appearance.fontSize)?Math.max(${CARD_FONT_SIZE.min},Math.min(${CARD_FONT_SIZE.max},Math.round(appearance.fontSize))):${CARD_FONT_SIZE.default};
      ${template.themed ? '' : `if(templateFontSize===undefined){templateFontSize=parseFloat(getComputedStyle(document.body).fontSize)||${CARD_FONT_SIZE.default};originalFontSize=document.body.style.getPropertyValue('font-size');originalFontPriority=document.body.style.getPropertyPriority('font-size');}
      if(fontSize===${CARD_FONT_SIZE.default}){if(originalFontSize)document.body.style.setProperty('font-size',originalFontSize,originalFontPriority);else document.body.style.removeProperty('font-size');}
      else document.body.style.setProperty('font-size',(templateFontSize*fontSize/${CARD_FONT_SIZE.default})+'px','important');`}
      root.style.setProperty('--modoo-card-font-size',fontSize+'px');
      root.dataset.cardSkin=appearance.skin;root.dataset.cardTheme=appearance.dark?'dark':'light';
      document.body.classList.toggle('nightMode',!!appearance.dark);
      root.classList.toggle('nightMode',!!appearance.dark);
      Object.entries(keys).forEach(([name,property])=>{const value=appearance.colors?.[name];if(typeof value==='string'&&CSS.supports('color',value))root.style.setProperty(property,value);});
      if(data.font instanceof ArrayBuffer&&typeof FontFace!=='undefined'){
        try{fontPromise=new FontFace('PretendardLocal',data.font,{style:'normal',weight:'400'}).load().then(font=>{document.fonts.add(font);}).catch(()=>{});}catch{fontPromise=Promise.resolve();}
      }
      if(Number.isInteger(data.revision))fontPromise.then(()=>parent.postMessage({type:'modoo-card-appearance-ready',revision:data.revision},${scriptLiteral(origin)}));
    });
    ${escapeEnabled ? `document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();parent.postMessage({type:'modoo-card-preview-escape'},${scriptLiteral(origin)});}});` : ''}
  })();`;
  return `<!doctype html><html data-card-skin="classic" data-card-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${mediaSources} data: blob:; media-src ${mediaSources} data: blob:; font-src ${mediaSources} data:; style-src 'unsafe-inline' ${mediaSources}; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>
html{color-scheme:light;--modoo-paper:#fff;--modoo-surface:#f8f8f8;--modoo-text:#333;--modoo-muted:#96928d;--modoo-line:#eee;--modoo-accent:#3a3632;--modoo-cloze:color-mix(in srgb,var(--modoo-accent) 30%,var(--modoo-text))}
html[data-card-theme=dark]{color-scheme:dark;--modoo-cloze:color-mix(in srgb,var(--modoo-accent) 20%,var(--modoo-text))}
body{margin:0;padding:24px;box-sizing:border-box;min-height:100vh;overflow-wrap:anywhere;color:var(--modoo-text);background:var(--modoo-paper);font-family:PretendardLocal,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
.card{font-size:${template.themed ? 'var(--modoo-card-font-size,20px)' : '20px'};line-height:1.65;text-align:center}
img{max-width:100%;height:auto}audio,video{max-width:100%}input{max-width:95%;font:inherit;color:inherit;background:var(--modoo-surface);border:1px solid var(--modoo-line);border-radius:4px;padding:6px 9px}hr{border:0;border-top:1px solid var(--modoo-line);margin:20px 0}a{color:inherit}
${escapeStyle(template.css)}
${clozeMask ? `.cloze[data-modoo-masked]{background:none;padding:0;font-weight:inherit}
.modoo-cloze-mask{padding:.08em .3em .16em;border-radius:.18em;background:color-mix(in srgb,var(--modoo-accent) 38%,transparent);color:var(--modoo-cloze);font-family:ui-monospace,Consolas,monospace;font-weight:500;letter-spacing:.13em;white-space:break-spaces;overflow-wrap:anywhere;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.modoo-cloze-hint{margin-left:.45em;font-size:.65em;line-height:1.4;color:var(--modoo-cloze);font-weight:400}` : ''}
</style><script>${bridge}</script></head><body class="card">${html}</body></html>`;
}

const fontRequests = new Map<string, Promise<ArrayBuffer | null>>();
/** Font bytes avoid cross-origin font fetches from the opaque sandbox origin. */
export function cardFont(origin: string): Promise<ArrayBuffer | null> {
  let request = fontRequests.get(origin);
  if (!request) {
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 5000);
    request = fetch(`${origin}/fonts/pretendard.otf`, { signal: controller.signal, credentials: 'same-origin' })
      .then(response => response.ok ? response.arrayBuffer() : null).catch(() => null).finally(() => window.clearTimeout(timeout));
    fontRequests.set(origin, request);
  }
  return request;
}
