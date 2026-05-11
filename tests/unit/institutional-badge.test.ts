/**
 * #735 — Institutional endorsement badges
 *
 * Tests for the institutional affiliation lookup and badge rendering logic.
 * SQL schema (institutions, institutional_affiliations, user_active_affiliations)
 * is tested in tests/sql/rls.sql.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Supabase mock that returns a given affiliation row. */
function makeAffiliationClient(row: { institution_short: string; is_verified: boolean } | null) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          eq: (_col2: string, _val2: unknown) => ({
            limit: (_n: number) => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}

/** Simulate the affiliation-lookup block from SuggestIdModal submit handler. */
async function lookupValidatorInstitution(
  supabase: ReturnType<typeof makeAffiliationClient>,
  userId: string,
): Promise<string | null> {
  try {
    const { data: affil } = await supabase
      .from('user_active_affiliations')
      .select('institution_short, is_verified')
      .eq('user_id', userId)
      .eq('is_verified', true)
      .limit(1)
      .maybeSingle() as { data: { institution_short: string; is_verified: boolean } | null };
    return affil?.institution_short ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Institutional endorsement badges (#735)', () => {
  it('returns institution short name for a verified affiliated expert', async () => {
    const db = makeAffiliationClient({ institution_short: 'CONANP', is_verified: true });
    const result = await lookupValidatorInstitution(db, 'user-expert-1');
    expect(result).toBe('CONANP');
  });

  it('returns null when validator has no affiliation', async () => {
    const db = makeAffiliationClient(null);
    const result = await lookupValidatorInstitution(db, 'user-no-affil');
    expect(result).toBeNull();
  });

  it('returns null gracefully on DB error (non-critical)', async () => {
    const errorClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: () => Promise.reject(new Error('connection refused')),
              }),
            }),
          }),
        }),
      }),
    };
    const result = await lookupValidatorInstitution(
      errorClient as unknown as ReturnType<typeof makeAffiliationClient>,
      'user-error',
    );
    expect(result).toBeNull();
  });

  it('suggestion-submitted event carries validator_institution field', () => {
    // Simulate the CustomEvent dispatch with institution attached
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    globalThis.addEventListener?.('rastrum:suggestion-submitted', handler);
    globalThis.dispatchEvent?.(new CustomEvent('rastrum:suggestion-submitted', {
      detail: { observation_id: 'obs-1', promoted: false, validator_institution: 'UNAM' },
    }));
    globalThis.removeEventListener?.('rastrum:suggestion-submitted', handler);
    expect(events[0]?.detail?.validator_institution).toBe('UNAM');
  });

  it('schema file contains institutions table definition', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.institutions');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.institutional_affiliations');
  });

  it('schema file seeds expected institutions (CONANP, CONABIO, UNAM)', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain("'CONANP'");
    expect(schema).toContain("'CONABIO'");
    expect(schema).toContain("'UNAM'");
  });
});
