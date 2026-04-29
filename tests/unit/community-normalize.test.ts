/**
 * Tests for `public.normalize_country_code(text)`.
 *
 * The function lives in `docs/specs/infra/supabase-schema.sql` and runs
 * a case-insensitive exact match against `iso_countries.name_en` /
 * `name_es` / `code` first, then a `pg_trgm` similarity > 0.6 fallback.
 *
 * pglite (the lightweight Postgres we use for unit tests in obs-detail
 * PR2) does NOT bundle pg_trgm — `CREATE EXTENSION pg_trgm` errors with
 * "extension is not available". Ditto PostGIS for the same reason.
 *
 * Compromise (matching obs-detail's `material-edit-trigger.test.ts`
 * pattern): this is a JS mirror of the SQL function's branches. It
 * gives us a peer-reviewable spec for the normalizer's behaviour
 * without requiring a real PostgreSQL container in the unit-test loop.
 *
 * The SQL function itself is exercised end-to-end by:
 *   - `db-validate.yml` (Postgres 17 + PostGIS 3.4 + pg_trgm) — applies
 *     the schema twice, asserts idempotency.
 *   - `tests/e2e/community.spec.ts` — Playwright queries the live page
 *     which queries the DB.
 *   - `make db-cron-test` — operator action firing the recompute cron
 *     which calls `normalize_country_code()` per row.
 *
 * If pglite ever ships pg_trgm (tracked upstream), swap this for a real
 * DB-backed test.
 */

import { describe, it, expect } from 'vitest';

interface IsoCountry {
  code: string;
  name_en: string;
  name_es: string;
}

// Mirror of the v1 seed in supabase-schema.sql (Module 28 block).
const ISO_COUNTRIES: ReadonlyArray<IsoCountry> = [
  { code: 'AR', name_en: 'Argentina',           name_es: 'Argentina' },
  { code: 'BO', name_en: 'Bolivia',             name_es: 'Bolivia' },
  { code: 'BR', name_en: 'Brazil',              name_es: 'Brasil' },
  { code: 'CA', name_en: 'Canada',              name_es: 'Canadá' },
  { code: 'CL', name_en: 'Chile',               name_es: 'Chile' },
  { code: 'CO', name_en: 'Colombia',            name_es: 'Colombia' },
  { code: 'CR', name_en: 'Costa Rica',          name_es: 'Costa Rica' },
  { code: 'CU', name_en: 'Cuba',                name_es: 'Cuba' },
  { code: 'DO', name_en: 'Dominican Republic',  name_es: 'República Dominicana' },
  { code: 'EC', name_en: 'Ecuador',             name_es: 'Ecuador' },
  { code: 'SV', name_en: 'El Salvador',         name_es: 'El Salvador' },
  { code: 'GT', name_en: 'Guatemala',           name_es: 'Guatemala' },
  { code: 'HN', name_en: 'Honduras',            name_es: 'Honduras' },
  { code: 'JM', name_en: 'Jamaica',             name_es: 'Jamaica' },
  { code: 'MX', name_en: 'Mexico',              name_es: 'México' },
  { code: 'NI', name_en: 'Nicaragua',           name_es: 'Nicaragua' },
  { code: 'PA', name_en: 'Panama',              name_es: 'Panamá' },
  { code: 'PY', name_en: 'Paraguay',            name_es: 'Paraguay' },
  { code: 'PE', name_en: 'Peru',                name_es: 'Perú' },
  { code: 'PR', name_en: 'Puerto Rico',         name_es: 'Puerto Rico' },
  { code: 'TT', name_en: 'Trinidad and Tobago', name_es: 'Trinidad y Tobago' },
  { code: 'US', name_en: 'United States',       name_es: 'Estados Unidos' },
  { code: 'UY', name_en: 'Uruguay',             name_es: 'Uruguay' },
  { code: 'VE', name_en: 'Venezuela',           name_es: 'Venezuela' },
  { code: 'ES', name_en: 'Spain',               name_es: 'España' },
  { code: 'PT', name_en: 'Portugal',            name_es: 'Portugal' },
  { code: 'FR', name_en: 'France',              name_es: 'Francia' },
  { code: 'DE', name_en: 'Germany',             name_es: 'Alemania' },
  { code: 'IT', name_en: 'Italy',               name_es: 'Italia' },
  { code: 'GB', name_en: 'United Kingdom',      name_es: 'Reino Unido' },
];

