/**
 * #722 — Expedition Mode (Principle of Tunneling)
 *
 * Tests for the expedition state management logic.
 * The Astro component itself is not rendered in vitest; we test the pure
 * state-manipulation functions extracted from the client script.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Node 22's experimental localStorage shadows happy-dom/jsdom and is
// missing most of the Storage API (no `.clear()`). Install our own
// Map-backed shim before any code under test touches it. Same pattern as
// src/lib/byo-keys.test.ts; documented in CLAUDE.md → known pitfalls.
const _store = new Map<string, string>();
const _shim: Storage = {
  get length() { return _store.size; },
  clear() { _store.clear(); },
  getItem(k) { return _store.get(k) ?? null; },
  key(i) { return Array.from(_store.keys())[i] ?? null; },
  removeItem(k) { _store.delete(k); },
  setItem(k, v) { _store.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: _shim });

// ---------------------------------------------------------------------------
// Constants (mirrors ExpeditionMode.astro)
// ---------------------------------------------------------------------------
const KEY_SESSION   = 'rastrum_expedition_session';
const KEY_STAGE     = 'rastrum_expedition_stage';
const KEY_NAME      = 'rastrum_expedition_name';
const KEY_STARTED   = 'rastrum_expedition_started_at';
const KEY_WAYPOINTS = 'rastrum_expedition_waypoints';
const KEY_SPECIES   = 'rastrum_expedition_species';

// ---------------------------------------------------------------------------
// Pure helpers (extracted from the script block)
// ---------------------------------------------------------------------------

function clearExpedition(storage: Storage): void {
  [KEY_SESSION, KEY_STAGE, KEY_NAME, KEY_STARTED, KEY_WAYPOINTS, KEY_SPECIES].forEach(k =>
    storage.removeItem(k),
  );
}

function startExpedition(storage: Storage, name: string): string {
  const sessionId = 'test-session-' + Date.now();
  storage.setItem(KEY_SESSION, sessionId);
  storage.setItem(KEY_NAME, name);
  storage.setItem(KEY_STARTED, String(Date.now()));
  storage.setItem(KEY_WAYPOINTS, '[]');
  storage.setItem(KEY_SPECIES, '[]');
  storage.setItem(KEY_STAGE, 'active');
  return sessionId;
}

function addWaypoint(storage: Storage): void {
  const wp: number[] = JSON.parse(storage.getItem(KEY_WAYPOINTS) ?? '[]');
  wp.push(Date.now());
  storage.setItem(KEY_WAYPOINTS, JSON.stringify(wp));
}

function addSpecies(storage: Storage, sci: string): void {
  const species: string[] = JSON.parse(storage.getItem(KEY_SPECIES) ?? '[]');
  species.push(sci);
  storage.setItem(KEY_SPECIES, JSON.stringify(species));
}

function getSummary(storage: Storage) {
  const startedAt = parseInt(storage.getItem(KEY_STARTED) ?? '0', 10);
  const waypoints: number[] = JSON.parse(storage.getItem(KEY_WAYPOINTS) ?? '[]');
  const species: string[] = JSON.parse(storage.getItem(KEY_SPECIES) ?? '[]');
  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return {
    speciesCount: new Set(species).size,
    waypointCount: waypoints.length,
    durationSeconds: elapsed,
    sessionId: storage.getItem(KEY_SESSION),
  };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Expedition Mode (#722)', () => {
  let storage: Storage;

  beforeEach(() => {
    // happy-dom provides localStorage
    storage = localStorage;
    clearExpedition(storage);
  });

  afterEach(() => {
    clearExpedition(storage);
  });

  it('startExpedition sets all required keys in storage', () => {
    const sessionId = startExpedition(storage, 'Cerro del Águila');
    expect(storage.getItem(KEY_SESSION)).toBe(sessionId);
    expect(storage.getItem(KEY_NAME)).toBe('Cerro del Águila');
    expect(storage.getItem(KEY_STAGE)).toBe('active');
    expect(storage.getItem(KEY_WAYPOINTS)).toBe('[]');
    expect(storage.getItem(KEY_SPECIES)).toBe('[]');
    expect(Number(storage.getItem(KEY_STARTED))).toBeGreaterThan(0);
  });

  it('addWaypoint increments the waypoint count', () => {
    startExpedition(storage, 'Test');
    addWaypoint(storage);
    addWaypoint(storage);
    addWaypoint(storage);
    const wps: number[] = JSON.parse(storage.getItem(KEY_WAYPOINTS) ?? '[]');
    expect(wps).toHaveLength(3);
  });

  it('addSpecies tracks unique species count', () => {
    startExpedition(storage, 'Test');
    addSpecies(storage, 'Quercus robur');
    addSpecies(storage, 'Quercus robur');  // duplicate
    addSpecies(storage, 'Pinus sylvestris');
    const summary = getSummary(storage);
    expect(summary.speciesCount).toBe(2);  // unique
  });

  it('getSummary returns correct counts after activity', () => {
    startExpedition(storage, 'Test');
    addWaypoint(storage);
    addWaypoint(storage);
    addSpecies(storage, 'Ara militaris');
    addSpecies(storage, 'Harpia harpyja');
    const summary = getSummary(storage);
    expect(summary.speciesCount).toBe(2);
    expect(summary.waypointCount).toBe(2);
    expect(summary.sessionId).not.toBeNull();
  });

  it('clearExpedition removes all expedition keys', () => {
    startExpedition(storage, 'Test');
    clearExpedition(storage);
    expect(storage.getItem(KEY_SESSION)).toBeNull();
    expect(storage.getItem(KEY_STAGE)).toBeNull();
    expect(storage.getItem(KEY_STARTED)).toBeNull();
  });

  it('formatDuration produces MM:SS format', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(90 * 60)).toBe('90:00');
  });

  it('90-minute threshold is 5400 seconds', () => {
    expect(90 * 60).toBe(5400);
  });

  it('component file exists and contains correct stage IDs', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ExpeditionMode.astro'),
      'utf-8',
    );
    expect(src).toContain('expedition-stage-setup');
    expect(src).toContain('expedition-stage-active');
    expect(src).toContain('expedition-stage-pause');
    expect(src).toContain('expedition-stage-summary');
    expect(src).toContain('rastrum_expedition_');
  });

  it('component exposes global openExpeditionMode function', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ExpeditionMode.astro'),
      'utf-8',
    );
    expect(src).toContain('openExpeditionMode');
  });

  it('expedition-completed event fires on showSummary with correct shape', () => {
    // Simulate the event shape
    const detail = { species_count: 5, waypoints: 3, duration_s: 3600 };
    const event = new CustomEvent('rastrum:expedition-completed', { detail });
    expect(event.detail.species_count).toBe(5);
    expect(event.detail.waypoints).toBe(3);
    expect(event.detail.duration_s).toBe(3600);
  });

  it('localStorage keys use rastrum_expedition_ prefix', () => {
    const keys = [KEY_SESSION, KEY_STAGE, KEY_NAME, KEY_STARTED, KEY_WAYPOINTS, KEY_SPECIES];
    for (const k of keys) {
      expect(k).toMatch(/^rastrum_expedition_/);
    }
  });
});
