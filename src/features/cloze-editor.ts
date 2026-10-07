export type ClozeBlank = {start:number;end:number;group:number;hint:string};
export type ClozeDocument = {text:string;blanks:ClozeBlank[]};
export type ClozeParse = {supported:true;document:ClozeDocument}|{supported:false;reason:string};

type ClozeModelInfo={type?:number;name:string;fields:string[];templates?:{qfmt:string;afmt:string}[]};
export function isImageOcclusionModel(model:ClozeModelInfo|undefined):boolean {
  if(!model)return false;
  return /image[\s_-]*occlusion/i.test(model.name)
    ||!!model.templates?.some(template=>/imageOcclusion|image-occlusion|anki-occlusion/i.test(template.qfmt+template.afmt))
    ||(model.fields.some(name=>/^occlusions?$/i.test(name))&&model.fields.some(name=>/^image$/i.test(name)));
}
export function isTextClozeModel(model:ClozeModelInfo|undefined):boolean {
  return model?.type===1&&!isImageOcclusionModel(model);
}

const entities:Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",nbsp:'\u00a0','#123':'{','#125':'}','#58':':'};
function decodeText(source:string):string|null {
  const text=source.replace(/<br\s*\/?\s*>/gi,'\n');
  if(/<[^>]*>|&(?:#\w+|\w+);/.test(text.replace(/&(amp|lt|gt|quot|apos|#39|nbsp|#123|#125|#58);/gi,'')))return null;
  return text.replace(/&(amp|lt|gt|quot|apos|#39|nbsp|#123|#125|#58);/gi,(_,name:string)=>entities[name.toLowerCase()]);
}
function encodeText(text:string):string {
  // Colons/braces entered as ordinary text must never become Anki commands.
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>').replace(/\{\{/g,'&#123;&#123;').replace(/\}\}/g,'&#125;&#125;').replace(/::/g,'&#58;&#58;');
}

/** Reads only losslessly representable text. Merely opening this editor never rewrites source. */
export function parseCloze(source:string):ClozeParse {
  const unsupported:ClozeParse={supported:false,reason:'서식·미디어 또는 중첩 빈칸이 포함되어 원문 모드로 표시합니다. 원래 내용은 유지됩니다.'};
  if(/\[sound:|image-occlusion:/i.test(source))return unsupported;
  let text='',position=0;
  const blanks:ClozeBlank[]=[];
  const append=(chunk:string)=>{
    const decoded=decodeText(chunk);
    if(decoded===null)return false;
    text+=decoded;return true;
  };
  while(position<source.length){
    const opening=source.indexOf('{{',position);
    if(opening<0){if(!append(source.slice(position)))return unsupported;break;}
    if(!append(source.slice(position,opening)))return unsupported;
    const match=/^\{\{c([1-9]\d*)::/.exec(source.slice(opening));
    if(!match)return unsupported;
    const contentStart=opening+match[0].length,closing=source.indexOf('}}',contentStart);
    if(closing<0)return unsupported;
    const content=source.slice(contentStart,closing);
    if(content.includes('{{'))return unsupported;
    const parts=content.split('::');
    if(parts.length>2||!parts[0])return unsupported;
    const start=text.length;
    if(!append(parts[0]))return unsupported;
    const hintDocument=parts[1]===undefined?'':decodeText(parts[1]);
    if(hintDocument===null||!Number.isSafeInteger(Number(match[1])))return unsupported;
    blanks.push({start,end:text.length,group:Number(match[1]),hint:hintDocument});
    position=closing+2;
  }
  return {supported:true,document:{text,blanks}};
}

export function serializeCloze(document:ClozeDocument):string {
  let result='',position=0;
  for(const blank of [...document.blanks].sort((a,b)=>a.start-b.start)){
    result+=encodeText(document.text.slice(position,blank.start));
    result+=`{{c${blank.group}::${encodeText(document.text.slice(blank.start,blank.end))}${blank.hint?`::${encodeText(blank.hint)}`:''}}}`;
    position=blank.end;
  }
  return result+encodeText(document.text.slice(position));
}
export function updateClozeSource(source:string,document:ClozeDocument):string {
  const parsed=parseCloze(source);
  return parsed.supported&&JSON.stringify(parsed.document)===JSON.stringify(document)?source:serializeCloze(document);
}
export function nextClozeGroup(document:ClozeDocument):number {
  return Math.max(0,...document.blanks.map(blank=>blank.group))+1;
}
export function addClozeBlank(document:ClozeDocument,start:number,end:number,group:number,hint=''):ClozeDocument|null {
  if(start<0||end>document.text.length||start>=end||!document.text.slice(start,end).trim()||!Number.isSafeInteger(group)||group<1)return null;
  if(document.blanks.some(blank=>start<blank.end&&end>blank.start))return null;
  return {...document,blanks:[...document.blanks,{start,end,group,hint}].sort((a,b)=>a.start-b.start)};
}
/** Keep untouched selections attached to their position; edits inside a blank resize it. */
export function editClozeText(document:ClozeDocument,text:string):ClozeDocument {
  if(text===document.text)return document;
  let start=0;
  while(start<text.length&&start<document.text.length&&text[start]===document.text[start])start++;
  let oldEnd=document.text.length,newEnd=text.length;
  while(oldEnd>start&&newEnd>start&&document.text[oldEnd-1]===text[newEnd-1]){oldEnd--;newEnd--;}
  const delta=newEnd-oldEnd;
  return {text,blanks:document.blanks.flatMap(blank=>{
    if(blank.end<=start)return [blank];
    if(blank.start>=oldEnd)return [{...blank,start:blank.start+delta,end:blank.end+delta}];
    if(start>=blank.start&&oldEnd<=blank.end&&blank.end+delta>blank.start)return [{...blank,end:blank.end+delta}];
    return [];
  })};
}
