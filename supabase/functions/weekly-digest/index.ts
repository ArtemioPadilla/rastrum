/**
 * /functions/v1/weekly-digest — hourly cron Edge Function.
 *
 * Sends weekly digest emails to inactive users (last_observation_at < 7 days ago)
 * who have email notifications enabled. Buckets by timezone so each user
 * receives the email at approximately 14:00 local time.
 *
 * Issue #868: Weekly email digest for inactive users.
 *
 * Schedule via pg_cron (see docs/specs/infra/supabase-schema.sql):
 *   SELECT cron.schedule('weekly-digest', '0 * * * *', $$...$$);
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';
import { sendEmail } from '../_shared/email.ts';
import { renderDigest, DigestData, DigestUser } from '../_shared/render-digest.ts';

// ---------------------------------------------------------------------------
// Types matching DB rows
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  display_name: string | null;
  email: string;
  preferred_language: string | null;
  country_code: string | null;
  timezone: string | null;
}

interface ObsRow {
  scientific_name: string | null;
  observer_id: string;
  created_at: string;
  share_token: string | null;
  users?: { display_name: string | null } | null;
}

interface TaxonRow {
  scientific_name: string;
  common_name_en: string | null;
  common_name_es: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the UTC hour that corresponds to ~14:00 in the given IANA timezone.
 * Falls back to 14 (UTC) if timezone is invalid/unknown.
 */
function localNoonUtcHour(timezone: string | null): number {
  if (!timezone) return 14;
  try {
    // Find the UTC offset by formatting a known time and parsing the difference
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const localHour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '14', 10);
    const currentUtcHour = now.getUTCHours();
    // offset = currentUtcHour - localHour  → target UTC = 14 - offset = 14 - (utc - local) = 14 + local - utc
    const offset = currentUtcHour - localHour;
    return ((14 + offset) % 24 + 24) % 24;
  } catch {
    return 14;
  }
}

const DEFAULT_LANGUAGE = 'en' as const;

function toLanguage(raw: string | null): 'en' | 'es' {
  if (raw === 'es') return 'es';
  return DEFAULT_LANGUAGE;
}

