export type SpeciesPillInput = {
  rarity_bucket: number | null;
  endemic_mx: boolean | null;
  nom059_status: string | null;
};

export type PillTone = 'amber' | 'amber-light' | 'lime' | 'orange';
export type PillKind = 'rarity-rare' | 'rarity-notable' | 'endemic' | 'nom059';

export type Pill = {
  kind: PillKind;
  label: string;
  tone: PillTone;
};

// NOM-059 short codes per docs/specs/infra/supabase-schema.sql line 177
// E = en peligro de extinción, A = amenazada, Pr = sujeta a protección especial.
// 'P' (probablemente extinta) is intentionally excluded — too rare to flag for
// the "threatened" pill. Exported because species-filters.ts imports it.
export const NOM059_THREATENED = new Set(['E', 'A', 'Pr']);

export function pillForSpecies(input: SpeciesPillInput): Pill | null {
  const bucket = input.rarity_bucket ?? 1;
  if (bucket >= 4) {
    return { kind: 'rarity-rare', label: `rarity_${bucket}`, tone: 'amber' };
  }
  if (input.endemic_mx === true) {
    return { kind: 'endemic', label: 'endemic_mx', tone: 'lime' };
  }
  if (input.nom059_status && NOM059_THREATENED.has(input.nom059_status)) {
    return { kind: 'nom059', label: 'nom059', tone: 'orange' };
  }
  if (bucket === 3) {
    return { kind: 'rarity-notable', label: `rarity_${bucket}`, tone: 'amber-light' };
  }
  return null;
}

// Most existing taxa rows lack a populated `genus` column because the
// identify EF only writes kingdom/family at insert. Derive it from the
// `Genus species` binomial as a safe client-side fallback.
//
// Conservative regex: only accepts a Capitalised followed by lowercase
// (`Aratinga`, `Canis`). Rejects abbreviations (`sp.`), hybrids
// (`×Genus`), parenthesised subgenera, and noise. Returns null when in
// doubt — callers treat null as "no genus information".
export function deriveGenus(name: string): string | null {
  const first = name.trim().split(/\s+/)[0];
  if (!first || first.length < 2) return null;
  if (!/^[A-Z][a-z]+$/.test(first)) return null;
  return first;
}

// Stable colour for arbitrary taxon names when no known kingdom mapping
// applies. Uses golden-ratio hue stepping over HSL so distinct names get
// distinct hues regardless of how many appear (no collisions on a tiny
// fixed palette). Saturation/lightness are tuned for legibility on both
// light and dark sunburst backgrounds.
//
// Stable: same input → same output across sessions and rebuilds.
export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = ((Math.abs(h) * 137) % 360);
  return `hsl(${hue}, 62%, 52%)`;
}

// ── Taxonomic tree helpers (used by both sunburst + dendrogram) ─────────

export type TaxonInput = {
  id: string;
  scientific_name: string;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  slug: string | null;
  observation_count: number;
};

export type TaxonNode = {
  name: string;
  rank: string;
  count: number;
  slug?: string;
  taxonId?: string;
  kingdom?: string;
  children: TaxonNode[];
};

// Build a kingdom→species tree from a flat list of taxa. Ranks with null
// values are skipped so sparse rows still produce a sensible tree (e.g.
// when only `scientific_name` + derived `genus` are populated, the tree
// becomes root → genus → species without empty intermediates).
//
// Once GBIF enrichment lands every row gets full lineage and the tree
// reaches its natural depth (root → kingdom → phylum → class → order →
// family → genus → species, depth 7).
export function buildTaxonomicTree(rows: TaxonInput[]): TaxonNode {
  const treeRoot: TaxonNode = { name: 'All species', rank: 'root', count: 0, children: [] };
  for (const t of rows) {
    const path: Array<{ rank: string; name: string; slug?: string; taxonId?: string }> = [
      { rank: 'kingdom', name: t.kingdom ?? '?' },
      { rank: 'phylum',  name: t.phylum ?? '?' },
      { rank: 'class',   name: t.class ?? '?' },
      { rank: 'order',   name: t.order ?? '?' },
      { rank: 'family',  name: t.family ?? '?' },
      { rank: 'genus',   name: t.genus ?? '?' },
      { rank: 'species', name: t.scientific_name, slug: t.slug ?? undefined, taxonId: t.id },
    ];
    let cur = treeRoot;
    const kingdomName = path[0].name;
    for (const p of path) {
      if (!p.name || p.name === '?') continue;
      let child = cur.children.find(c => c.name === p.name && c.rank === p.rank);
      if (!child) {
        child = { name: p.name, rank: p.rank, count: 0, kingdom: kingdomName, children: [] };
        if (p.slug) child.slug = p.slug;
        if (p.taxonId) child.taxonId = p.taxonId;
        cur.children.push(child);
      }
      child.count += t.observation_count ?? 1;
      cur = child;
    }
    treeRoot.count += t.observation_count ?? 1;
  }
  return treeRoot;
}

export function taxonomicDepth(node: TaxonNode): number {
  if (!node.children.length) return 0;
  let m = 0;
  for (const c of node.children) m = Math.max(m, taxonomicDepth(c));
  return 1 + m;
}
