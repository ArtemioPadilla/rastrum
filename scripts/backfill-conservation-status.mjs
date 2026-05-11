#!/usr/bin/env node
/**
 * scripts/backfill-conservation-status.mjs
 *
 * One-time backfill: populates taxa.iucn_category (via GBIF Species API)
 * and taxa.nom059_status (via embedded NOM-059 lookup) for all taxa with
 * a non-NULL gbif_taxon_key.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/backfill-conservation-status.mjs [--limit 500] [--dry-run]
 *
 * The nightly Edge Function (supabase/functions/refresh-conservation-status)
 * handles delta updates after the initial backfill.
 *
 * Rate-limiting: GBIF polite ceiling is ~5 req/s. This script uses a 220 ms
 * inter-call delay (≈ 4.5 req/s). Estimated time for 1000 taxa: ~4 minutes.
 *
 * See docs/runbooks/conservation-status-etl.md for full instructions.
 */

import { createClient } from '@supabase/supabase-js';

const RATE_DELAY_MS = 220;
const BATCH_SIZE    = 100;

// ── NOM-059 static lookup (same data as Edge Function) ───────────────────────
const NOM059_LOOKUP = {
  'panthera onca': 'P',
  'puma concolor': 'Pr',
  'leopardus pardalis': 'Pr',
  'tapirus bairdii': 'P',
  'trichechus manatus': 'P',
  'ursus americanus': 'A',
  'pecari tajacu': 'Pr',
  'ara macao': 'Pr',
  'ara militaris': 'P',
  'amazona oratrix': 'P',
  'amazona viridigenalis': 'P',
  'harpia harpyja': 'P',
  'spizaetus ornatus': 'A',
  'pharomachrus mocinno': 'P',
  'crocodylus acutus': 'Pr',
  'crocodylus moreletii': 'Pr',
  'dermochelys coriacea': 'P',
  'caretta caretta': 'A',
  'chelonia mydas': 'Pr',
  'lepidochelys olivacea': 'Pr',
  'eretmochelys imbricata': 'P',
  'ambystoma mexicanum': 'P',
  'ambystoma dumerilii': 'P',
  'agave victoriae-reginae': 'P',
  'mammillaria magnimamma': 'Pr',
  'turbinicarpus pseudopectinatus': 'P',
  'bursera fagaroides': 'Pr',
  'cedrela odorata': 'A',
  'swietenia macrophylla': 'A',
  'taxus globosa': 'P',
  'lacandonia schismatica': 'P',
  'laelia speciosa': 'Pr',
  'totoaba macdonaldi': 'P',
  'cyprinus carpio': 'Pr',
};

const IUCN_MAP = {
  LEAST_CONCERN:         'LC',
  NEAR_THREATENED:       'NT',
  VULNERABLE:            'VU',
  ENDANGERED:            'EN',
  CRITICALLY_ENDANGERED: 'CR',
  EXTINCT_IN_THE_WILD:   'EW',
  EXTINCT:               'EX',
  DATA_DEFICIENT:        'DD',
  NOT_EVALUATED:         'NE',
};

async function fetchIucn(gbifKey) {
  try {
    const res = await fetch(`https://api.gbif.org/v1/species/${gbifKey}`, {
      headers: { 'User-Agent': 'Rastrum/1.0 (backfill; https://rastrum.app)' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.iucnRedListCategory && IUCN_MAP[j.iucnRedListCategory]) {
      return IUCN_MAP[j.iucnRedListCategory];
    }
    if (Array.isArray(j.threatStatuses)) {
      for (const t of j.threatStatuses) {
        const s = t.threatStatus?.toUpperCase();
        if (s && IUCN_MAP[s]) return IUCN_MAP[s];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function nom059(name) {
  return NOM059_LOOKUP[name?.toLowerCase().replace(/\s+/g, ' ').trim()] ?? null;
}

async function main() {
  const url    = process.env.SUPABASE_URL;
  const key    = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const limit  = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '5000');
  const dryRun = process.argv.includes('--dry-run');

  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  let offset  = 0;
  let total   = 0;
  let updated = 0;
  let errors  = 0;

  console.log(`Starting backfill. limit=${limit} dry-run=${dryRun}`);

  while (offset < limit) {
    const batchLimit = Math.min(BATCH_SIZE, limit - offset);
    const { data: taxa, error } = await supabase
      .from('taxa')
      .select('id, scientific_name, gbif_taxon_key, iucn_category, nom059_status')
      .not('gbif_taxon_key', 'is', null)
      .order('iucn_category', { ascending: true, nullsFirst: true })
      .range(offset, offset + batchLimit - 1);

    if (error) { console.error('Fetch error:', error.message); break; }
    if (!taxa || taxa.length === 0) { console.log('No more taxa to process.'); break; }

    for (const t of taxa) {
      total++;
      const newIucn   = await fetchIucn(t.gbif_taxon_key);
      const newNom059 = nom059(t.scientific_name);
      const changed   = newIucn !== t.iucn_category || newNom059 !== t.nom059_status;

      if (!dryRun && changed) {
        const { error: upErr } = await supabase
          .from('taxa')
          .update({
            iucn_category:          newIucn,
            nom059_status:          newNom059,
            conservation_synced_at: new Date().toISOString(),
          })
          .eq('id', t.id);

        if (upErr) {
          console.error(`  ✗ ${t.scientific_name}: ${upErr.message}`);
          errors++;
        } else {
          console.log(`  ✓ ${t.scientific_name}: IUCN=${newIucn ?? 'null'} NOM059=${newNom059 ?? 'null'}`);
          updated++;
        }
      } else if (dryRun && changed) {
        console.log(`  [dry] ${t.scientific_name}: IUCN ${t.iucn_category}→${newIucn} NOM059 ${t.nom059_status}→${newNom059}`);
        updated++;
      } else {
        process.stdout.write('.');
      }

      await new Promise(r => setTimeout(r, RATE_DELAY_MS));
    }

    offset += taxa.length;
    if (taxa.length < batchLimit) break;
  }

  console.log(`\nDone. processed=${total} updated=${updated} errors=${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
