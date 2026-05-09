import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  pickSurprise,
  makeRng,
  hashSeed,
  todayKey,
  readDailyState,
  writeDailyState,
  recordShown,
  dailyCapReached,
  gateRoll,
  DATO_CURIOSO_PROBABILITY,
  MAX_SURPRISES_PER_DAY,
  SURPRISE_KINDS,
  type PickInputs,
} from '../../src/lib/surprises';

// ---------------------------------------------------------------------------
// localStorage shim — Node 22 ships a half-baked one that breaks happy-dom
// (see CLAUDE.md "Vitest: localStorage.clear is not a function").
// ---------------------------------------------------------------------------
const store = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', fakeLocalStorage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SURPRISE_KINDS catalog', () => {
  it('is exactly the 3 v1 kinds, in fixed order', () => {
    expect(SURPRISE_KINDS).toEqual([
      'dato_curioso',
      'rarito',
      'comunidad_activa_hoy',
    ]);
  });

  it('uses constants for the daily cap and the dato_curioso probability', () => {
    expect(MAX_SURPRISES_PER_DAY).toBe(1);
    expect(DATO_CURIOSO_PROBABILITY).toBeCloseTo(0.1, 6);
  });
});

describe('makeRng / hashSeed', () => {
  it('makeRng is deterministic for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('makeRng produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a()).not.toEqual(b());
  });

  it('hashSeed is deterministic', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });

  it('produces uniform-ish output (sanity check, not a stats test)', () => {
    const rng = makeRng(hashSeed('seed'));
    const samples = Array.from({ length: 1000 }, () => rng());
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(1);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    // Mean should be roughly 0.5 ± 0.05 with 1k samples
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });
});

describe('gateRoll', () => {
  it('returns the same boolean for the same seed', () => {
    expect(gateRoll('obs-123')).toBe(gateRoll('obs-123'));
  });

  it('roughly hits the documented probability over many seeds', () => {
    let hits = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (gateRoll(`obs-${i}`)) hits++;
    }
    const ratio = hits / N;
    // Wide tolerance: 5–15 % covers RNG variance comfortably
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });
});

