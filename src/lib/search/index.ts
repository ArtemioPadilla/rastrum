import Fuse from 'fuse.js';
import type { SearchEntry } from './types';

export type { SearchEntry };
export type { SearchEntryType } from './types';

const FUSE_OPTS: ConstructorParameters<typeof Fuse<SearchEntry>>[1] = {
  keys: ['label', 'labelAlt', 'description', 'keywords'],
  threshold: 0.3,
  includeScore: true,
  minMatchCharLength: 1,
};

let fuseByLang: Record<string, Fuse<SearchEntry>> = {};
let entriesByLang: Record<string, SearchEntry[]> = {};

export async function loadIndex(lang: string): Promise<void> {
  if (fuseByLang[lang]) return;
  const resp = await fetch(`/search-index.${lang}.json`);
  if (!resp.ok) throw new Error(`Failed to load search index for ${lang}`);
  const entries = (await resp.json()) as SearchEntry[];
  entriesByLang[lang] = entries;
  fuseByLang[lang] = new Fuse(entries, FUSE_OPTS);
}

export function search(query: string, lang: string): SearchEntry[] {
  const fuse = fuseByLang[lang];
  if (!fuse) return [];
  if (!query.trim()) return [];
  return fuse.search(query).map(r => r.item);
}

export function getEntries(lang: string): SearchEntry[] {
  return entriesByLang[lang] ?? [];
}

export function getEntriesByType(lang: string, type: SearchEntry['type']): SearchEntry[] {
  return getEntries(lang).filter(e => e.type === type);
}
