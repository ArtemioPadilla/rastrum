/**
 * /functions/v1/plantnet-monitor — daily PlantNet quota probe.
 *
 * Reads PlantNet's `/v2/usage` endpoint with the project's API key and
 * upserts a row in `public.api_usage` keyed by (date, provider). Cron runs
 * at 23:55 UTC so we capture the day before it rolls over.
 *
 * Optional: when PLANTNET_QUOTA_WEBHOOK_URL is set and usage > 80% of the
 * remaining quota, post a single message to the webhook (Slack/Discord
 * compatible payload). The function is gated behind that secret so a
 * forgotten / leaked webhook doesn't ping a stranger's channel.
 *
 * Schedule via `pg_cron` — see docs/specs/infra/cron-schedules.sql.
 *
 * Required env vars (set via `supabase secrets set`):
 *   PLANTNET_API_KEY              PlantNet v2 API key (operator project key)
 *   SUPABASE_SERVICE_ROLE_KEY     Bypasses RLS to upsert into api_usage
 *   SUPABASE_URL                  Supabase project URL
 *
 * Optional:
 *   PLANTNET_QUOTA_WEBHOOK_URL    Slack/Discord webhook for >80% alerts
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PlantNetUsage {
  remaining: number;
  quota: number;
  // PlantNet's /v2/usage shape isn't formally documented; the function
  // tolerates extra fields so the operator can probe and add columns later.
  [k: string]: unknown;
}

async function fetchPlantNetUsage(apiKey: string): Promise<PlantNetUsage | null> {
  const res = await fetch(
    `https://my-api.plantnet.org/v2/usage?api-key=${encodeURIComponent(apiKey)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as PlantNetUsage;
}

async function postWebhook(url: string, message: string): Promise<void> {
  // Slack and Discord both accept `{ "text": "…" }` / `{ "content": "…" }`.
  // We send both keys so the same secret works regardless.
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: message, content: message }),
  });
}

serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('PLANTNET_API_KEY');
  if (!url || !role) return new Response('Function not configured', { status: 500 });
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'no_plantnet_key', skipped: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const usage = await fetchPlantNetUsage(apiKey);
  if (!usage) {
    return new Response(JSON.stringify({ error: 'plantnet_usage_failed' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const quota = Number(usage.quota ?? 0);
  const remaining = Number(usage.remaining ?? 0);
  const used = Math.max(0, quota - remaining);
  const percent = quota > 0 ? used / quota : 0;

  const today = new Date().toISOString().slice(0, 10);
  const db = createClient(url, role);
  const { error } = await db.from('api_usage').upsert(
    {
      date: today,
      provider: 'plantnet',
      used,
      quota,
      remaining,
      raw: usage,
    },
    { onConflict: 'date,provider' },
  );

  // Optional alert path — only fires when the operator opted in by setting
  // the webhook secret. > 80% of quota used == "tell me" threshold.
  const webhook = Deno.env.get('PLANTNET_QUOTA_WEBHOOK_URL');
  if (webhook && percent >= 0.8) {
    const pct = Math.round(percent * 100);
    await postWebhook(
      webhook,
      `Rastrum: PlantNet daily quota at ${pct}% (${used} / ${quota}). Remaining: ${remaining}.`,
    ).catch(() => { /* swallow webhook errors — alerts are best-effort */ });
  }

  return new Response(
    JSON.stringify({ provider: 'plantnet', used, quota, remaining, percent, db_error: error?.message ?? null }),
    { headers: { 'content-type': 'application/json' } },
  );
});
