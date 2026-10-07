export type HtmlFieldMode = 'text' | 'html' | 'preview';
export type PlainHtmlField = { editable: true; text: string } | { editable: false; text: null };

const namedEntities: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
  middot: '·', bull: '•', euro: '€', pound: '£', yen: '¥', cent: '¢',
};
const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, '\n');

/** Only decode markup that can be represented losslessly in a plain text input. */
export function readPlainHtmlField(html: string): PlainHtmlField {
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  if (/<\/?[a-z][\s\S]*?>|<!--|<!|<\?/i.test(text) || /\[sound:[^\]]+\]/i.test(text)) return { editable: false, text: null };
  let supported = true;
  text = text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][\da-z]+);/gi, (entity, body: string) => {
    if (Object.hasOwn(namedEntities, body)) return namedEntities[body];
    if (body.startsWith('#')) {
      const codepoint = /^#x/i.test(body) ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      // Legacy control-character references have special HTML decoding rules.
      if (codepoint > 0 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff) && !(codepoint >= 0x80 && codepoint <= 0x9f)) return String.fromCodePoint(codepoint);
    }
    supported = false;
    return entity;
  });
  return supported ? { editable: true, text: normalizeNewlines(text) } : { editable: false, text: null };
}

/** New user text always becomes HTML text, so angle brackets cannot create elements. */
export function plainTextToFieldHtml(text: string): string {
  return normalizeNewlines(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\n', '<br>');
}

/** A mode switch or unchanged input must never normalize imported source bytes. */
export function updatePlainHtmlField(previousHtml: string, text: string): string {
  const previous = readPlainHtmlField(previousHtml);
  if (!previous.editable) throw new Error('서식이 포함된 필드는 HTML 원문에서 편집해 주세요.');
  return previous.text === normalizeNewlines(text) ? previousHtml : plainTextToFieldHtml(text);
}

export function htmlFieldMode(value: string, sourceRequested: boolean): HtmlFieldMode {
  return sourceRequested ? 'html' : readPlainHtmlField(value).editable ? 'text' : 'preview';
}
