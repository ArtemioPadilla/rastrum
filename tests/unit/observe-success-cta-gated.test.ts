/**
 * #1074 — the "Ver observación" / "View observation" success CTA links to
 * /share/obs/?id=<id>, which reads from Supabase and shows "Observation not
 * found" until the Dexie outbox row reaches the server (~25 s). The CTA must
 * therefore be gated on the existing sync-row-done event (the same signal
 * the SyncPill consumes) rather than rendered as an immediate dead-link.
 *
 * Source-assertion test (mirrors home-widgets-wired.test.ts) — the logic is
 * DOM/event wiring inside an Astro client script, not a pure unit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('observe success CTA is sync-gated (#1074)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/ObserveView2.astro'),
    'utf8',
  );

  it('listens for the sync-row-done event before enabling the CTA', () => {
    expect(src).toMatch(/SYNC_EVENTS\.rowDone/);
    expect(src).toMatch(/addEventListener\(SYNC_EVENTS\.rowDone/);
  });

  it('renders a syncing placeholder before the row syncs', () => {
    expect(src).toMatch(/Sincronizando\\u2026/);
    expect(src).toMatch(/Syncing\\u2026/);
  });

  it('checks Dexie sync_status so an already-synced row resolves immediately', () => {
    expect(src).toMatch(/getDB\(\)\.observations\.get\(obsId\)/);
    expect(src).toMatch(/rec\.sync_status === 'synced'/);
  });
});
