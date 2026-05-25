/**
 * Unit tests for PBI 4.1 — rich anon empty states on /profile/ and /console/.
 *
 * Both surfaces previously rendered a 2-line "Sign in" message that left most
 * of the viewport empty. The fix adds a hero block, a Falta-dex preview grid
 * (profile) or a "what's here" list (console), and a sign-in CTA — wired
 * through new `profile.anon.*` and `console.anon.*` i18n namespaces.
 *
 * We pin the contract via source-string assertion (the Astro <script> tags
 * are not directly importable in vitest) and JSON-parse the i18n files to
 * verify EN/ES parity on the new keys.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROFILE_VIEW = readFileSync(
  resolve(process.cwd(), 'src/components/ProfileView.astro'),
  'utf-8',
);

const CONSOLE_ANON_VIEW = readFileSync(
  resolve(process.cwd(), 'src/components/ConsoleAnonView.astro'),
  'utf-8',
);

const EN_CONSOLE_PAGE = readFileSync(
  resolve(process.cwd(), 'src/pages/en/console/index.astro'),
  'utf-8',
);

const ES_CONSOLE_PAGE = readFileSync(
  resolve(process.cwd(), 'src/pages/es/consola/index.astro'),
  'utf-8',
);

const EN_JSON = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/i18n/en.json'), 'utf-8'),
) as { profile: { anon: Record<string, string> }; console: { anon: Record<string, string> } };

const ES_JSON = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/i18n/es.json'), 'utf-8'),
) as { profile: { anon: Record<string, string> }; console: { anon: Record<string, string> } };

describe('ProfileView anon empty state — source contract', () => {
  it('extracts the profile.anon namespace into a local const', () => {
    expect(PROFILE_VIEW).toMatch(/const anon\s*=\s*\(tr[^)]+\)\.profile\.anon/);
  });

  it('references all six profile.anon keys', () => {
    expect(PROFILE_VIEW).toContain('anon.title');
    expect(PROFILE_VIEW).toContain('anon.subtitle');
    expect(PROFILE_VIEW).toContain('anon.preview_label');
    expect(PROFILE_VIEW).toContain('anon.cta_primary');
    expect(PROFILE_VIEW).toContain('anon.feature_observations');
    expect(PROFILE_VIEW).toContain('anon.feature_badges');
    expect(PROFILE_VIEW).toContain('anon.feature_streak');
    expect(PROFILE_VIEW).toContain('anon.feature_watchlist');
  });

  it('builds a 24-tile Falta-dex preview grid', () => {
    expect(PROFILE_VIEW).toMatch(/length:\s*24/);
    expect(PROFILE_VIEW).toMatch(/previewTiles\.map/);
    // Tailwind responsive grid + aspect-square tiles
    expect(PROFILE_VIEW).toMatch(/grid-cols-4 sm:grid-cols-6/);
    expect(PROFILE_VIEW).toMatch(/aspect-square/);
  });

  it('still renders the signed-in branch (no regression)', () => {
    expect(PROFILE_VIEW).toContain('id="signed-in"');
    expect(PROFILE_VIEW).toMatch(/<ProfileObservationMap/);
    expect(PROFILE_VIEW).toMatch(/<ProfileBadgesGrid/);
  });

  it('preserves the signed-out toggle id used by the hydrate script', () => {
    expect(PROFILE_VIEW).toContain('id="signed-out"');
    expect(PROFILE_VIEW).toMatch(/signedOut\?\.classList\.remove\('hidden'\)/);
  });
});

describe('ConsoleAnonView — source contract', () => {
  it('extracts the console.anon namespace into a local const', () => {
    expect(CONSOLE_ANON_VIEW).toMatch(/const anon\s*=\s*\(tr[^)]+\)\.console\.anon/);
  });

  it('references the console.anon hero + 6 feature keys', () => {
    expect(CONSOLE_ANON_VIEW).toContain('anon.title');
    expect(CONSOLE_ANON_VIEW).toContain('anon.subtitle');
    expect(CONSOLE_ANON_VIEW).toContain('anon.not_public_note');
    expect(CONSOLE_ANON_VIEW).toContain('anon.whats_here_heading');
    expect(CONSOLE_ANON_VIEW).toContain('anon.feature_validation');
    expect(CONSOLE_ANON_VIEW).toContain('anon.feature_flags');
    expect(CONSOLE_ANON_VIEW).toContain('anon.feature_audit');
    expect(CONSOLE_ANON_VIEW).toContain('anon.feature_anomalies');
    expect(CONSOLE_ANON_VIEW).toContain('anon.feature_users');
    expect(CONSOLE_ANON_VIEW).toContain('anon.feature_health');
    expect(CONSOLE_ANON_VIEW).toContain('anon.cta_signin');
  });
});

describe('Console index pages — anon block wiring', () => {
  it('EN page imports ConsoleAnonView + renders #console-anon', () => {
    expect(EN_CONSOLE_PAGE).toContain("import ConsoleAnonView from '../../../components/ConsoleAnonView.astro'");
    expect(EN_CONSOLE_PAGE).toContain('id="console-anon"');
    expect(EN_CONSOLE_PAGE).toMatch(/<ConsoleAnonView lang=\{lang\}/);
  });

  it('ES page imports ConsoleAnonView + renders #console-anon', () => {
    expect(ES_CONSOLE_PAGE).toContain("import ConsoleAnonView from '../../../components/ConsoleAnonView.astro'");
    expect(ES_CONSOLE_PAGE).toContain('id="console-anon"');
    expect(ES_CONSOLE_PAGE).toMatch(/<ConsoleAnonView lang=\{lang\}/);
  });

  it('hydrate script reveals the anon block (not the gate textContent) for unauth visitors', () => {
    for (const src of [EN_CONSOLE_PAGE, ES_CONSOLE_PAGE]) {
      expect(src).toMatch(/anonBlock\.classList\.remove\('hidden'\)/);
    }
  });
});

describe('i18n parity — profile.anon', () => {
  const REQUIRED_KEYS = [
    'title',
    'subtitle',
    'preview_label',
    'preview_hint',
    'feature_observations',
    'feature_badges',
    'feature_streak',
    'feature_watchlist',
    'cta_primary',
    'cta_secondary',
  ];

  it('EN has all required profile.anon keys', () => {
    for (const k of REQUIRED_KEYS) {
      expect(EN_JSON.profile.anon[k], `EN missing profile.anon.${k}`).toBeTruthy();
    }
  });

  it('ES has all required profile.anon keys', () => {
    for (const k of REQUIRED_KEYS) {
      expect(ES_JSON.profile.anon[k], `ES missing profile.anon.${k}`).toBeTruthy();
    }
  });

  it('EN+ES profile.anon keysets are identical', () => {
    expect(Object.keys(EN_JSON.profile.anon).sort()).toEqual(
      Object.keys(ES_JSON.profile.anon).sort(),
    );
  });

  it('EN profile.anon.title matches the roadmap copy', () => {
    expect(EN_JSON.profile.anon.title).toBe('Your biodiversity profile awaits');
    expect(ES_JSON.profile.anon.title).toBe('Tu perfil de biodiversidad te espera');
  });
});

describe('i18n parity — console.anon', () => {
  const REQUIRED_KEYS = [
    'title',
    'subtitle',
    'not_public_note',
    'whats_here_heading',
    'feature_validation',
    'feature_flags',
    'feature_audit',
    'feature_anomalies',
    'feature_users',
    'feature_health',
    'cta_signin',
    'cta_public',
  ];

  it('EN has all required console.anon keys', () => {
    for (const k of REQUIRED_KEYS) {
      expect(EN_JSON.console.anon[k], `EN missing console.anon.${k}`).toBeTruthy();
    }
  });

  it('ES has all required console.anon keys', () => {
    for (const k of REQUIRED_KEYS) {
      expect(ES_JSON.console.anon[k], `ES missing console.anon.${k}`).toBeTruthy();
    }
  });

  it('EN+ES console.anon keysets are identical', () => {
    expect(Object.keys(EN_JSON.console.anon).sort()).toEqual(
      Object.keys(ES_JSON.console.anon).sort(),
    );
  });

  it('EN+ES console.anon.title carries the moderator/admin framing', () => {
    expect(EN_JSON.console.anon.title).toMatch(/moderators?.*admins?/i);
    expect(ES_JSON.console.anon.title).toMatch(/moderadores?.*admins?/i);
  });
});