/**
 * pg_trgm-style trigram similarity. Postgres' `similarity()` is the
 * Jaccard coefficient of trigram sets; this JS reimplementation
 * matches closely enough for the unit-test threshold (> 0.6) for the
 * inputs we exercise. The reference algorithm:
 *   1. Pad string with two spaces front/back.
 *   2. Generate all 3-character substrings.
 *   3. similarity = |intersection| / |union| of the two trigram sets.
 */
function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase().trim()} `;
  const out = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** JS mirror of the SQL `normalize_country_code(p_input text)` function. */
function normalizeCountryCode(input: string | null | undefined): string | null {
  const q = (input ?? '').toLowerCase().trim();
  if (q === '') return null;

  // Branch 1: exact (case-insensitive) match.
  for (const c of ISO_COUNTRIES) {
    if (
      c.name_en.toLowerCase() === q ||
      c.name_es.toLowerCase() === q ||
      c.code.toLowerCase() === q
    ) {
      return c.code;
    }
  }

  // Branch 2: fuzzy fallback. similarity > 0.6 against either name.
  let best: { code: string; score: number } | null = null;
  for (const c of ISO_COUNTRIES) {
    const score = Math.max(
      similarity(c.name_en, q),
      similarity(c.name_es, q),
    );
    if (score > 0.6 && (best === null || score > best.score)) {
      best = { code: c.code, score };
    }
  }
  return best ? best.code : null;
}

describe('normalize_country_code (JS mirror)', () => {
  describe('Branch 1: exact case-insensitive match', () => {
    it('matches the ISO-3166 code itself', () => {
      expect(normalizeCountryCode('MX')).toBe('MX');
      expect(normalizeCountryCode('mx')).toBe('MX');
      expect(normalizeCountryCode('US')).toBe('US');
    });

    it('matches the English name', () => {
      expect(normalizeCountryCode('Mexico')).toBe('MX');
      expect(normalizeCountryCode('mexico')).toBe('MX');
      expect(normalizeCountryCode('United States')).toBe('US');
      expect(normalizeCountryCode('Brazil')).toBe('BR');
    });

    it('matches the Spanish name', () => {
      expect(normalizeCountryCode('México')).toBe('MX');
      expect(normalizeCountryCode('Estados Unidos')).toBe('US');
      expect(normalizeCountryCode('Brasil')).toBe('BR');
      expect(normalizeCountryCode('España')).toBe('ES');
    });

    it('strips whitespace before matching', () => {
      expect(normalizeCountryCode('  Mexico  ')).toBe('MX');
      expect(normalizeCountryCode(' MX ')).toBe('MX');
    });
  });

  describe('Branch 2: pg_trgm similarity fallback', () => {
    it('matches "México DF" via fuzzy similarity', () => {
      // "méxico df" vs "méxico" — similarity > 0.6 because most
      // trigrams overlap.
      expect(normalizeCountryCode('México DF')).toBe('MX');
    });

    it('matches near-misspellings', () => {
      // "Argentin" vs "Argentina" — most trigrams overlap.
      const result = normalizeCountryCode('Argentin');
      expect(result).toBe('AR');
    });
  });

  describe('Returns NULL on miss', () => {
    it('returns null for gibberish', () => {
      expect(normalizeCountryCode('xyzzy')).toBeNull();
      expect(normalizeCountryCode('not-a-country')).toBeNull();
    });

    it('returns null for empty / whitespace input', () => {
      expect(normalizeCountryCode('')).toBeNull();
      expect(normalizeCountryCode(' ')).toBeNull();
      expect(normalizeCountryCode(null)).toBeNull();
      expect(normalizeCountryCode(undefined)).toBeNull();
    });

    it('returns null for inputs that are too dissimilar', () => {
      // "Atlantis" doesn't share enough trigrams with any seeded
      // country name to clear the 0.6 threshold.
      expect(normalizeCountryCode('Atlantis')).toBeNull();
    });
  });

  describe('Idempotency on already-normalized inputs', () => {
    it('round-trips ISO codes through the normalizer', () => {
      for (const c of ISO_COUNTRIES) {
        expect(normalizeCountryCode(c.code)).toBe(c.code);
      }
    });
  });
});
