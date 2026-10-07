import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { cardDocumentHtml, cardTemplateAppearance, clozeCharacterMask, countClozeCharacters, DEFAULT_CARD_APPEARANCE, normalizeCardFontSize } from '../../src/components/cardAppearance.ts';

const stock = `.card {
    font-family: arial;
    font-size: 20px;
    line-height: 1.5;
    text-align: center;
    color: black;
    background-color: white;
}`;
const origin = 'http://127.0.0.1:4190';

test('cloze masks count graphemes without exposing letters and preserve word boundaries', () => {
  for (const [answer, mask, count] of [
    ['서울', '__', 2], ['New York', '___ ____', 7], [' < > & ', '_ _ _', 3],
    ['한\n\t 글', '_ _', 2], ['서울', '__', 2], ['cafe\u0301', '____', 4],
    ['👨‍👩‍👧‍👦 👍🏽 🇰🇷', '_ _ _', 3], [' \n ', '', 0],
  ] as const) {
    assert.equal(clozeCharacterMask(answer), mask, answer);
    assert.equal(countClozeCharacters(answer), count, answer);
  }
});

test('native question masks get display-only decoration, leaving answer and custom HTML intact', () => {
  const css = `${stock}\n.cloze { font-weight: bold; color: blue; }\n.nightMode .cloze { color: lightblue; }`;
  const front = '<span class="cloze" data-cloze="New York" data-ordinal="1">[...]</span>';
  const back = '<span class="cloze" data-ordinal="1">New York</span>';
  for (const html of [front, back]) {
    const document = cardDocumentHtml(html, css, origin, false);
    assert.ok(document.endsWith(`<body class="card">${html}</body></html>`));
    assert.match(document, /\.cloze\[data-cloze\]:not\(\[data-modoo-masked\]\)/);
    assert.match(document, /source\.content\.querySelectorAll\('script,style,template,noscript/);
  }
  const custom = cardDocumentHtml(front, '.cloze { color: red; }', origin, false);
  assert.ok(!custom.includes('decorateClozeBlanks'));
  assert.ok(custom.endsWith(`<body class="card">${front}</body></html>`));
});

test('separate Hosting and API origins allow card media without widening message or network access', () => {
  const hosting = 'https://demo-modoo-tests.web.app';
  const backend = 'https://cards.example.com';
  const document = cardDocumentHtml('<img src="' + backend + '/api/media/photo">', stock, hosting, false, backend);
  assert.ok(document.includes(`img-src ${hosting} ${backend} data: blob:`));
  assert.ok(document.includes(`media-src ${hosting} ${backend} data: blob:`));
  assert.ok(document.includes(`event.origin!==${JSON.stringify(hosting)}`));
  assert.match(document, /connect-src 'none'; form-action 'none'; base-uri 'none'/);
  const rejected = cardDocumentHtml('word', stock, hosting, false, 'https://other.test/path');
  assert.ok(!rejected.includes('other.test'));
});

test('only exact stock Anki basic and cloze defaults become app-themed', () => {
  assert.deepEqual(cardTemplateAppearance(stock), { css: '', themed: true });
  assert.deepEqual(cardTemplateAppearance(stock.replace('    line-height: 1.5;\n', '')), { css: '', themed: true });
  const cloze = `${stock}\n.cloze { font-weight: bold; color: blue; }\n.nightMode .cloze { color: lightblue; }`;
  const converted = cardTemplateAppearance(cloze);
  assert.equal(converted.themed, true); assert.match(converted.css, /var\(--modoo-cloze\)/);
  for (const custom of [stock.replace('arial', 'Georgia'), stock.replace('black', '#123456'), `${stock}\n.card { letter-spacing: 1px; }`, 'body { color: navy; }', stock.replace('20px', '22px')]) {
    assert.deepEqual(cardTemplateAppearance(custom), { css: custom, themed: false });
  }
});

test('app font, paper defaults and chrome do not alter user note HTML or imported CSS', () => {
  const html = '<div style="color:#952;font-family:Georgia"><img src="/example.png">앞면</div>';
  const css = '.card{font-family:Georgia;color:#abc;background:#102030} .answer{font-size:31px}';
  const document = cardDocumentHtml(html, css, origin, false);
  assert.ok(document.endsWith(`<body class="card">${html}</body></html>`));
  assert.ok(document.includes(css));
  assert.ok(document.indexOf(css) > document.indexOf('font-family:PretendardLocal'));
  assert.ok(!document.includes('repeating-linear-gradient'));
  assert.match(document, /connect-src 'none'; form-action 'none'; base-uri 'none'/);
  assert.match(document, /img\{max-width:100%;height:auto\}/);
});

test('stock occlusion keeps shape styles while removing its opaque white Arial card default', () => {
  const shapes = '#image-occlusion-canvas { --inactive-shape-color: #ffeba2; --active-shape-color: #ff8e8e; --inactive-shape-border: 1px #212121; --active-shape-border: 1px #212121; --highlight-shape-color: #ff8e8e00; --highlight-shape-border: 1px #ff8e8e; }';
  const result = cardTemplateAppearance(shapes + stock.replace('    line-height: 1.5;\n', ''));
  assert.equal(result.themed, true); assert.match(result.css, /--active-shape-color:#ff8e8e/);
  assert.ok(!result.css.includes('font-family')); assert.ok(!result.css.includes('background-color'));
});

test('style close tags cannot escape the template stylesheet', () => {
  const html = cardDocumentHtml('card', '</STYLE><script>unexpected()</script>', origin, false);
  assert.ok(html.includes('<\\/style>') || html.includes('<\\/STYLE>'));
});

test('sandbox bridge accepts presentation only from parent origin and waits for PretendardLocal before ready', async () => {
  const generated = cardDocumentHtml('<input value="retained answer">', '', origin, true);
  const script = generated.match(/<script>([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  const listeners: Record<string, (event: any) => void> = {}, messages: any[] = [], styles: Record<string, string> = {}, fonts: any[] = [];
  const classes: Record<string, boolean> = {}, dataset: Record<string, string> = {};
  const root = { dataset, style: { setProperty: (name: string, value: string) => { styles[name] = value; } }, classList: { toggle: (name: string, active: boolean) => { classes[name] = active; } } };
  const parent = { postMessage: (data: any, target: string) => { messages.push({ data, target }); } };
  let finishFont: (value: any) => void = () => {};
  class FontFace { constructor(_family: string, _bytes: ArrayBuffer) {} load() { return new Promise(resolve => { finishFont = resolve; }); } }
  const document = { documentElement: root, body: { classList: root.classList, inputValue: 'retained answer' }, fonts: { add: (font: any) => fonts.push(font) }, addEventListener: (name: string, callback: any) => { listeners[name] = callback; } };
  vm.runInNewContext(script, { parent, document, FontFace, ArrayBuffer, CSS: { supports: (_name: string, value: string) => !value.includes(';') }, addEventListener: (name: string, callback: any) => { listeners[name] = callback; } });
  const appearance = { ...DEFAULT_CARD_APPEARANCE, skin: 'classic', dark: true, colors: { ...DEFAULT_CARD_APPEARANCE.colors, paper: '#332f2c', text: '#f2ece4' } };
  listeners.message({ source: {}, origin, data: { type: 'modoo-card-appearance', appearance } });
  listeners.message({ source: parent, origin: 'https://elsewhere.example', data: { type: 'modoo-card-appearance', appearance } });
  assert.equal(dataset.cardSkin, undefined);
  listeners.message({ source: parent, origin, data: { type: 'modoo-card-appearance', appearance, font: new ArrayBuffer(4), revision: 7 } });
  assert.equal(dataset.cardSkin, 'classic'); assert.equal(dataset.cardTheme, 'dark'); assert.equal(classes.nightMode, true);
  assert.equal(styles['--modoo-text'], '#f2ece4'); assert.equal(messages.length, 0);
  finishFont({ family: 'PretendardLocal' }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fonts.length, 1); assert.equal(messages[0].data.type, 'modoo-card-appearance-ready'); assert.equal(messages[0].data.revision, 7);
  assert.equal(messages[0].target, origin);
  listeners.message({ source: parent, origin, data: { type: 'modoo-card-appearance', appearance: { ...appearance, skin: 'classic', dark: false, fontSize: 32 } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dataset.cardSkin, 'classic'); assert.equal(classes.nightMode, false);
  assert.equal(styles['--modoo-card-font-size'], '32px');
  assert.equal(document.body.inputValue, 'retained answer'); assert.equal(messages.length, 1);
  let prevented = false;
  listeners.keydown({ key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(messages[1].data.type, 'modoo-card-preview-escape');
});

test('card font size defaults for older settings and remains within the selectable integer range', () => {
  for (const value of [undefined, null, '32', NaN, Infinity]) assert.equal(normalizeCardFontSize(value), 20);
  assert.equal(normalizeCardFontSize(1), 14);
  assert.equal(normalizeCardFontSize(100), 40);
  assert.equal(normalizeCardFontSize(25.6), 26);
  assert.match(cardDocumentHtml('stock', stock, origin, false), /font-size:var\(--modoo-card-font-size,20px\)/);
});

test('custom card font scales from its original base without compounding or altering source HTML and CSS', () => {
  const html = '<input value="answer"><span style="font-size:12px">fixed annotation</span><img width="200" src="/image.png">';
  const css = '.card { font-family: Georgia; font-size: 26px !important; }';
  const generated = cardDocumentHtml(html, css, origin, false);
  assert.ok(generated.includes(css));
  assert.ok(generated.endsWith(`<body class="card">${html}</body></html>`));
  const script = generated.match(/<script>([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  let listener: (event: any) => void = () => {};
  const properties: Record<string, string> = {}, priorities: Record<string, string> = {};
  const style = {
    setProperty: (key: string, value: string, priority = '') => { properties[key] = value; priorities[key] = priority; },
    removeProperty: (key: string) => { delete properties[key]; delete priorities[key]; },
    getPropertyValue: (key: string) => properties[key] || '', getPropertyPriority: (key: string) => priorities[key] || '',
  };
  const root = { dataset: {}, style: { setProperty() {} }, classList: { toggle() {} } };
  const body = { style, classList: root.classList, inputValue: 'answer' }, parent = { postMessage() {} };
  let computedReads = 0;
  vm.runInNewContext(script, { parent, document: { documentElement: root, body }, ArrayBuffer,
    getComputedStyle: () => { computedReads++; return { fontSize: properties['font-size'] || '26px' }; },
    CSS: { supports: () => true }, addEventListener: (_name: string, callback: any) => { listener = callback; },
  });
  const resize = (fontSize?: number) => listener({ source: parent, origin, data: { type: 'modoo-card-appearance', appearance: { ...DEFAULT_CARD_APPEARANCE, fontSize } } });
  resize(); assert.equal(properties['font-size'], undefined);
  resize(30); assert.equal(properties['font-size'], '39px'); assert.equal(priorities['font-size'], 'important');
  resize(40); assert.equal(properties['font-size'], '52px');
  resize(14); assert.equal(properties['font-size'], '18.2px');
  resize(20); assert.equal(properties['font-size'], undefined);
  assert.equal(computedReads, 1); assert.equal(body.inputValue, 'answer');
});
