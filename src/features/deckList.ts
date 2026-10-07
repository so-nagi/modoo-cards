import type { Deck } from '../types';

type Filters = {favoritesOnly?:boolean; query?:string; collapsed?:string[]};
const childOf = (name:string, parent:string) => name.startsWith(`${parent}::`);

export function visibleDecks(decks:Deck[], {favoritesOnly=false,query='',collapsed=[]}:Filters={}) {
  const favorites=decks.filter(deck=>deck.favorite);
  // A starred branch is inclusive until a more specific favorite narrows it.
  const inclusive=favorites.filter(parent=>!favorites.some(child=>childOf(child.name,parent.name)));
  const needle=query.normalize('NFC').trim().toLocaleLowerCase();
  return decks.filter(deck=>
    (!favoritesOnly||deck.favorite||favorites.some(child=>childOf(child.name,deck.name))||inclusive.some(parent=>childOf(deck.name,parent.name))) &&
    deck.name.normalize('NFC').toLocaleLowerCase().includes(needle) &&
    (!!needle||!collapsed.some(parent=>childOf(deck.name,parent)))
  ).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
}
