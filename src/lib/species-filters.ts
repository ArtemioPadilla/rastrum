import { NOM059_THREATENED } from './species-display';

export type ChipsState = {
  endemic: boolean;
  nom059: boolean;
  rare: boolean;
  kingdom: string | null;
};

export type SpeciesRow = {
  taxon_id: string;
  kingdom: string | null;
  endemic_mx: boolean | null;
  nom059_status: string | null;
  rarity_bucket: number | null;
};

const KNOWN_KINGDOMS = new Set([
  'Animalia', 'Plantae', 'Fungi', 'Chromista', 'Protozoa', 'Bacteria', 'Archaea',
]);

function truthy(v: string | null): boolean {
  return v === '1' || v === 'true';
}

export function parseChips(qs: string): ChipsState {
  const p = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const kingdom = p.get('kingdom');
  return {
    endemic: truthy(p.get('endemic')),
    nom059:  truthy(p.get('nom059')),
    rare:    truthy(p.get('rare')),
    kingdom: kingdom && KNOWN_KINGDOMS.has(kingdom) ? kingdom : null,
  };
}

export function serializeChips(s: ChipsState): string {
  const p = new URLSearchParams();
  if (s.endemic) p.set('endemic', '1');
  if (s.nom059)  p.set('nom059',  '1');
  if (s.rare)    p.set('rare',    '1');
  if (s.kingdom) p.set('kingdom', s.kingdom);
  const out = p.toString();
  return out ? `?${out}` : '';
}

export type SortMode = 'obs' | 'recent' | 'alpha';

export const DEFAULT_SORT: SortMode = 'obs';

export function parseSort(qs: string): SortMode {
  const p = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const v = p.get('sort');
  if (v === 'recent' || v === 'alpha' || v === 'obs') return v;
  return DEFAULT_SORT;
}

export function serializeFilters(s: ChipsState, sort: SortMode): string {
  const chipFrag = serializeChips(s);
  if (sort === DEFAULT_SORT) return chipFrag;
  const sep = chipFrag === '' ? '?' : '&';
  return `${chipFrag}${sep}sort=${sort}`;
}

export function filterByChips<T extends SpeciesRow>(rows: T[], s: ChipsState): T[] {
  return rows.filter((r) => {
    if (s.kingdom && r.kingdom !== s.kingdom) return false;
    if (s.endemic && r.endemic_mx !== true) return false;
    if (s.rare && (r.rarity_bucket ?? 1) < 4) return false;
    if (s.nom059 && !(r.nom059_status && NOM059_THREATENED.has(r.nom059_status))) return false;
    return true;
  });
}
