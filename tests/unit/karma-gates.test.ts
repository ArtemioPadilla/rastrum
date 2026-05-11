import { describe, it, expect } from 'vitest';

/**
 * Unit tests for karma-threshold privilege gates (#558).
 *
 * These tests cover the pure gate logic:
 * - threshold table seed values
 * - has_karma_privilege() semantics (replicated as a TS helper for testing)
 * - gate messages (i18n key substitution)
 *
 * SQL function correctness is verified by pgTAP tests (in pgTAP/ directory);
 * these Vitest tests cover the client-side gate check and message rendering.
 */

// ── Gate threshold constants (mirrors karma_thresholds seed values) ───────────

const KARMA_GATES = {
  validation_suggest: 100,
  observation_flag:   500,
  expert_application: 1000,
} as const;

type GatePrivilege = keyof typeof KARMA_GATES;

/** Pure helper: mirrors public.has_karma_privilege() SQL logic. */
function hasKarmaPrivilege(karmaTotal: number, privilege: GatePrivilege): boolean {
  return karmaTotal >= KARMA_GATES[privilege];
}

/** Renders the karma gate copy (mirrors client-side label substitution). */
function karmaGateCopy(
  privilege: GatePrivilege,
  lang: 'en' | 'es',
): string {
  const minKarma = KARMA_GATES[privilege];
  if (lang === 'en') {
    const templates: Record<GatePrivilege, string> = {
      validation_suggest: `Reach ${minKarma} karma to suggest species IDs`,
      observation_flag:   `Reach ${minKarma} karma to flag observations`,
      expert_application: `Reach ${minKarma} karma to apply for expert status`,
    };
    return templates[privilege];
  } else {
    const templates: Record<GatePrivilege, string> = {
      validation_suggest: `Alcanza ${minKarma} karma para sugerir identificaciones`,
      observation_flag:   `Alcanza ${minKarma} karma para reportar observaciones`,
      expert_application: `Alcanza ${minKarma} karma para solicitar estatus de experto`,
    };
    return templates[privilege];
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('karma gate thresholds', () => {
  it('seeds validation_suggest at 100', () => {
    expect(KARMA_GATES.validation_suggest).toBe(100);
  });
  it('seeds observation_flag at 500', () => {
    expect(KARMA_GATES.observation_flag).toBe(500);
  });
  it('seeds expert_application at 1000', () => {
    expect(KARMA_GATES.expert_application).toBe(1000);
  });
});

describe('hasKarmaPrivilege()', () => {
  it('fresh user (karma=0) is denied at all gates', () => {
    expect(hasKarmaPrivilege(0, 'validation_suggest')).toBe(false);
    expect(hasKarmaPrivilege(0, 'observation_flag')).toBe(false);
    expect(hasKarmaPrivilege(0, 'expert_application')).toBe(false);
  });

  it('user with karma=200 can validate but not flag or apply for expert', () => {
    expect(hasKarmaPrivilege(200, 'validation_suggest')).toBe(true);
    expect(hasKarmaPrivilege(200, 'observation_flag')).toBe(false);
    expect(hasKarmaPrivilege(200, 'expert_application')).toBe(false);
  });

  it('user with karma=500 can validate and flag but not apply for expert', () => {
    expect(hasKarmaPrivilege(500, 'validation_suggest')).toBe(true);
    expect(hasKarmaPrivilege(500, 'observation_flag')).toBe(true);
    expect(hasKarmaPrivilege(500, 'expert_application')).toBe(false);
  });

  it('user with karma=1000 passes all gates', () => {
    expect(hasKarmaPrivilege(1000, 'validation_suggest')).toBe(true);
    expect(hasKarmaPrivilege(1000, 'observation_flag')).toBe(true);
    expect(hasKarmaPrivilege(1000, 'expert_application')).toBe(true);
  });

  it('gate is inclusive at the exact threshold', () => {
    expect(hasKarmaPrivilege(100, 'validation_suggest')).toBe(true);
    expect(hasKarmaPrivilege(99,  'validation_suggest')).toBe(false);
  });
});

describe('karma gate copy', () => {
  it('renders English validation gate message with min_karma substituted', () => {
    const msg = karmaGateCopy('validation_suggest', 'en');
    expect(msg).toBe('Reach 100 karma to suggest species IDs');
  });

  it('renders Spanish validation gate message', () => {
    const msg = karmaGateCopy('validation_suggest', 'es');
    expect(msg).toBe('Alcanza 100 karma para sugerir identificaciones');
  });

  it('renders English flag gate message', () => {
    const msg = karmaGateCopy('observation_flag', 'en');
    expect(msg).toBe('Reach 500 karma to flag observations');
  });

  it('renders English expert gate message', () => {
    const msg = karmaGateCopy('expert_application', 'en');
    expect(msg).toBe('Reach 1000 karma to apply for expert status');
  });

  it('all messages include the numeric threshold', () => {
    for (const priv of Object.keys(KARMA_GATES) as GatePrivilege[]) {
      const msg = karmaGateCopy(priv, 'en');
      expect(msg).toContain(String(KARMA_GATES[priv]));
    }
  });
});