describe('todayKey / daily state', () => {
  it('todayKey is yyyy-mm-dd', () => {
    const k = todayKey(new Date(2026, 4, 7)); // 2026-05-07
    expect(k).toBe('2026-05-07');
  });

  it('readDailyState returns zeros when localStorage is empty', () => {
    expect(readDailyState()).toEqual({
      date: todayKey(),
      count: 0,
      kinds: [],
    });
  });

  it('writeDailyState + readDailyState round-trip', () => {
    writeDailyState({ date: todayKey(), count: 1, kinds: ['rarito'] });
    expect(readDailyState()).toEqual({
      date: todayKey(),
      count: 1,
      kinds: ['rarito'],
    });
  });

  it('readDailyState resets when the stored date is from a previous day', () => {
    const yesterday = '2025-01-01';
    writeDailyState({ date: yesterday, count: 5, kinds: ['rarito'] });
    const fresh = readDailyState();
    expect(fresh.date).toBe(todayKey());
    expect(fresh.count).toBe(0);
  });

  it('recordShown increments the count and remembers the kind', () => {
    recordShown('rarito');
    expect(readDailyState().count).toBe(1);
    expect(readDailyState().kinds).toEqual(['rarito']);
  });

  it('dailyCapReached respects the cap', () => {
    expect(dailyCapReached()).toBe(false);
    recordShown('dato_curioso');
    expect(dailyCapReached()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure picker — the load-bearing audit of the rules. Order matters:
//   rarito > comunidad_activa_hoy > dato_curioso.
// Each kind's preconditions are deterministic.
// ---------------------------------------------------------------------------

const baseInputs: PickInputs = {
  seed: 'obs-deterministic',
  rarityBucket: null,
  factEs: null,
  factEn: null,
  scientificName: null,
  commonNameEs: null,
  commonNameEn: null,
  activeObserversToday: null,
  regionLabel: null,
};

describe('pickSurprise', () => {
  it('returns null when no kind is eligible', () => {
    expect(pickSurprise(baseInputs, 'es')).toBeNull();
    expect(pickSurprise(baseInputs, 'en')).toBeNull();
  });

  it('rarito wins when rarity_bucket === "rare", regardless of other inputs', () => {
    const inputs: PickInputs = {
      ...baseInputs,
      rarityBucket: 'rare',
      scientificName: 'Panthera onca',
      commonNameEs: 'Jaguar',
      commonNameEn: 'Jaguar',
      activeObserversToday: 100,
      regionLabel: 'México',
      factEs: 'fact es',
      factEn: 'fact en',
    };
    const c = pickSurprise(inputs, 'es');
    expect(c?.kind).toBe('rarito');
    expect(c?.body).toMatch(/Jaguar/);
    expect(c?.body).toMatch(/5 %/);
  });

  it('rarito does NOT fire when bucket is uncommon or common', () => {
    const inputs: PickInputs = { ...baseInputs, rarityBucket: 'uncommon' };
    expect(pickSurprise(inputs, 'es')).toBeNull();
    const inputs2: PickInputs = { ...baseInputs, rarityBucket: 'common' };
    expect(pickSurprise(inputs2, 'es')).toBeNull();
  });

  it('comunidad_activa_hoy fires when activeObserversToday >= 2 and a regionLabel exists', () => {
    const inputs: PickInputs = {
      ...baseInputs,
      activeObserversToday: 14,
      regionLabel: 'Oaxaca',
    };
    const c = pickSurprise(inputs, 'es');
    expect(c?.kind).toBe('comunidad_activa_hoy');
    expect(c?.body).toMatch(/14/);
    expect(c?.body).toMatch(/Oaxaca/);
  });

  it('comunidad_activa_hoy needs at least 2 observers — 1 observer (just the user) does not fire', () => {
    const inputs: PickInputs = {
      ...baseInputs,
      activeObserversToday: 1,
      regionLabel: 'México',
    };
    expect(pickSurprise(inputs, 'es')).toBeNull();
  });

  it('comunidad_activa_hoy needs a region label', () => {
    const inputs: PickInputs = {
      ...baseInputs,
      activeObserversToday: 50,
      regionLabel: null,
    };
    expect(pickSurprise(inputs, 'es')).toBeNull();
  });

  it('dato_curioso fires deterministically when its seed gate passes and a fact is available', () => {
    // Find a seed whose first RNG draw is < 0.1 — borrow the gateRoll helper.
    let seed = '';
    for (let i = 0; i < 1000; i++) {
      const candidate = `seed-${i}`;
      if (gateRoll(candidate)) { seed = candidate; break; }
    }
    expect(seed).not.toBe('');
    const inputs: PickInputs = {
      ...baseInputs,
      seed,
      factEs: 'Es un dato.',
      factEn: 'It is a fact.',
    };
    const c = pickSurprise(inputs, 'en');
    expect(c?.kind).toBe('dato_curioso');
    expect(c?.body).toBe('It is a fact.');
  });

  it('dato_curioso does NOT fire when no fact exists for the locale', () => {
    let seed = '';
    for (let i = 0; i < 1000; i++) {
      const candidate = `seed-${i}`;
      if (gateRoll(candidate)) { seed = candidate; break; }
    }
    const inputs: PickInputs = {
      ...baseInputs,
      seed,
      factEn: 'fact only in en',
      factEs: null,
    };
    expect(pickSurprise(inputs, 'es')).toBeNull();
  });

  it('dato_curioso does NOT fire when the gate roll lands above 0.1', () => {
    // Find a seed where gateRoll is false.
    let seed = '';
    for (let i = 0; i < 1000; i++) {
      const candidate = `noseed-${i}`;
      if (!gateRoll(candidate)) { seed = candidate; break; }
    }
    const inputs: PickInputs = {
      ...baseInputs,
      seed,
      factEs: 'Algo',
      factEn: 'Something',
    };
    expect(pickSurprise(inputs, 'es')).toBeNull();
  });

  it('uses the locale-correct title and body', () => {
    const inputsEs: PickInputs = { ...baseInputs, rarityBucket: 'rare', scientificName: 'X' };
    const cEs = pickSurprise(inputsEs, 'es');
    expect(cEs?.title).toMatch(/Rarito/);
    const inputsEn: PickInputs = { ...baseInputs, rarityBucket: 'rare', scientificName: 'X' };
    const cEn = pickSurprise(inputsEn, 'en');
    expect(cEn?.title).toMatch(/Rare/);
  });
});
