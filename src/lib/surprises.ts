/**
 * Sorpresas de campo — transparent, opt-in variable rewards.
 *
 * Closes #727. Per Fogg ch. 9 ethics: variable reinforcement is a red
 * flag UNLESS the user knows the rules and can opt out in one click.
 * This module enforces both: the catalog of `surprise.kind` is FIXED
 * (no runtime extension), the rules are documented at /docs/surprises,
 * the toggle defaults OFF, and the picker is a pure function so the
 * rules are auditable in tests.
 *
 * v1 catalog (3 kinds):
 *
 *   - dato_curioso          random, ~10% per synced obs (one fact card)
 *   - rarito                deterministic, fires when the obs's primary
 *                           taxon is `taxon_rarity.bucket = 'rare'`
 *   - comunidad_activa_hoy  deterministic, max 1×/day; "you were 1 of N
 *                           active observers in {region} today"
 *
 * Hard cap: 1 surprise / day total across kinds (regardless of which
 * one fired). Tracked in localStorage + the DB row, so a tab close
 * won't suddenly unlock a second surprise.
 *
 * Privacy: the row in `surprise_events` is read-own RLS. The same
 * 1/day rule is enforced at the SQL layer via record_surprise_event()
 * so racing tabs can't beat the cap.
 */

export const SURPRISE_KINDS = [
  'dato_curioso',
  'rarito',
  'comunidad_activa_hoy',
] as const;

export type SurpriseKind = (typeof SURPRISE_KINDS)[number];

export interface SurprisePayload {
  /** Free-form per-kind payload. Bounded to ~1 KB after JSON.stringify. */
  [k: string]: unknown;
}

export interface SurpriseCandidate {
  kind: SurpriseKind;
  payload: SurprisePayload;
  /** Human-readable, locale-resolved title shown in the overlay header. */
  title: string;
  /** Human-readable body. May contain {placeholders}. */
  body: string;
}

/**
 * Probability that `dato_curioso` fires after each synced observation.
 * Documented at /docs/surprises — changing this requires updating both
 * docs pages so the rules stay honest.
 */
export const DATO_CURIOSO_PROBABILITY = 0.1;

/**
 * Cap surprises at 1/day across kinds. Surface in the docs page too.
 */
export const MAX_SURPRISES_PER_DAY = 1;

const TODAY_KEY = 'rastrum.surprises.today';

/**
 * Mulberry32 PRNG. Seeded so tests are deterministic. We don't need
 * cryptographic strength for surprise selection — just reproducible
 * jitter across sessions. Not exported as a class because we want
 * the seed to be explicit at every call site (audit trail in tests).
 */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to a 32-bit seed. djb2; deterministic across runs.
 */
export function hashSeed(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Date key used for the daily cap. ISO yyyy-mm-dd in the user's local
 * timezone — surprises are a "field-trip moment" not a server-clock
 * thing, so local-day matches user expectations.
 */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DailyState {
  date: string;
  count: number;
  kinds: SurpriseKind[];
}

export function readDailyState(now: Date = new Date()): DailyState {
  if (typeof localStorage === 'undefined') {
    return { date: todayKey(now), count: 0, kinds: [] };
  }
  try {
    const raw = localStorage.getItem(TODAY_KEY);
    if (!raw) return { date: todayKey(now), count: 0, kinds: [] };
    const parsed = JSON.parse(raw) as DailyState;
    if (parsed.date !== todayKey(now)) {
      return { date: todayKey(now), count: 0, kinds: [] };
    }
    return parsed;
  } catch {
    return { date: todayKey(now), count: 0, kinds: [] };
  }
}

export function writeDailyState(state: DailyState): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(TODAY_KEY, JSON.stringify(state)); }
  catch { /* full storage — fine */ }
}

export function dailyCapReached(now: Date = new Date()): boolean {
  return readDailyState(now).count >= MAX_SURPRISES_PER_DAY;
}

export function recordShown(kind: SurpriseKind, now: Date = new Date()): void {
  const state = readDailyState(now);
  state.count += 1;
  state.kinds.push(kind);
  writeDailyState(state);
}

