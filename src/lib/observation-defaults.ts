/**
 * observation-defaults.ts
 *
 * Persists the last-used observation form values (habitat, weather, license)
 * to `users.last_observation_defaults` (jsonb) so subsequent opens pre-fill
 * the advanced fields, raising Fogg "ability" at zero UX cost.
 *
 * Privacy: this field is read only by the owning user (existing RLS on
 * `public.users`). It is never served to third parties.
 *
 * Part of #942 PR3/7 — Observation form redesign.
 */

import { getSupabase, getCachedUser } from './supabase';

export interface ObservationDefaults {
  habitat?: string;
  weather?: string;
  licenseCode?: string;
}

/**
 * Read the stored defaults for the current user.
 * Returns `{}` when not authenticated or when the column is empty.
 */
export async function getObservationDefaults(): Promise<ObservationDefaults> {
  try {
    const user = await getCachedUser();
    if (!user) return {};

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('users')
      .select('last_observation_defaults')
      .eq('id', user.id)
      .single();

    if (error || !data?.last_observation_defaults) return {};

    const raw = data.last_observation_defaults as Record<string, unknown>;
    return {
      habitat: typeof raw['habitat'] === 'string' ? raw['habitat'] : undefined,
      weather: typeof raw['weather'] === 'string' ? raw['weather'] : undefined,
      licenseCode: typeof raw['licenseCode'] === 'string' ? raw['licenseCode'] : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Persist a partial set of defaults after a successful save.
 * Only fields with truthy values are written — undefined/empty values
 * are stripped by `jsonb_strip_nulls` server-side via the merge operator `||`.
 *
 * Call this **after** the observation INSERT commits successfully.
 */
export async function setObservationDefaults(
  partial: Partial<ObservationDefaults>,
): Promise<void> {
  try {
    const user = await getCachedUser();
    if (!user) return;

    // Build a partial object — only persist non-empty values.
    const patch: Record<string, string | null> = {};
    if (partial.habitat !== undefined) patch['habitat'] = partial.habitat || null;
    if (partial.weather !== undefined) patch['weather'] = partial.weather || null;
    if (partial.licenseCode !== undefined) patch['licenseCode'] = partial.licenseCode || null;

    // Nothing to write.
    if (Object.keys(patch).length === 0) return;

    const supabase = getSupabase();

    // Use a raw rpc-free approach: jsonb_strip_nulls is applied by the
    // column default + the merge; we pass the partial and let Postgres
    // merge it with the existing jsonb (|| operator) and strip nulls.
    // Since the Supabase JS client doesn't natively expose jsonb merge,
    // we call a raw SQL statement via rpc or use an update with the
    // full merged object fetched first.
    //
    // For simplicity and safety we do a read-merge-write cycle, which
    // is acceptable given this runs only after a save (not in a hot path).
    const { data: existing } = await supabase
      .from('users')
      .select('last_observation_defaults')
      .eq('id', user.id)
      .single();

    const current = (existing?.last_observation_defaults as Record<string, unknown>) ?? {};
    const merged: Record<string, string> = {};

    // Carry forward existing keys.
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === 'string' && v) merged[k] = v;
    }
    // Apply patch (overwrite or delete).
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }

    await supabase
      .from('users')
      .update({ last_observation_defaults: merged })
      .eq('id', user.id);
  } catch {
    // Non-fatal — defaults are a convenience feature, not a correctness
    // requirement. Silently swallow errors.
  }
}