function buildShareUrl(shareToken: string | null, obsId: string): string {
  const base = 'https://rastrum.org';
  if (shareToken) return `${base}/share/${shareToken}`;
  return `${base}/obs/${obsId}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const unsubscribeSecret = Deno.env.get('UNSUBSCRIBE_SECRET') ?? '';

  if (!url || !role) {
    return new Response(JSON.stringify({ error: 'Function not configured' }), { status: 500 });
  }

  const db = createClient(url, role);
  const currentUtcHour = new Date().getUTCHours();

  // Fetch all eligible users and bucket by timezone. Email lives in
  // auth.users (not denormalised into public.users), so the eligibility
  // filter + join are done server-side by the digest_recipients() RPC.
  const { data: users, error: usersError } = await db.rpc('digest_recipients');

  if (usersError) {
    console.error('[weekly-digest] digest_recipients RPC error:', usersError.message);
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }

  // Filter to users whose local time is ~14:00 right now (±30 min tolerance = same UTC hour)
  const targetUsers = (users as UserRow[]).filter((u) => {
    const targetUtcHour = localNoonUtcHour(u.timezone);
    return targetUtcHour === currentUtcHour;
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const u of targetUsers) {
    try {
      const lang = toLanguage(u.preferred_language);

      // ── Follower observations (top 3) ────────────────────────────────────
      const { data: followerObsRaw } = await db
        .from('observations')
        .select('scientific_name, observer_id, created_at, share_token, users!observer_id(display_name)')
        .in(
          'observer_id',
          db
            .from('follows')
            .select('followee_id')
            .eq('follower_id', u.id) as unknown as string[]
        )
        .order('created_at', { ascending: false })
        .limit(3);

      const follower_obs = ((followerObsRaw ?? []) as ObsRow[]).map((obs) => ({
        scientific_name: obs.scientific_name ?? 'Unknown',
        observer_name: obs.users?.display_name ?? 'Unknown',
        observed_at: obs.created_at,
        share_url: buildShareUrl(obs.share_token ?? null, obs.observer_id),
      }));

      // ── Missing species (1 suggestion) ───────────────────────────────────
      // Get user's observed taxon ids first
      const { data: userTaxonIds } = await db
        .from('observations')
        .select('primary_taxon_id')
        .eq('observer_id', u.id)
        .not('primary_taxon_id', 'is', null);

      const observedIds = (userTaxonIds ?? [])
        .map((r: { primary_taxon_id: string | null }) => r.primary_taxon_id)
        .filter(Boolean) as string[];

      let missing_species: { scientific_name: string; common_name: string | null }[] = [];
      {
        let taxaQuery = db
          .from('taxa')
          .select('scientific_name, common_name_en, common_name_es')
          .order('observation_count', { ascending: false })
          .limit(1);

        if (observedIds.length > 0) {
          taxaQuery = taxaQuery.not('id', 'in', `(${observedIds.join(',')})`);
        }

        const { data: taxa } = await taxaQuery;
        missing_species = ((taxa ?? []) as TaxonRow[]).map((t) => ({
          scientific_name: t.scientific_name,
          common_name: lang === 'es' ? (t.common_name_es ?? t.common_name_en ?? null) : (t.common_name_en ?? null),
        }));
      }

      // ── Community stats (this week) ───────────────────────────────────────
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: totalObsWeek } = await db
        .from('observations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekAgo);

      const { count: newSpeciesWeek } = await db
        .from('observations')
        .select('primary_taxon_id', { count: 'exact', head: true })
        .gte('created_at', weekAgo)
        .not('primary_taxon_id', 'is', null);

      const community_stats = {
        total_obs_week: totalObsWeek ?? 0,
        new_species_week: newSpeciesWeek ?? 0,
      };

      // ── Build HMAC token for unsubscribe link ─────────────────────────────
      const encoder = new TextEncoder();
      const keyData = encoder.encode(unsubscribeSecret);
      const msgData = encoder.encode(u.id + 'weekly-digest');
      let unsubToken = 'PLACEHOLDER';
      if (unsubscribeSecret) {
        try {
          const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
          unsubToken = Array.from(new Uint8Array(sig))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        } catch {
          // crypto unavailable — leave PLACEHOLDER
        }
      }

      // ── Render & send ─────────────────────────────────────────────────────
      const digestUser: DigestUser = {
        id: u.id,
        display_name: u.display_name,
        email: u.email,
        preferred_language: lang,
        country_code: u.country_code,
      };

      const digestData: DigestData = {
        user: digestUser,
        follower_obs,
        missing_species,
        community_stats,
        rank_delta: null, // not implemented in v1
      };

      // Inject real HMAC token into rendered HTML/text
      const rendered = renderDigest(digestData);
      const finalHtml = rendered.html.replace(/PLACEHOLDER/g, unsubToken);
      const finalText = rendered.text.replace(/PLACEHOLDER/g, unsubToken);

      const result = await sendEmail({
        to: u.email,
        subject: rendered.subject,
        html: finalHtml,
        text: finalText,
      });

      if (result.ok) {
        sent++;
        // Update last_digest_sent_at
        await db
          .from('users')
          .update({ last_digest_sent_at: new Date().toISOString() })
          .eq('id', u.id);
      } else if (!result.skipped) {
        failed++;
        errors.push(`${u.id}: ${result.error}`);
      }
    } catch (e) {
      failed++;
      errors.push(`${u.id}: ${(e as Error).message}`);
      console.error('[weekly-digest] error for user', u.id, e);
    }
  }

  return new Response(
    JSON.stringify({
      total_eligible: targetUsers.length,
      sent,
      failed,
      ...(errors.length > 0 ? { errors } : {}),
    }),
    { headers: { 'content-type': 'application/json' } }
  );
});