/**
 * Inputs the picker needs to evaluate the catalog. All optional —
 * missing data just means that kind can't fire (deterministic
 * exclusion, never a silent random failure).
 */
export interface PickInputs {
  /** Used to seed the RNG for `dato_curioso`. Typically observation_id. */
  seed: string;
  /** When the obs's primary taxon is in `taxon_rarity` bucket 'rare'. */
  rarityBucket?: 'common' | 'uncommon' | 'rare' | null;
  /** Resolved fact for `dato_curioso` — null when none was found. */
  factEs?: string | null;
  factEn?: string | null;
  scientificName?: string | null;
  commonNameEs?: string | null;
  commonNameEn?: string | null;
  /**
   * Active-observers count for the user's region today, paired with the
   * region label (e.g. 'México', 'Oaxaca'). Both required to fire
   * `comunidad_activa_hoy`.
   */
  activeObserversToday?: number | null;
  regionLabel?: string | null;
}

/**
 * Pure picker — given the inputs, return the candidate to show, or
 * null when no kind is eligible. Order:
 *
 *   1. `rarito` — deterministic; takes precedence when the species is rare
 *      (it's the most informative + most rare → highest signal).
 *   2. `comunidad_activa_hoy` — deterministic; only when activeObserversToday
 *      ≥ 2 (so the user really is "1 of N" with N ≥ 2).
 *   3. `dato_curioso` — random; fires with 10% probability and only
 *      when a fact is available for the locale.
 *
 * Daily cap is enforced by the caller; this function is pure and
 * doesn't read any side-channel. All decisions are visible to tests.
 */
export function pickSurprise(
  inputs: PickInputs,
  lang: 'en' | 'es',
): SurpriseCandidate | null {
  const speciesLabel = inputs[lang === 'es' ? 'commonNameEs' : 'commonNameEn']
    ?? inputs.scientificName
    ?? null;

  // 1) rarito — deterministic
  if (inputs.rarityBucket === 'rare') {
    const title = lang === 'es' ? '¡Rarito!' : 'Rare find!';
    const body = lang === 'es'
      ? speciesLabel
        ? `Tu observación de ${speciesLabel} cayó en el 5 % más raro de Rastrum.`
        : 'Tu observación cayó en el 5 % más raro de Rastrum.'
      : speciesLabel
        ? `Your observation of ${speciesLabel} is in the rarest 5 % on Rastrum.`
        : 'Your observation is in the rarest 5 % on Rastrum.';
    return {
      kind: 'rarito',
      payload: {
        scientific_name: inputs.scientificName ?? null,
        rarity_bucket: inputs.rarityBucket,
      },
      title, body,
    };
  }

  // 2) comunidad_activa_hoy — deterministic, needs 2+ observers
  const n = inputs.activeObserversToday ?? 0;
  if (n >= 2 && inputs.regionLabel) {
    const title = lang === 'es' ? 'Comunidad activa hoy' : 'Community active today';
    const body = lang === 'es'
      ? `Fuiste 1 de ${n} observadores activos hoy en ${inputs.regionLabel}.`
      : `You were 1 of ${n} active observers today in ${inputs.regionLabel}.`;
    return {
      kind: 'comunidad_activa_hoy',
      payload: { count: n, region: inputs.regionLabel },
      title, body,
    };
  }

  // 3) dato_curioso — random, requires a fact
  const fact = lang === 'es' ? inputs.factEs : inputs.factEn;
  if (fact) {
    const rng = makeRng(hashSeed(inputs.seed));
    const r = rng();
    if (r < DATO_CURIOSO_PROBABILITY) {
      const title = lang === 'es' ? 'Dato curioso' : 'Did you know?';
      return {
        kind: 'dato_curioso',
        payload: {
          scientific_name: inputs.scientificName ?? null,
          fact,
        },
        title,
        body: fact,
      };
    }
  }

  return null;
}

/**
 * Probability check used by the trigger to skip the DB roundtrip when
 * the random gate already says "no". Same RNG/seed the picker uses;
 * keep them in sync.
 */
export function gateRoll(seed: string): boolean {
  const rng = makeRng(hashSeed(seed));
  return rng() < DATO_CURIOSO_PROBABILITY;
}
