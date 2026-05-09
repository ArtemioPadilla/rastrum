/**
 * Kairos contextual prompts — opt-in toggles for time-sensitive nudges.
 *
 * Spec: docs/specs/modules/33-kairos-prompts.md (#724).
 *
 * v1 ships only `golden_hour`. The cron-fired `kairos-fire` Edge
 * Function reads `kairos_subscriptions` rows where opt_in = true and
 * dispatches one push per subscriber per day at sunset - 15..30 min.
 *
 * The toggle here ALSO subscribes/unsubscribes the device's push manager
 * (via the existing `enableStreakPush` / `disableStreakPush` flow) so a
 * user opting into golden-hour for the first time goes through the same
 * permission prompt and DB upsert as the streak path. Devices already
 * subscribed for streak reminders just flip the kairos row.
 */
import { getSupabase } from './supabase';
import { enableStreakPush, disableStreakPush, type PushSetupResult } from './push';

export type KairosKind = 'golden_hour' | 'lunar_event';

export async function isKairosOptIn(kind: KairosKind): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('kairos_subscriptions')
    .select('opt_in')
    .eq('user_id', user.id)
    .eq('kind', kind)
    .maybeSingle();
  return !!data?.opt_in;
}

/**
 * Turn the kairos prompt on. Ensures a push subscription exists (re-uses
 * the streak-push subscribe flow), then upserts an `opt_in = true` row.
 * Returns the same shape as enableStreakPush so the UI can map the
 * `unsupported` / `permission_blocked` / `vapid_missing` reasons uniformly.
 */
export async function enableKairos(kind: KairosKind): Promise<PushSetupResult> {
  const sub = await enableStreakPush();
  if (!sub.ok) return sub;

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'no_user' };

  const { error } = await supabase
    .from('kairos_subscriptions')
    .upsert(
      {
        user_id: user.id,
        kind,
        opt_in: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,kind' },
    );
  if (error) return { ok: false, reason: 'unknown', message: error.message };
  return { ok: true };
}

/**
 * Flip the kairos row to opt_in = false. Leaves the push subscription
 * itself in place — the user may still want streak reminders.
 */
export async function disableKairos(kind: KairosKind): Promise<PushSetupResult> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'no_user' };

  const { error } = await supabase
    .from('kairos_subscriptions')
    .upsert(
      {
        user_id: user.id,
        kind,
        opt_in: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,kind' },
    );
  if (error) return { ok: false, reason: 'unknown', message: error.message };
  return { ok: true };
}

/**
 * Convenience: tear down the push subscription completely. Used by
 * the "remove device" affordance — flips ALL kairos kinds to opt_in
 * = false and unsubscribes the browser endpoint.
 */
export async function unsubscribeAllPush(): Promise<PushSetupResult> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('kairos_subscriptions')
      .update({ opt_in: false, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
  }
  return await disableStreakPush();
}
