/**
 * PR14 unit tests for the dispatcher's enforce_two_person_irreversible
 * gate. The function is consumed by supabase/functions/admin/index.ts
 * but the logic is pure — no Deno-only imports — so we exercise it from
 * Vitest the same way audit-export-csv.test.ts and webhook-signature.test.ts do.
 *
 * Coverage targets:
 *   1. Flag off → always allowed.
 *   2. Flag on, op not in IRREVERSIBLE_OPS → allowed.
 *   3. Flag on, op IS in IRREVERSIBLE_OPS, no _via_proposal → forbidden.
 *   4. Flag on, op IS in IRREVERSIBLE_OPS, _via_proposal:true → allowed.
 *   5. _via_proposal must be exactly boolean true (not 'true' string, not truthy).
 *   6. stripViaProposal removes the marker without mutating other keys.
 *   7. Forbidden response includes the documented error code.
 */
import { describe, it, expect } from 'vitest';
import {
  checkIrreversibleEnforcement,
  stripViaProposal,
} from '../../supabase/functions/admin/_shared/irreversible-enforcement';

describe('checkIrreversibleEnforcement', () => {
  describe('flag disabled', () => {
    it('allows direct calls to irreversible ops when flag is off', () => {
      const r = checkIrreversibleEnforcement('user.ban', { target_user_id: 'u' }, false);
      expect(r.allowed).toBe(true);
    });

    it('allows direct calls to non-irreversible ops when flag is off', () => {
      const r = checkIrreversibleEnforcement('observation.unhide', {}, false);
      expect(r.allowed).toBe(true);
    });
  });

  describe('flag enabled', () => {
    it('allows non-irreversible ops', () => {
      expect(checkIrreversibleEnforcement('observation.unhide', {}, true).allowed).toBe(true);
      expect(checkIrreversibleEnforcement('role.grant', { role: 'admin' }, true).allowed).toBe(true);
      expect(checkIrreversibleEnforcement('user.unban', {}, true).allowed).toBe(true);
      expect(checkIrreversibleEnforcement('badge.award_manual', {}, true).allowed).toBe(true);
    });

    it('forbids direct role.revoke', () => {
      const r = checkIrreversibleEnforcement('role.revoke', { target_user_id: 'u' }, true);
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.code).toBe('direct_irreversible_call_forbidden');
        expect(r.reason).toMatch(/role\.revoke/);
        expect(r.reason).toMatch(/proposal\.create/);
      }
    });

    it('forbids direct user.ban', () => {
      const r = checkIrreversibleEnforcement('user.ban', { target_user_id: 'u' }, true);
      expect(r.allowed).toBe(false);
    });

    it('forbids direct observation.hide', () => {
      const r = checkIrreversibleEnforcement('observation.hide', { observation_id: 'o' }, true);
      expect(r.allowed).toBe(false);
    });

    it('forbids direct badge.revoke', () => {
      const r = checkIrreversibleEnforcement('badge.revoke', { badge_key: 'b' }, true);
      expect(r.allowed).toBe(false);
    });

    it('allows when payload._via_proposal is exactly true', () => {
      const r = checkIrreversibleEnforcement(
        'role.revoke',
        { target_user_id: 'u', _via_proposal: true },
        true,
      );
      expect(r.allowed).toBe(true);
    });

    it('still forbids when _via_proposal is a non-boolean truthy value (defense in depth)', () => {
      // We deliberately require boolean true so a tampered string can't slip past.
      const cases: unknown[] = ['true', 1, {}, []];
      for (const v of cases) {
        const r = checkIrreversibleEnforcement(
          'role.revoke',
          { target_user_id: 'u', _via_proposal: v },
          true,
        );
        expect(r.allowed).toBe(false);
      }
    });

    it('still forbids when _via_proposal is missing or false', () => {
      expect(checkIrreversibleEnforcement('user.ban', { _via_proposal: false }, true).allowed).toBe(false);
      expect(checkIrreversibleEnforcement('user.ban', undefined, true).allowed).toBe(false);
    });
  });
});

describe('stripViaProposal', () => {
  it('removes the _via_proposal marker', () => {
    const input = { target_user_id: 'u', role: 'admin', _via_proposal: true };
    const out = stripViaProposal(input) as Record<string, unknown>;
    expect(out._via_proposal).toBeUndefined();
    expect(out.target_user_id).toBe('u');
    expect(out.role).toBe('admin');
  });

  it('is a no-op when the marker is absent', () => {
    const input = { target_user_id: 'u' };
    const out = stripViaProposal(input) as Record<string, unknown>;
    expect(out).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = { x: 1, _via_proposal: true };
    stripViaProposal(input);
    expect((input as Record<string, unknown>)._via_proposal).toBe(true);
  });

  it('passes through non-objects untouched', () => {
    expect(stripViaProposal(null)).toBeNull();
    expect(stripViaProposal(undefined)).toBeUndefined();
    expect(stripViaProposal('a')).toBe('a');
  });
});
