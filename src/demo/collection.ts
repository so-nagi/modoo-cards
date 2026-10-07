import type { Deck, Settings, Stats } from '../types.ts';
import { defaultSettings } from '../types.ts';
import { parseCloze } from '../features/cloze-editor.ts';
import { clozeCharacterMask, countClozeCharacters } from '../components/cardAppearance.ts';

export const STORAGE_KEY = 'modoo-cards.demo.v1';
export const MAX_CARDS = 500;
export type DemoCard = { id: number; deckId: number; kind: 'basic' | 'cloze' | 'diagram'; front: string; back: string; group: number };
export type DemoCollection = { version: 1; decks: {id: number; name: string; favorite: boolean}[]; cards: DemoCard[]; settings: Settings; answers: {cardId: number; rating: number; at: string}[] };
export const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\n', '<br>');

export function sampleCollection(): DemoCollection {
  return {
    version: 1,
    decks: [{id:1,name:'영어 · 기본 카드',favorite:true},{id:2,name:'과학 · 문장 빈칸',favorite:false},{id:3,name:'도형 · 이미지 가리기',favorite:false}],
    cards: [
      ...[['observe','관찰하다'],['hypothesis','가설'],['evidence','증거'],['compare','비교하다'],['predict','예측하다'],['conclusion','결론']].map(([front,back],i)=>({id:i+1,deckId:1,kind:'basic' as const,front,back,group:1})),
      {id:7,deckId:2,kind:'cloze',front:'물은 {{c1::수소::원소}}와 {{c2::산소::원소}}로 이루어져 있다.',back:'분자식: H₂O',group:1},
      {id:8,deckId:2,kind:'cloze',front:'물은 {{c1::수소::원소}}와 {{c2::산소::원소}}로 이루어져 있다.',back:'분자식: H₂O',group:2},
      {id:9,deckId:2,kind:'cloze',front:'지구가 태양 주위를 도는 운동을 {{c1::공전}}이라고 한다.',back:'지구가 스스로 도는 운동은 자전이다.',group:1},
      ...['원','삼각형','정사각형'].map((back,i)=>({id:10+i,deckId:3,kind:'diagram' as const,front:'가려진 도형의 이름은 무엇인가요?',back,group:i+1})),
    ],
    settings:{...defaultSettings,accent:'#829995',sounds:false}, answers:[],
  };
}

