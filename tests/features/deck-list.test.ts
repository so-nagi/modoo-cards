import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleDecks } from '../../src/features/deckList.ts';
import type { Deck } from '../../src/types.ts';

const deck = (name:string, favorite=false):Deck => ({id:0,name,favorite,newCount:0,learnCount:0,reviewCount:0});
const names = (items:Deck[]) => items.map(item=>item.name);
const decks = [deck('Words',true),deck('Words::A'),deck('Words::A::One'),deck('Words::B'),deck('Other'),deck('Other::Favorite',true)];

test('favorite parent includes all descendants when none is starred',()=>{
  assert.deepEqual(names(visibleDecks(decks,{favoritesOnly:true})), ['Other','Other::Favorite','Words','Words::A','Words::A::One','Words::B']);
});
test('favorite descendants narrow a favorite branch and retain their ancestor path',()=>{
  const starred=decks.map(item=>({...item,favorite:item.favorite||item.name==='Words::A::One'}));
  assert.deepEqual(names(visibleDecks(starred,{favoritesOnly:true})), ['Other','Other::Favorite','Words','Words::A','Words::A::One']);
});
test('a favorite child with no starred descendants includes its children',()=>{
  assert.deepEqual(names(visibleDecks([deck('P',true),deck('P::A',true),deck('P::A::Child'),deck('P::B')],{favoritesOnly:true})), ['P','P::A','P::A::Child']);
});
test('favorites view respects collapsed parents without changing stored favorites',()=>{
  assert.deepEqual(names(visibleDecks(decks,{favoritesOnly:true,collapsed:['Words']})),['Other','Other::Favorite','Words']);
  assert.equal(decks[1].favorite,false);
});
test('search finds hidden children, composes with favorites, and respects name boundaries',()=>{
  assert.deepEqual(names(visibleDecks(decks,{favoritesOnly:true,collapsed:['Words'],query:'one'})),['Words::A::One']);
  assert.deepEqual(names(visibleDecks([deck('Word',true),deck('Words::A')],{favoritesOnly:true})),['Word']);
});
test('all decks remain reachable beyond the previous fifteen-item limit',()=>{
  const many=Array.from({length:30},(_,n)=>deck(`Folder ${String(n).padStart(2,'0')}`));
  assert.equal(visibleDecks(many).length,30);
  assert.equal(visibleDecks(many).at(-1)?.name,'Folder 29');
});
