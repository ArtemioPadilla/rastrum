/**
 * /functions/v1/enrich-taxon — fill kingdom→genus lineage from GBIF.
 *
 * Two modes (selected by request body):
 *
 * 1. **Single**:  { taxon_id?: uuid, scientific_name?: string }
 *    Looks up one taxon, hits GBIF, UPDATEs the taxa row. Used as a
 *    fire-and-forget call from the `identify` EF after a new taxon row
 *    is upserted, so newly-encountered species enter with full lineage.
 *    Authentication: X-Cron-Secret OR a same-project service-role JWT.
 *
 * 2. **Batch**:   { batch: true, limit?: number }
 *    Sweeps up to `limit` (default 100, capped at 500) taxa rows where
 *    `kingdom IS NULL`, calls GBIF for each, and UPDATEs in series with a
 *    small inter-call delay to stay polite (GBIF asks ≤ 5 req/s).
 *    Authentication: X-Cron-Secret only.
 *
 * The identify EF only writes kingdom + family at insert (Claude returns
 * just those; PlantNet returns family). Phylum/class/order/genus stay NULL
 * unless this EF fills them.
 *
 * Cron-only contract: deployed --no-verify-jwt; access gated by the
 * X-Cron-Secret header (or a service-role bearer for the single-mode
 * fire-and-forget call from identify).
 *
 * Returns: { ok, enriched: number, attempted: number, errors?: string[] }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { lookupGbif, type Lineage } from '../_shared/gbif.ts';

const GBIF_RATE_DELAY_MS = 220; // ~4.5 req/s — under GBIF's polite ceiling
const BATCH_LIMIT_DEFAULT = 100;
const BATCH_LIMIT_MAX     = 500;

type SinglePayload = { taxon_id?: string; scientific_name?: string };
type BatchPayload  = { batch: true; limit?: number };
type Payload = SinglePayload | BatchPayload;

function isBatch(p: Payload): p is BatchPayload {
  return (p as BatchPayload).batch === true;
}

function authOk(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  const sentSecret = req.headers.get('x-cron-secret');
  if (expected && sentSecret === expected) return true;
  // Allow service-role JWT for the identify EF's fire-and-forget call:
  // the secret hop is redundant when the caller already has the role key.
  const auth = req.headers.get('authorization') ?? '';
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (role && auth === `Bearer ${role}`) return true;
  return false;
}

type TaxaRow = {
  id: string;
  scientific_name: string;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
};

async function selectOne(db: SupabaseClient, payload: SinglePayload): Promise<TaxaRow | null> {
  if (payload.taxon_id) {
    const { data } = await db.from('taxa')
      .select('id, scientific_name, kingdom, phylum, class, "order", family, genus')
      .eq('id', payload.taxon_id)
      .maybeSingle();
    return (data as unknown as TaxaRow) ?? null;
  }
  if (payload.scientific_name) {
    const { data } = await db.from('taxa')
      .select('id, scientific_name, kingdom, phylum, class, "order", family, genus')
      .eq('scientific_name', payload.scientific_name)
      .maybeSingle();
    return (data as unknown as TaxaRow) ?? null;
  }
  return null;
}

async function selectBatch(db: SupabaseClient, limit: number): Promise<TaxaRow[]> {
  const capped = Math.max(1, Math.min(BATCH_LIMIT_MAX, limit | 0));
  // Pick the rows missing the most lineage first — kingdom IS NULL is the
  // strongest signal of an un-enriched row, but we also re-visit rows that
  // got kingdom but no genus.
  const { data } = await db.from('taxa')
    .select('id, scientific_name, kingdom, phylum, class, "order", family, genus')
    .or('kingdom.is.null,genus.is.null')
    .not('scientific_name', 'is', null)
    .order('kingdom', { ascending: true, nullsFirst: true })
    .limit(capped);
  return ((data as unknown as TaxaRow[]) ?? []);
}

// Merge GBIF lineage onto a taxa row. Only fills NULL columns; never
// overwrites a value the caller already curated.
function mergeUpdate(row: TaxaRow, lineage: Lineage): Partial<TaxaRow> {
  const upd: Partial<TaxaRow> = {};
  if (!row.kingdom && lineage.kingdom) upd.kingdom = lineage.kingdom;
  if (!row.phylum  && lineage.phylum)  upd.phylum  = lineage.phylum;
  if (!row.class   && lineage.class)   upd.class   = lineage.class;
  if (!row.order   && lineage.order)   upd.order   = lineage.order;
  if (!row.family  && lineage.family)  upd.family  = lineage.family;
  if (!row.genus   && lineage.genus)   upd.genus   = lineage.genus;
  return upd;
}

async function enrichOne(db: SupabaseClient, row: TaxaRow): Promise<{ ok: boolean; reason?: string }> {
  const lineage = await lookupGbif(row.scientific_name);
  if (!lineage) return { ok: false, reason: `no GBIF match for "${row.scientific_name}"` };
  const upd = mergeUpdate(row, lineage);
  if (Object.keys(upd).length === 0) return { ok: true };
  const { error } = await db.from('taxa').update(upd).eq('id', row.id);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

serve(async (req) => {
  if (!authOk(req)) return new Response('forbidden', { status: 403 });

  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) return new Response('Function not configured', { status: 500 });
  const db = createClient(url, role, { auth: { persistSession: false } });

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const started = Date.now();
  const errors: string[] = [];
  let attempted = 0;
  let enriched = 0;

  if (isBatch(payload)) {
    const rows = await selectBatch(db, payload.limit ?? BATCH_LIMIT_DEFAULT);
    for (const row of rows) {
      attempted++;
      const r = await enrichOne(db, row);
      if (r.ok) enriched++;
      else if (r.reason) errors.push(r.reason);
      await sleep(GBIF_RATE_DELAY_MS);
    }
  } else {
    const row = await selectOne(db, payload as SinglePayload);
    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: 'taxon not found' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }
    attempted = 1;
    const r = await enrichOne(db, row);
    if (r.ok) enriched = 1;
    else if (r.reason) errors.push(r.reason);
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    attempted,
    enriched,
    errors: errors.length ? errors.slice(0, 20) : undefined,
  }), { headers: { 'content-type': 'application/json' } });
});
