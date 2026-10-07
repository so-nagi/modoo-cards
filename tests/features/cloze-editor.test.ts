import assert from 'node:assert/strict';
import test from 'node:test';
import {addClozeBlank,editClozeText,isTextClozeModel,nextClozeGroup,parseCloze,serializeCloze,updateClozeSource} from '../../src/features/cloze-editor.ts';
import type {ClozeDocument} from '../../src/features/cloze-editor.ts';

function document(source:string):ClozeDocument {
  const result=parseCloze(source);assert.equal(result.supported,true);
  if(!result.supported)throw new Error(result.reason);
  return result.document;
}

test('a selected Korean phrase and optional hint become a native Anki cloze',()=>{
  const original=document('대한민국의 수도는 서울이다.');
  const start=original.text.indexOf('서울');
  const next=addClozeBlank(original,start,start+2,1,'도시 이름');assert.ok(next);
  assert.equal(serializeCloze(next),'대한민국의 수도는 {{c1::서울::도시 이름}}이다.');
  assert.deepEqual(document(serializeCloze(next)),next);
});
test('repeated words use selection offsets rather than first-match replacement',()=>{
  const original=document('서울에서 서울을 떠올린다.');
  const start=original.text.lastIndexOf('서울');
  const next=addClozeBlank(original,start,start+2,1);assert.ok(next);
  assert.equal(serializeCloze(next),'서울에서 {{c1::서울}}을 떠올린다.');
});
test('separate questions increment from the greatest existing group and grouped blanks retain their number',()=>{
  const original=document('{{c2::서울}}과 부산, 대구');
  assert.equal(nextClozeGroup(original),3);
  const grouped=addClozeBlank(original,4,6,2);assert.ok(grouped);
  const separate=addClozeBlank(grouped,8,10,nextClozeGroup(grouped));assert.ok(separate);
  assert.equal(serializeCloze(separate),'{{c2::서울}}과 {{c2::부산}}, {{c3::대구}}');
});
test('overlapping, empty and invalid selections cannot create malformed nested clozes',()=>{
  const original=document('A {{c1::word}} word');
  assert.equal(addClozeBlank(original,3,8,2),null);
  assert.equal(addClozeBlank(original,1,2,2),null);
  assert.equal(addClozeBlank(original,-1,2,2),null);
  assert.equal(addClozeBlank(original,8,30,2),null);
  assert.equal(addClozeBlank(original,8,11,0),null);
});
test('Unicode emoji and combining letters preserve textarea UTF-16 offsets',()=>{
  const original=document('🧠 서울과 cafe\u0301');
  const start=original.text.indexOf('서울');
  const next=addClozeBlank(original,start,start+2,1,'수도 🏙');assert.ok(next);
  assert.equal(serializeCloze(next),'🧠 {{c1::서울::수도 🏙}}과 cafe\u0301');
  assert.deepEqual(document(serializeCloze(next)),next);
});
test('newlines, markup-like ordinary text, braces and delimiter-like hints stay literal',()=>{
  const original:ClozeDocument={text:'2 < 3 & 5\n{{abc}} :: 끝',blanks:[{start:0,end:5,group:1,hint:'a :: b {{x}} <hint>'}]};
  assert.deepEqual(document(serializeCloze(original)),original);
});
test('opening and no-op editing preserve original simple HTML source byte for byte',()=>{
  const source='앞<br />{{c4::서울::수도}} &amp; 끝\n';
  const parsed=document(source);
  assert.equal(updateClozeSource(source,parsed),source);
  assert.equal(updateClozeSource(source,editClozeText(parsed,parsed.text)),source);
});
test('complex imported HTML, media, nested syntax, and unsupported entities require raw mode',()=>{
  for(const source of ['<b>{{c1::bold}}</b>','{{c1::outer {{c2::inner}}}}','{{c1::answer::hint::extra}}','{{c1::unfinished','<img src="x.png">','[sound:x.ogg]','&#x1f9e0;','{{not-cloze}}']){
    assert.equal(parseCloze(source).supported,false,source);
  }
});
test('sentence edits before and inside a blank retain its position and hint',()=>{
  const original=document('수도는 {{c3::서울::도시}}이다.');
  const shifted=editClozeText(original,'한국의 '+original.text);
  assert.equal(serializeCloze(shifted),'한국의 수도는 {{c3::서울::도시}}이다.');
  const changed=editClozeText(original,'수도는 서울시이다.');
  // Insertion exactly at the closing boundary remains ordinary text.
  assert.equal(serializeCloze(changed),'수도는 {{c3::서울::도시}}시이다.');
  const interior=editClozeText(original,'수도는 서아울이다.');
  assert.equal(serializeCloze(interior),'수도는 {{c3::서아울::도시}}이다.');
});
test('deleting a selection across a blank edge removes only the affected blank',()=>{
  const original=document('{{c1::서울}}과 {{c2::부산}}');
  const changed=editClozeText(original,'울과 부산');
  assert.equal(serializeCloze(changed),'{{c1::울}}과 {{c2::부산}}');
  const crossed=editClozeText(original,'서부산');
  assert.equal(serializeCloze(crossed),'서{{c2::부산}}');
  assert.equal(serializeCloze(editClozeText(original,'')),'');
});
test('removing a blank restores text while preserving other groups and hints',()=>{
  const original=document('{{c1::서울::수도}} {{c5::부산}}');
  assert.equal(serializeCloze({...original,blanks:original.blanks.slice(1)}),'서울 {{c5::부산}}');
});
test('private-use Unicode is not used as an entity-decoding sentinel',()=>{
  const original=document('\uE000 {{c1::\uE001::\uE002}}');
  assert.equal(serializeCloze(original),'\uE000 {{c1::\uE001::\uE002}}');
});
test('native and renamed Image Occlusion models do not enter the text cloze builder',()=>{
  assert.equal(isTextClozeModel({type:1,name:'Cloze',fields:['Text','Back Extra']}),true);
  assert.equal(isTextClozeModel({type:0,name:'Basic',fields:['Front','Back']}),false);
  assert.equal(isTextClozeModel({type:1,name:'Image Occlusion',fields:[]}),false);
  assert.equal(isTextClozeModel({type:1,name:'그림 가리기',fields:['Occlusion','Image']}),false);
  assert.equal(isTextClozeModel({type:1,name:'Custom',fields:['x'],templates:[{qfmt:'anki.imageOcclusion.setup()',afmt:''}]}),false);
  assert.equal(parseCloze('{{c1::image-occlusion:rect:left=0.1}}').supported,false);
});