/** Demo storage is separate from installed collections, auth and account settings. */
export function loadCollection(text: string | null): DemoCollection {
  if (!text || text.length > 4_000_000) return sampleCollection();
  try {
    const value = JSON.parse(text) as DemoCollection;
    if (value.version !== 1 || !Array.isArray(value.decks) || value.decks.length > 100 || !Array.isArray(value.cards) || value.cards.length > MAX_CARDS || !Array.isArray(value.answers)) throw new Error();
    const ids = new Set<number>();
    for (const deck of value.decks) {
      if (!Number.isSafeInteger(deck.id) || ids.has(deck.id) || typeof deck.name !== 'string' || !deck.name.trim() || deck.name.length > 100 || typeof deck.favorite !== 'boolean') throw new Error();
      ids.add(deck.id);
    }
    const cardIds = new Set<number>();
    for (const card of value.cards) {
      if (!Number.isSafeInteger(card.id) || cardIds.has(card.id) || !ids.has(card.deckId) || !['basic','cloze','diagram'].includes(card.kind) || typeof card.front !== 'string' || card.front.length > 10000 || typeof card.back !== 'string' || card.back.length > 10000 || !Number.isSafeInteger(card.group) || card.group < 1) throw new Error();
      cardIds.add(card.id);
    }
    const s=value.settings || defaultSettings;
    return {version:1,decks:value.decks,cards:value.cards,answers:value.answers.filter(a=>a && cardIds.has(a.cardId) && [1,2,3,4].includes(a.rating) && typeof a.at==='string' && !Number.isNaN(Date.parse(a.at))).slice(-2000),settings:{...defaultSettings,skin:'classic',accent:/^#[\da-f]{6}$/i.test(s.accent)?s.accent:'#829995',theme:['light','neutral','dark'].includes(s.theme)?s.theme:'light',cardFontSize:Number.isFinite(s.cardFontSize)?Math.min(40,Math.max(14,s.cardFontSize)):20,sounds:!!s.sounds,volume:Number.isFinite(s.volume)?Math.min(1,Math.max(0,s.volume)):0.3}};
  } catch { return sampleCollection(); }
}

export function deckRows(collection: DemoCollection): Deck[] {
  return collection.decks.map(deck=>({...deck,newCount:collection.cards.filter(card=>card.deckId===deck.id).length,learnCount:0,reviewCount:0}));
}

export function addCards(collection: DemoCollection, deckId: number, kind: 'basic'|'cloze', front: string, back: string): DemoCollection {
  if (!collection.decks.some(d=>d.id===deckId)) throw new Error('카드를 담을 덱을 먼저 선택하세요.');
  if (!front.trim() || front.length>10000 || back.length>10000) throw new Error('내용을 입력하세요. 각 필드는 10,000자까지 사용할 수 있습니다.');
  let groups=[1];
  if (kind==='cloze') {
    const parsed=parseCloze(front);
    if (!parsed.supported || !parsed.document.blanks.length) throw new Error('문장에서 가릴 부분을 선택해 빈칸을 만드세요. 데모는 텍스트 빈칸을 지원합니다.');
    groups=[...new Set(parsed.document.blanks.map(blank=>blank.group))];
  } else if (!back.trim()) throw new Error('정답을 입력하세요.');
  if (collection.cards.length+groups.length>MAX_CARDS) throw new Error(`데모에는 최대 ${MAX_CARDS}장까지 저장할 수 있습니다.`);
  const start=Math.max(0,...collection.cards.map(card=>card.id))+1;
  return {...collection,cards:[...collection.cards,...groups.map((group,i)=>({id:start+i,deckId,kind,front,back,group}))]};
}

export function removeDeck(collection: DemoCollection, deckId: number, empty = false): DemoCollection {
  const remaining=collection.cards.filter(card=>card.deckId!==deckId), ids=new Set(remaining.map(card=>card.id));
  return {...collection,decks:empty?collection.decks:collection.decks.filter(deck=>deck.id!==deckId),cards:remaining,answers:collection.answers.filter(answer=>ids.has(answer.cardId))};
}

/** Practice order only. This is deliberately not an Anki scheduler. */
export function gradePractice(queue: number[], rating: number): number[] {
  if (!queue.length || ![1,2,3,4].includes(rating)) return queue;
  const [current,...rest]=queue;
  if (rating<=2) rest.splice(Math.min(rating===1?2:4,rest.length),0,current);
  return rest;
}

export function cardHtml(card: DemoCard, answer: boolean): string {
  if (card.kind==='cloze') {
    const parsed=parseCloze(card.front);
    if (!parsed.supported) return escapeText(card.front);
    const {text,blanks}=parsed.document;
    let html='',position=0;
    for (const blank of blanks) {
      html+=escapeText(text.slice(position,blank.start));
      const word=text.slice(blank.start,blank.end),active=blank.group===card.group;
      html+=!active?escapeText(word):answer?`<mark>${escapeText(word)}</mark>`:`<span class="demo-mask" role="img" aria-label="빈칸 ${countClozeCharacters(word)}자" title="공백 제외 ${countClozeCharacters(word)}자">${escapeText(clozeCharacterMask(word))}</span>${blank.hint?`<small> (${escapeText(blank.hint)})</small>`:''}`;
      position=blank.end;
    }
    return html+escapeText(text.slice(position))+(answer&&card.back?`<hr>${escapeText(card.back)}`:'');
  }
  if (card.kind==='diagram') {
    const names=['원','삼각형','정사각형'];
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="540" height="150" viewBox="0 0 540 150"><g fill="none" stroke="#829995" stroke-width="4"><circle cx="90" cy="76" r="48"/><path d="M270 24 322 124H218Z"/><rect x="402" y="28" width="96" height="96" rx="2"/></g></svg>';
    return `<p>${escapeText(card.front)}</p><img alt="왼쪽부터 원, 삼각형, 정사각형" src="data:image/svg+xml,${encodeURIComponent(svg)}"><div class="demo-diagram-labels">${names.map((name,i)=>`<span${i+1===card.group&&!answer?' class="demo-image-mask" aria-label="가려진 이름"':''}>${i+1===card.group&&!answer?'　':name}</span>`).join('')}</div>`;
  }
  return escapeText(card.front)+(answer?`<hr>${escapeText(card.back)}`:'');
}

export const DEMO_CARD_CSS = '.card{font-size:var(--modoo-card-font-size,20px);text-align:center;line-height:1.8}mark,.demo-mask{background:color-mix(in srgb,var(--modoo-accent) 32%,transparent);color:inherit;border-radius:3px;padding:.1em .3em}.demo-mask{letter-spacing:.12em;white-space:break-spaces}small{font-size:.65em;color:var(--modoo-muted)}.demo-diagram-labels{display:flex;margin-top:12px}.demo-diagram-labels>span{width:33.333%;margin:0 4px}.demo-image-mask{background:var(--modoo-accent);border-radius:4px}';

export function statistics(collection: DemoCollection): Stats {
  const today=new Date().toLocaleDateString('sv-SE'),history=new Map<string,number>();
  for(const item of collection.answers){const date=new Date(item.at).toLocaleDateString('sv-SE');history.set(date,(history.get(date)||0)+1);}
  return {today:history.get(today)||0,totalCards:collection.cards.length,totalNotes:collection.cards.length,reviewTime:0,streak:history.has(today)?1:0,retention:collection.answers.length?collection.answers.filter(a=>a.rating>1).length/collection.answers.length*100:0,history:[...history].map(([date,count])=>({date,count})),forecast:[],counts:{new:collection.cards.length,learn:0,review:0,suspended:0},ratings:[1,2,3,4].map(rating=>({rating,count:collection.answers.filter(a=>a.rating===rating).length}))};
}
