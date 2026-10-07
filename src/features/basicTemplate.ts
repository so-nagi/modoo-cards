import type { Model } from '../types';

// Preserve field schemas and template ordinals: existing cards keep their IDs.
export function basicTemplate(model:Model):Pick<Model,'css'|'templates'> {
  const fields=model.fields[0]==='Front'&&model.fields.includes('Back')&&model.fields.includes('Pronunciation')
    ? ['Front','Pronunciation','Back',...model.fields.filter(field=>!['Front','Back','Pronunciation','Day','Source','Position'].includes(field))]
    : model.fields;
  const [first,...rest]=fields;
  const front=`{{${model.type===1?'cloze:text:':'text:'}${first}}}`;
  const answer=rest.map(field=>`{{#${field}}}<div>{{text:${field}}}</div>{{/${field}}}`).join('');
  return {css:'',templates:model.templates?.map((template,index)=>({name:template.name,qfmt:index?`<div data-card-index="${index}">${front}</div>`:front,afmt:`${model.type===1?front:'{{FrontSide}}'}<hr id="answer">${answer}`}))};
}
