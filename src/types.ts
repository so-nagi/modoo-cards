export type Skin = 'classic';
export interface Settings { skin: Skin; theme: 'light' | 'neutral' | 'dark'; accent: string; sounds: boolean; volume: number; cardFontSize: number; heatmap: boolean; remainingTime: boolean; zen: boolean }
export interface Deck { id: number; name: string; newCount: number; learnCount: number; reviewCount: number; filtered?: boolean; favorite?: boolean }
export interface Model { id: number; name: string; fields: string[]; templates?: {name: string; qfmt: string; afmt: string}[]; css?: string; type?: number }
export interface Stats { today: number; totalCards: number; totalNotes: number; reviewTime: number; streak: number; retention: number; history: {date: string; count: number}[]; forecast: {date: string; count: number}[]; counts: {new: number; learn: number; review: number; suspended: number}; ratings: {rating: number; count: number}[] }
export interface CardRow { id: number; noteId: number; deckId: number; deckName: string; modelName: string; fields: string[]; fieldNames: string[]; tags: string[]; front: string; back: string; due: number; interval: number; reps: number; lapses: number; queue: number; flag: number; ord?: number; history?: Record<string, unknown>[]; css?: string }
export interface StudyCard { id: number; noteId: number; front: string; back: string; css: string; modelName: string; buttons: {rating: number; label: string; interval: string}[]; token: string }
export interface Bootstrap { decks: Deck[]; models: Model[]; settings: Settings; stats: Stats }
export type View = 'decks' | 'study' | 'add' | 'browse' | 'stats' | 'models' | 'settings';
export const defaultSettings: Settings = {skin:'classic',theme:'light',accent:'#3a3632',sounds:true,volume:0.3,cardFontSize:20,heatmap:true,remainingTime:true,zen:false};

