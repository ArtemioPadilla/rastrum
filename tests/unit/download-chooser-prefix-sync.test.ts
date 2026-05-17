/**
 * #1127 hardening guard.
 *
 * `DownloadChooser.astro`'s "Download selected" clicks the EXISTING
 * registry download control by id (`#${prefix}-download`). The prefix
 * map lives inline in the Astro <script>; the authoritative
 * registry-id → prefix contract is `ON_DEVICE_DL_PREFIX` in
 * `identifier-card-html.ts` (plus `pmtiles` for the offline-map
 * local-data card). If the two ever drift, the chooser silently
 * no-ops (it's intentionally fail-soft), so a human would never see
 * an error — only "nothing downloaded". This test fails the build
 * instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ON_DEVICE_DL_PREFIX } from '../../src/lib/identifier-card-html';
import { CAPABILITY_CATALOG } from '../../src/lib/download-capabilities';

const here = dirname(fileURLToPath(import.meta.url));
const chooserSrc = readFileSync(
  resolve(here, '../../src/components/DownloadChooser.astro'),
  'utf8',
);

/** Pull the `prefixByTarget` object literal out of the .astro <script> as a plain map. */
function parsePrefixByTarget(src: string): Record<string, string> {
  const m = src.match(/prefixByTarget[^=]*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error('prefixByTarget literal not found in DownloadChooser.astro');
  const map: Record<string, string> = {};
  for (const pair of m[1].matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"]([\w-]+)['"]/g)) {
    map[pair[1]] = pair[2];
  }
  return map;
}

describe('DownloadChooser prefix map ↔ identifier-card-html contract', () => {
  const prefixByTarget = parsePrefixByTarget(chooserSrc);

  it('extracts a non-empty prefix map from the chooser', () => {
    expect(Object.keys(prefixByTarget).length).toBeGreaterThan(0);
  });

  it('every on-device target prefix matches ON_DEVICE_DL_PREFIX exactly', () => {
    for (const [target, prefix] of Object.entries(prefixByTarget)) {
      if (target === 'offline-map') continue; // local-data card, asserted below
      expect(
        ON_DEVICE_DL_PREFIX[target],
        `prefixByTarget['${target}']='${prefix}' but identifier-card-html maps it to '${ON_DEVICE_DL_PREFIX[target]}'`,
      ).toBe(prefix);
    }
  });

  it("offline-map routes to the pmtiles local-data card", () => {
    expect(prefixByTarget['offline-map']).toBe('pmtiles');
  });

  it('every catalog item with an on-device/offline target is covered by the chooser map', () => {
    for (const item of CAPABILITY_CATALOG) {
      // The chooser only needs a prefix for items it can actually trigger.
      if (item.target === 'offline-map' || item.target in ON_DEVICE_DL_PREFIX) {
        expect(
          prefixByTarget[item.target],
          `catalog item '${item.id}' (target '${item.target}') has no entry in DownloadChooser.prefixByTarget`,
        ).toBeTruthy();
      }
    }
  });
});
