import test from 'node:test';
import assert from 'node:assert/strict';
import { addCards, cardHtml, gradePractice, loadCollection, MAX_CARDS, removeDeck, sampleCollection, STORAGE_KEY } from '../../src/demo/collection.ts';

test('demo uses independent storage and restores valid edits without mutating seed data',()=>{
  const seed=sampleCollection(),added=addCards(seed,1,'basic','new word','새 단어');
  assert.equal(seed.cards.length,12);assert.equal(added.cards.length,13);
  assert.deepEqual(loadCollection(JSON.stringify(added)),added);
  assert.equal(STORAGE_KEY,'modoo-cards.demo.v1');
  assert.equal(loadCollection('{broken').cards.length,12);
  const invalid={...added,cards:[{...added.cards[0],deckId:999}]};
  assert.equal(loadCollection(JSON.stringify(invalid)).cards.length,12);
});
test('cloze creation produces independent groups and hides only the active group',()=>{
  const next=addCards(sampleCollection(),2,'cloze','{{c1::수소}}와 {{c2::산소}}','물');
  const cards=next.cards.slice(-2);assert.equal(cards.length,2);
  assert.match(cardHtml(cards[0],false),/aria-label="빈칸 2자"/);
  assert.ok(!cardHtml(cards[0],false).includes('수소'));assert.ok(cardHtml(cards[0],false).includes('산소'));
  assert.ok(cardHtml(cards[0],true).includes('수소'));assert.ok(!cardHtml(cards[1],false).includes('산소'));
});
test('demo input cannot insert executable HTML into a card',()=>{
  const payload='<script>location.href="https://example.test"</script><img src=x onerror=alert(1)>';
  const next=addCards(sampleCollection(),1,'basic',payload,payload);
  const html=cardHtml(next.cards.at(-1)!,true);
  assert.ok(!html.includes('<script'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);
  assert.throws(()=>addCards(sampleCollection(),2,'cloze','<img src=x onerror=alert(1)> {{c1::text}}',''));
});
test('again and hard reappear behind other cards, while good and easy finish',()=>{
  assert.deepEqual(gradePractice([1,2,3,4,5,6],1),[2,3,1,4,5,6]);
  assert.deepEqual(gradePractice([1,2,3,4,5,6],2),[2,3,4,5,1,6]);
  assert.deepEqual(gradePractice([1,2,3],3),[2,3]);assert.deepEqual(gradePractice([1],4),[]);
  assert.deepEqual(gradePractice([1],1),[1]);
});
test('empty/delete affect only the chosen demo deck and its answers',()=>{
  const seed=sampleCollection();seed.answers=[{cardId:1,rating:3,at:new Date().toISOString()},{cardId:7,rating:2,at:new Date().toISOString()}];
  const empty=removeDeck(seed,1,true);assert.equal(empty.decks.length,3);assert.equal(empty.cards.length,6);assert.equal(empty.answers.length,1);
  const removed=removeDeck(seed,1);assert.equal(removed.decks.length,2);assert.ok(removed.cards.every(card=>card.deckId!==1));assert.equal(seed.cards.length,12);
});
test('demo enforces card count and required content before changing storage',()=>{
  assert.throws(()=>addCards(sampleCollection(),99,'basic','a','b'));
  assert.throws(()=>addCards(sampleCollection(),1,'basic','a',''));
  assert.throws(()=>addCards(sampleCollection(),2,'cloze','no blank',''));
  const full=sampleCollection();full.cards=Array.from({length:MAX_CARDS},(_,id)=>({...full.cards[0],id}));
  assert.throws(()=>addCards(full,1,'basic','a','b'));
});
