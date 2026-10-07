import assert from 'node:assert/strict';
import test from 'node:test';
import {finishModelDraftSave,hasUnsavedModelDrafts} from '../../src/features/note-drafts.ts';

test('saving a two-field Cloze note retains an independent custom model third field and raw HTML',()=>{
  const custom={fields:['앞면','<b>뒷면</b>','다른 모델에 없는 세 번째 필드'],baseline:JSON.stringify({fields:['','',''],tags:'old'}),draftDirty:{},frozen:[2],clozeUi:{}};
  const active={fields:['{{c1::답}}',''],baseline:JSON.stringify({fields:['',''],tags:'old'}),draftDirty:{},frozen:[],clozeUi:{}};
  const drafts=new Map([[1,custom],[2,active]]);
  const remaining=finishModelDraftSave(drafts,2,'새 태그');
  assert.equal(remaining.has(2),false);
  assert.deepEqual(remaining.get(1)?.fields,custom.fields);
  assert.deepEqual(remaining.get(1)?.frozen,[2]);
  assert.equal(hasUnsavedModelDrafts(remaining,2),true);
  assert.equal(drafts.size,2,'the old draft map is not mutated');
  assert.deepEqual(JSON.parse(remaining.get(1)!.baseline),{fields:['','',''],tags:'새 태그'});
});

test('a pending hidden hint survives saving another type and keeps the discard warning active',()=>{
  const hintDraft={fields:['서울은 수도다.',''],baseline:JSON.stringify({fields:['서울은 수도다.',''],tags:''}),draftDirty:{0:true},clozeUi:{0:{hint:'도시 이름',selection:{start:0,end:2}}}};
  const remaining=finishModelDraftSave(new Map([[7,hintDraft]]),9,'시험');
  assert.equal(hasUnsavedModelDrafts(remaining,9),true);
  assert.deepEqual(remaining.get(7)?.clozeUi,hintDraft.clozeUi);
});

test('clean cached fields do not cause a warning from an old shared tag baseline after save',()=>{
  const clean={fields:['',''],baseline:JSON.stringify({fields:['',''],tags:'이전'}),draftDirty:{0:false}};
  const remaining=finishModelDraftSave(new Map([[1,clean]]),2,'현재');
  assert.equal(hasUnsavedModelDrafts(remaining,2),false);
  assert.equal(JSON.stringify({fields:remaining.get(1)?.fields,tags:'현재'}),remaining.get(1)?.baseline);
  assert.equal(hasUnsavedModelDrafts(remaining,1),false);
});
