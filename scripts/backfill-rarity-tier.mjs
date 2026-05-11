#!/usr/bin/env node
/**
 * scripts/backfill-rarity-tier.mjs
 *
 * One-time backfill: populates taxa.rarity_tier for all existing taxa using
 * observation counts from the platform's `observations` table.
 *
 * Rarity classification (based on platform observation counts):
 *   NULL  → no observations recorded on this platform
 *   4     → very rare  (1–5 observations)
 *   3     → rare       (6–20 observations)
 *   2     → uncommon   (21–100 observations)
 *   1     → common     (101+ observations)
 *
 * This mirrors the thresholds used by `daily_challenge_for_user()` RPC.
 * See docs/specs/infra/supabase-schema.sql for the column definition.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/backfill-rarity-tier.mjs [--dry-run] [--limit 5000]
 *
 * The script is idempotent — safe to run multiple times. It overwrites any
 * existing rarity_tier values with a freshly-computed classification.
 *
 * After the initial backfill, keep rarity_tier fresh by including a
 * rarity recompute step in the nightly `recompute-taxa-cache` Edge Function.
 *
 * Related:
 *   - Issue #928 (column addition migration)
 *   - Issue #932 (this backfill)
 *   - docs/runbooks/admin-ops.md
 */

import { createClient } from '@supabase/supabase-js';

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const limitArg  = args.find(a => a.startsWith('--limit=') || a === '--limit');
const LIMIT     = limitArg
  ? parseInt(limitArg.startsWith('--limit=') ? limitArg.split('=')[1] : args[args.indexOf('--limit') + 1], 10)
  : Infinity;

const BATCH_SIZE = 100;

// ── Supabase client ────────────────────────────────────────────────────────
// Evaluated lazily inside main() so the module can be imported in tests
// without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY being set.
let supabase = null;

// ── Classification logic ───────────────────────────────────────────────────

/**
 * Compute rarity_tier from a raw observation count.
 *
 * @param {number} count - Number of (synced) observations for the taxon.
 * @returns {number | null} Tier 1–4, or null for zero observations.
 */
export function classifyRarityTier(count) {
  if (count === 0)         return null;
  if (count <= 5)          return 4; // very rare
  if (count <= 20)         return 3; // rare
  if (count <= 100)        return 2; // uncommon
  return 1;                          // common (101+)
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[backfill-rarity-tier] ${DRY_RUN ? '(DRY RUN) ' : ''}Starting…`);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  //    We join via identifications → observations to count unique synced
  //    observations per taxon_id (same logic the daily challenge RPC uses).
  //
  //    Using a raw SQL query through supabase.rpc or the REST endpoint is
  //    more efficient for aggregations. Here we use a pragmatic approach:
  //    fetch taxa IDs in pages and count observations per taxon.
  //
  //    For large platforms (> 50 k taxa) consider running the SQL migration
  //    in supabase-schema.sql directly for speed.

  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  console.log('[backfill-rarity-tier] Fetching observation counts per taxon…');

  // Step 1: Aggregate observation counts per taxon_id from the observations table.
  // We do this in a single RPC-like approach by reading observations in batches.
  // For production accuracy, use the `primary_taxon_id` column if available.

  const countsMap = new Map(); // taxon_id → count

  let obsOffset = 0;
  const OBS_BATCH = 1000;

  for (;;) {
    const { data: rows, error } = await supabase
      .from('observations')
      .select('primary_taxon_id')
      .not('primary_taxon_id', 'is', null)
      .eq('sync_status', 'synced')
      .range(obsOffset, obsOffset + OBS_BATCH - 1);

    if (error) {
      console.error('[backfill-rarity-tier] Error fetching observations:', error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const tid = row.primary_taxon_id;
      countsMap.set(tid, (countsMap.get(tid) ?? 0) + 1);
    }

    obsOffset += rows.length;
    if (rows.length < OBS_BATCH) break;
    // Brief yield to avoid hammering the API
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`[backfill-rarity-tier] Counted observations for ${countsMap.size} distinct taxa.`);

  // Step 2: Fetch all taxa IDs and compute + upsert rarity_tier in batches.
  let taxaOffset = 0;
  const TAXA_BATCH = BATCH_SIZE;

  for (;;) {
    if (totalProcessed >= LIMIT) {
      console.log(`[backfill-rarity-tier] Reached --limit=${LIMIT}, stopping.`);
      break;
    }

    const { data: taxa, error: taxaErr } = await supabase
      .from('taxa')
      .select('id')
      .range(taxaOffset, taxaOffset + TAXA_BATCH - 1)
      .order('id');

    if (taxaErr) {
      console.error('[backfill-rarity-tier] Error fetching taxa:', taxaErr.message);
      process.exit(1);
    }
    if (!taxa || taxa.length === 0) break;

    // Build upsert payload for this batch.
    const updates = taxa.map(t => ({
      id: t.id,
      rarity_tier: classifyRarityTier(countsMap.get(t.id) ?? 0),
    }));

    totalProcessed += taxa.length;

    if (!DRY_RUN) {
      const { error: upsertErr } = await supabase
        .from('taxa')
        .upsert(updates, { onConflict: 'id' });

      if (upsertErr) {
        console.error('[backfill-rarity-tier] Upsert error:', upsertErr.message);
        process.exit(1);
      }
    }

    const changedCount = updates.filter(u => u.rarity_tier !== undefined).length;
    totalUpdated += changedCount;

    const tierSummary = updates.reduce((acc, u) => {
      const k = u.rarity_tier === null ? 'null' : String(u.rarity_tier);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `[backfill-rarity-tier] Batch ${taxaOffset}–${taxaOffset + taxa.length - 1}: ` +
      `${taxa.length} taxa — tiers: ${JSON.stringify(tierSummary)}`,
    );

    taxaOffset += taxa.length;
    if (taxa.length < TAXA_BATCH) break;

    // Polite delay between batches
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(
    `[backfill-rarity-tier] Done. Processed: ${totalProcessed} taxa, Updated: ${totalUpdated}.` +
    (DRY_RUN ? ' (DRY RUN — no rows written)' : ''),
  );
}

// Only run when executed directly (not when imported by tests).
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname ===
    new URL(import.meta.url).pathname) {
  main().catch(err => {
    console.error('[backfill-rarity-tier] Unexpected error:', err);
    process.exit(1);
  });
}
