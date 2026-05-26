import { pillForSpecies, type SpeciesPillInput } from './species-display';
import { escAttr } from './karma';

export type CardData = SpeciesPillInput & {
  taxonId: string;
  scientificName: string;
  commonName: string | null;
  thumbnailUrl: string | null;
  metaLine: string;
  inDex?: boolean;
  href?: string | null;
};

export type CardLabels = {
  rarity_5: string;
  rarity_4: string;
  rarity_3: string;
  endemic_mx: string;
  nom059: string;
  no_photo: string;
  in_dex: string;
};

const TONE_CLASS: Record<string, string> = {
  'amber':       'bg-white/95 text-amber-700',
  'amber-light': 'bg-white/95 text-amber-600',
  'lime':        'bg-lime-100/95 text-lime-900',
  'orange':      'bg-white/95 text-orange-700',
};

export function renderSpeciesCard(d: CardData, labels: CardLabels): string {
  const pill = pillForSpecies(d);
  const pillLabel = pill ? (labels as unknown as Record<string, string>)[pill.label] ?? '' : '';
  const tag = d.href ? 'a' : 'div';
  const href = d.href ? ` href="${escAttr(d.href)}"` : '';
  const star = pill && (pill.tone === 'amber' || pill.tone === 'amber-light') ? '★ ' : '';
  return `<${tag}${href} class="block group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden hover:border-emerald-400 dark:hover:border-emerald-700 transition-colors" data-taxon-id="${escAttr(d.taxonId)}">
    <div class="relative aspect-[16/10] bg-gradient-to-br from-emerald-50 to-cyan-50 dark:from-zinc-800 dark:to-zinc-900">
      ${d.thumbnailUrl
        ? `<img src="${escAttr(d.thumbnailUrl)}" alt="${escAttr(d.scientificName)}" loading="lazy" class="absolute inset-0 w-full h-full object-cover">`
        : `<span class="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">${escAttr(labels.no_photo)}</span>`}
      ${pill && pillLabel
        ? `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-sm ${TONE_CLASS[pill.tone]}">${star}${escAttr(pillLabel)}</span>`
        : ''}
      ${d.inDex
        ? `<span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center shadow-sm" aria-label="${escAttr(labels.in_dex)}" title="${escAttr(labels.in_dex)}">✓</span>`
        : ''}
    </div>
    <div class="p-3">
      <p class="text-sm italic font-bold text-emerald-700 dark:text-emerald-400 truncate">${escAttr(d.scientificName)}</p>
      ${d.commonName ? `<p class="text-sm text-zinc-700 dark:text-zinc-300 truncate">${escAttr(d.commonName)}</p>` : ''}
      <p class="text-[11px] text-zinc-600 dark:text-zinc-400 mt-1.5">${escAttr(d.metaLine)}</p>
    </div>
  </${tag}>`;
}
