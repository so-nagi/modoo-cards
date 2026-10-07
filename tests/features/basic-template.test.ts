import test from 'node:test';
import assert from 'node:assert/strict';
import { basicTemplate } from '../../src/features/basicTemplate.ts';

test('basic presentation retains all fields and card ordinals without source HTML or CSS',()=>{
  const result=basicTemplate({id:1,name:'Words',type:0,fields:['Word','Pronunciation','Meaning'],css:'@font-face{}',templates:[{name:'Card 1',qfmt:'<script>bad()</script>{{Word}}',afmt:'{{Meaning}}'},{name:'Card 2',qfmt:'other',afmt:'other'}]});
  assert.equal(result.css,'');
  assert.equal(result.templates?.length,2);
  assert.equal(result.templates?.[0].qfmt,'{{text:Word}}');
  assert.match(result.templates![0].afmt,/text:Pronunciation/);
  assert.match(result.templates![0].afmt,/text:Meaning/);
  assert.equal(result.templates![1].name,'Card 2');
});
test('cloze front and answer keep the native cloze filter',()=>{
  const result=basicTemplate({id:1,name:'Cloze',type:1,fields:['Text','Extra'],templates:[{name:'Cloze',qfmt:'old',afmt:'old'}]});
  assert.equal(result.templates![0].qfmt,'{{cloze:text:Text}}');
  assert.match(result.templates![0].afmt,/^\{\{cloze:text:Text\}\}/);
});
test('vocabulary package displays pronunciation and meaning without provenance labels',()=>{
  const template=basicTemplate({id:1,name:'사진 어휘',fields:['Front','Back','Pronunciation','Day','Source','Position'],templates:[{name:'Vocabulary',qfmt:'old',afmt:'old'}]}).templates![0];
  assert.ok(template.afmt.indexOf('Pronunciation')<template.afmt.indexOf('text:Back'));
  assert.doesNotMatch(template.afmt,/Day|Source|Position/);
});
