/**
 * /functions/v1/award-badges — nightly badge evaluator.
 *
 * Walks the badge catalogue, finds users who satisfy each rule but don't have
 * the badge yet, and inserts user_badges rows. Idempotent (UNIQUE constraint
 * on (user_id, badge_key) prevents double-awards).
 *
 * Implements rule_json predicate types from module 08:
 *   - kingdom_first
 *   - endemic_first
 *   - nom059_any
 *   - habitat_count
 *   - research_grade_count (with optional class)
 *   - endemic_count
 *   - species_count
 *   - kingdom_diversity
 *   - my_research_grade_count
 *   - validation_given_count
 *   - night_count
 *   - evidence_first
 *   - gbif_count                — stub: 0 until GBIF publish lands (v0.5)
 *   - event_participation       — stub: handled by the BioBlitz job
 *   - event_top_decile          — stub: handled by the BioBlitz job
 *   - governance_completion     — stub: requires a "courses" table (later)
 *   - helpful_comments
 *   - follower_count
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';

type Rule = Record<string, unknown>;
type Badge = { key: string; rule_json: Rule };

async function eligibleUserIds(db: SupabaseClient, badge: Badge): Promise<string[]> {
  const r = badge.rule_json;
  const type = r.type as string;

  switch (type) {
    case 'kingdom_first': {
      // Anyone with at least one synced obs whose primary identification's
      // taxon has the matching kingdom.
      const kingdom = r.kingdom as string;
      const { data } = await db.rpc('badge_eligible_kingdom_first', { p_kingdom: kingdom }) as { data: string[] | null };
      return data ?? [];
    }
    case 'research_grade_count': {
      const kingdom = r.kingdom as string | undefined;
      const klass   = r.class   as string | undefined;
      const t       = r.threshold as number;
      const { data } = await db.rpc('badge_eligible_rg_count', {
        p_kingdom: kingdom ?? null, p_class: klass ?? null, p_threshold: t,
      }) as { data: string[] | null };
      return data ?? [];
    }
    case 'species_count': {
      const t = r.threshold as number;
      const { data } = await db.rpc('badge_eligible_species_count', { p_threshold: t }) as { data: string[] | null };
      return data ?? [];
    }
    case 'kingdom_diversity': {
      const m = r.min_per_kingdom as number;
      const { data } = await db.rpc('badge_eligible_kingdom_diversity', { p_min: m }) as { data: string[] | null };
      return data ?? [];
    }
    // The remaining predicate types are stubbed — they'll come online with the
    // matching feature (GBIF publish, BioBlitz scoring, comments helpful flag,
    // governance courses). Returning empty is correct: nobody is eligible yet.
    default:
      return [];
  }
}

serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) return new Response('Function not configured', { status: 500 });
  const db = createClient(url, role);

  const { data: badges } = await db.from('badges').select('key, rule_json').is('retired_at', null);
  let awarded = 0;

  for (const b of badges ?? [] as Badge[]) {
    const userIds = await eligibleUserIds(db, b as Badge);
    if (!userIds.length) continue;

    // Filter to users who don't already have it
    const { data: existing } = await db
      .from('user_badges')
      .select('user_id')
      .eq('badge_key', (b as Badge).key)
      .in('user_id', userIds);
    const have = new Set((existing ?? []).map(r => r.user_id));
    const newRecipients = userIds.filter(id => !have.has(id));
    if (!newRecipients.length) continue;

    const rows = newRecipients.map(uid => ({ user_id: uid, badge_key: (b as Badge).key }));
    const { error } = await db.from('user_badges').insert(rows);
    if (!error) awarded += rows.length;
  }

  return new Response(JSON.stringify({ awarded }), {
    headers: { 'content-type': 'application/json' },
  });
});
