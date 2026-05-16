/**
 * /functions/v1/refresh-conservation-status — IUCN + NOM-059 ETL pipeline (#550)
 *
 * Refreshes taxa.iucn_category (from GBIF/IUCN Red List) and
 * taxa.nom059_status (from embedded NOM-059 static lookup) for all taxa
 * with a non-NULL gbif_taxon_key.
 *
 * Two modes:
 *   • **backfill** `{ backfill: true, limit?: number }` — processes all taxa
 *     with gbif_taxon_key IS NOT NULL (NULL iucn_category prioritised).
 *     Auth: X-Cron-Secret only.
 *   • **delta**   `{ backfill: false }` or empty body — processes taxa where
 *     iucn_category IS NULL OR conservation_synced_at < NOW() - INTERVAL '30 days'.
 *     Auth: X-Cron-Secret only.
 *
 * Both modes are idempotent: they UPSERT only when a value has changed.
 *
 * IUCN source: GBIF Species API (free, no auth). The GBIF species/match
 * and species/{key} endpoints carry threat-status annotations populated
 * from IUCN Red List data shared with GBIF.
 *
 * NOM-059 source: embedded static lookup derived from CONABIO's published
 * NOM-059-SEMARNAT-2010 (updated 2023) species list. Mexico-only — taxa
 * not in this list stay NULL.
 *
 * Scheduled: monthly via pg_cron (see schema migration at the end of
 * docs/specs/infra/supabase-schema.sql — #550 cron entry).
 *
 * Returns: { ok, enriched, attempted, iucn_set, nom059_set, errors? }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// ── Auth ──────────────────────────────────────────────────────────────────────

function authOk(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  const sent     = req.headers.get('x-cron-secret');
  return !!(expected && sent === expected);
}

// ── NOM-059 static lookup (CONABIO NOM-059-SEMARNAT-2010, actualización 2023) ─
// Keys are canonical GBIF scientific names (lowercase, no author).
// Values: 'E' | 'P' | 'A' | 'Pr'
// This list covers the most commonly observed taxa in Rastrum; the full
// CONABIO spreadsheet can be loaded via the backfill script in scripts/.

const NOM059_LOOKUP: Record<string, 'E' | 'P' | 'A' | 'Pr'> = {
  // Mammals
  'panthera onca': 'P',
  'puma concolor': 'Pr',
  'leopardus pardalis': 'Pr',
  'tapirus bairdii': 'P',
  'trichechus manatus': 'P',
  'ursus americanus': 'A',
  'pecari tajacu': 'Pr',
  // Birds
  'ara macao': 'Pr',
  'ara militaris': 'P',
  'amazona oratrix': 'P',
  'amazona viridigenalis': 'P',
  'harpia harpyja': 'P',
  'spizaetus ornatus': 'A',
  'pharomachrus mocinno': 'P',
  // Reptiles
  'crocodylus acutus': 'Pr',
  'crocodylus moreletii': 'Pr',
  'dermochelys coriacea': 'P',
  'caretta caretta': 'A',
  'chelonia mydas': 'Pr',
  'lepidochelys olivacea': 'Pr',
  'eretmochelys imbricata': 'P',
  // Amphibians
  'ambystoma mexicanum': 'P',
  'ambystoma dumerilii': 'P',
  // Plants
  'agave victoriae-reginae': 'P',
  'mammillaria magnimamma': 'Pr',
  'turbinicarpus pseudopectinatus': 'P',
  'bursera fagaroides': 'Pr',
  'cedrela odorata': 'A',
  'swietenia macrophylla': 'A',
  'taxus globosa': 'P',
  'lacandonia schismatica': 'P',
  'laelia speciosa': 'Pr',
  // Fish
  'totoaba macdonaldi': 'P',
  'cyprinus carpio': 'Pr',
};

// ── GBIF helpers ──────────────────────────────────────────────────────────────

type IUCNCategory = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX' | 'DD' | 'NE';

const IUCN_CATEGORY_MAP: Record<string, IUCNCategory> = {
  'LEAST_CONCERN':          'LC',
  'NEAR_THREATENED':        'NT',
  'VULNERABLE':             'VU',
  'ENDANGERED':             'EN',
  'CRITICALLY_ENDANGERED':  'CR',
  'EXTINCT_IN_THE_WILD':    'EW',
  'EXTINCT':                'EX',
  'DATA_DEFICIENT':         'DD',
  'NOT_EVALUATED':          'NE',
};

async function fetchIucnFromGbif(
  gbifKey: number,
  fetchFn: typeof fetch = fetch,
): Promise<IUCNCategory | null> {
  try {
    const res = await fetchFn(
      `https://api.gbif.org/v1/species/${gbifKey}`,
      { headers: { 'User-Agent': 'Rastrum/1.0 (conservation ETL; https://rastrum.app)' } },
    );
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    // GBIF may carry iucnRedListCategory directly
    const cat = json.iucnRedListCategory as string | undefined;
    if (cat && IUCN_CATEGORY_MAP[cat]) return IUCN_CATEGORY_MAP[cat];
    // Fallback: threatStatuses array
    const threats = json.threatStatuses as Array<{ threatStatus?: string }> | undefined;
    if (Array.isArray(threats)) {
      for (const t of threats) {
        const s = t.threatStatus?.toUpperCase();
        if (s && IUCN_CATEGORY_MAP[s]) return IUCN_CATEGORY_MAP[s];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function nom059ForName(scientificName: string): 'E' | 'P' | 'A' | 'Pr' | null {
  const key = scientificName.toLowerCase().replace(/\s+/g, ' ').trim();
  return NOM059_LOOKUP[key] ?? null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

const RATE_DELAY_MS   = 220; // ~4.5 req/s — GBIF polite limit
const BATCH_DEFAULT   = 100;
const BATCH_MAX       = 500;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
      },
    });
  }

  if (!authOk(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const isBackfill = body.backfill === true;
  const limit      = Math.min(Number(body.limit ?? BATCH_DEFAULT), BATCH_MAX);

  // Fetch taxa to process
  let query = supabase
    .from('taxa')
    .select('id, scientific_name, gbif_taxon_key, iucn_category, nom059_status')
    .not('gbif_taxon_key', 'is', null)
    .limit(limit);

  if (!isBackfill) {
    // Delta: only stale or missing
    query = query.or('iucn_category.is.null,conservation_synced_at.lt.' +
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  } else {
    // Backfill: prioritise rows with NULL iucn_category
    query = query.order('iucn_category', { ascending: true, nullsFirst: true });
  }

  const { data: taxa, error: fetchErr } = await query;
  if (fetchErr) {
    return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!taxa || taxa.length === 0) {
    return new Response(JSON.stringify({ ok: true, enriched: 0, attempted: 0, iucn_set: 0, nom059_set: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const errors: string[] = [];
  let enriched  = 0;
  let iucn_set  = 0;
  let nom059_set = 0;

  for (const taxon of taxa as Array<{
    id: string;
    scientific_name: string;
    gbif_taxon_key: number;
    iucn_category: string | null;
    nom059_status: string | null;
  }>) {
    try {
      const newIucn  = await fetchIucnFromGbif(taxon.gbif_taxon_key);
      const newNom059 = nom059ForName(taxon.scientific_name);

      const changed =
        newIucn   !== taxon.iucn_category ||
        newNom059 !== taxon.nom059_status;

      if (changed) {
        const { error: updErr } = await supabase
          .from('taxa')
          .update({
            iucn_category:          newIucn,
            nom059_status:          newNom059,
            conservation_synced_at: new Date().toISOString(),
          })
          .eq('id', taxon.id);

        if (updErr) {
          errors.push(`${taxon.scientific_name}: ${updErr.message}`);
        } else {
          enriched++;
          if (newIucn  !== taxon.iucn_category) iucn_set++;
          if (newNom059 !== taxon.nom059_status) nom059_set++;
        }
      } else {
        // Still bump the sync timestamp so we don't re-check for 30 days
        await supabase
          .from('taxa')
          .update({ conservation_synced_at: new Date().toISOString() })
          .eq('id', taxon.id);
      }
    } catch (e) {
      errors.push(`${taxon.scientific_name}: ${String(e)}`);
    }

    // Rate-limit GBIF calls
    await new Promise(r => setTimeout(r, RATE_DELAY_MS));
  }

  const result: Record<string, unknown> = {
    ok: true,
    enriched,
    attempted: taxa.length,
    iucn_set,
    nom059_set,
  };
  if (errors.length) result.errors = errors;

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
