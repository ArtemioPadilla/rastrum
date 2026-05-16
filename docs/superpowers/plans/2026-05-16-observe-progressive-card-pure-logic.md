# Progressive Card — Pure Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three pure decision functions the progressive result card needs — card-state selection, observer-sovereignty resolution, and audit-trace construction — fully unit-tested, with zero DOM/network dependency.

**Architecture:** Three small pure modules under `src/lib/`, each one responsibility, no imports of heavy/DOM/supabase code (same pattern as the shipped `observe-runner-set.ts`). The card render + `ObserveView2` wiring is a **separate later plan** (integration-heavy; depends on these pure pieces existing). This plan produces working, independently-testable software on its own.

**Tech Stack:** TypeScript (strict), Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md`. Scope-check decomposition: this plan = "pure logic"; child render = future plan.

---

### Task 1: Card-state selector

**Files:**
- Create: `src/lib/observe-card-state.ts`
- Test: `src/lib/observe-card-state.test.ts`

States (from spec): `S0` analyzing · `S1a` high-confidence collapse · `S1b` weak/uncertain question · `S2` cloud upgrade, observer did not act · `S2prime` cloud upgrade, observer affirmed · `S3` no on-device model AND offline (worst field case).

S1a rule (spec, explicit): only when a result is from a **non-capped** source (its `confidenceCeiling >= ACCEPT_THRESHOLD`) **and** `confidence >= ACCEPT_THRESHOLD` (0.7). Every capped-source result is always S1b.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/observe-card-state.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCardState, type CardStateInput } from './observe-card-state';
import { ACCEPT_THRESHOLD } from './identifiers/cascade';

const base: CardStateInput = {
  provisional: null, cloud: null, observerAffirmed: false,
  online: true, hasOnDeviceModel: true,
};

describe('resolveCardState', () => {
  it('S0 when nothing has resolved yet', () => {
    expect(resolveCardState(base)).toBe('S0');
  });

  it('S1a when a non-capped result clears ACCEPT_THRESHOLD', () => {
    expect(resolveCardState({
      ...base,
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
    })).toBe('S1a');
  });

  it('S1b when a capped-source result cannot be authoritative even at high confidence', () => {
    expect(resolveCardState({
      ...base,
      provisional: { scientificName: 'Quercus sp.', confidence: 0.4, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 },
    })).toBe('S1b');
  });

  it('S1b when a non-capped result is below ACCEPT_THRESHOLD', () => {
    expect(resolveCardState({
      ...base,
      cloud: { scientificName: 'Quercus sp.', confidence: 0.55, source: 'claude_haiku', confidenceCeiling: 1 },
    })).toBe('S1b');
  });

  it('S2 when cloud upgrades and the observer did not act', () => {
    expect(resolveCardState({
      ...base,
      provisional: { scientificName: 'Quercus sp.', confidence: 0.3, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 },
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
      observerAffirmed: false,
    })).toBe('S2');
  });

  it('S2prime when cloud arrives but the observer already affirmed', () => {
    expect(resolveCardState({
      ...base,
      provisional: { scientificName: 'Quercus crassifolia', confidence: 1, source: 'human', confidenceCeiling: 1 },
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
      observerAffirmed: true,
    })).toBe('S2prime');
  });

  it('S3 worst case: no on-device model and offline, nothing resolved', () => {
    expect(resolveCardState({ ...base, online: false, hasOnDeviceModel: false })).toBe('S3');
  });

  it('LOCAL ACCEPT_THRESHOLD constant matches the canonical cascade value', () => {
    expect(ACCEPT_THRESHOLD).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/observe-card-state.test.ts`
Expected: FAIL — `Failed to resolve import "./observe-card-state"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/observe-card-state.ts
/**
 * Pure card-state selector for the observe progressive result card.
 * No DOM / network. See
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */

// Must match ACCEPT_THRESHOLD in src/lib/identifiers/cascade.ts. The
// canonical value is asserted equal by the test (parity guard); declared
// locally so this module stays dependency-free.
const ACCEPT_THRESHOLD = 0.7;

export interface IdResult {
  scientificName: string;
  confidence: number;
  source: string;
  /** The source's confidence ceiling from the identifier registry. */
  confidenceCeiling: number;
}

export interface CardStateInput {
  /** First on-device / provisional result, if any. */
  provisional: IdResult | null;
  /** Authoritative cloud result, if it has arrived. */
  cloud: IdResult | null;
  /** True once the observer made an explicit affirm/correct action. */
  observerAffirmed: boolean;
  online: boolean;
  hasOnDeviceModel: boolean;
}

export type CardState = 'S0' | 'S1a' | 'S1b' | 'S2' | 'S2prime' | 'S3';

function isAuthoritative(r: IdResult): boolean {
  return r.confidenceCeiling >= ACCEPT_THRESHOLD && r.confidence >= ACCEPT_THRESHOLD;
}

export function resolveCardState(input: CardStateInput): CardState {
  const { provisional, cloud, observerAffirmed, online, hasOnDeviceModel } = input;

  if (cloud) {
    return observerAffirmed ? 'S2prime' : (isAuthoritative(cloud) ? 'S1a' : 'S2');
  }
  if (provisional) {
    return isAuthoritative(provisional) ? 'S1a' : 'S1b';
  }
  if (!online && !hasOnDeviceModel) {
    return 'S3';
  }
  return 'S0';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/observe-card-state.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/observe-card-state.ts src/lib/observe-card-state.test.ts
git commit -m "feat(observe): pure card-state selector (S0–S3, S2′)"
```

---

### Task 2: Observer-sovereignty resolver

**Files:**
- Create: `src/lib/observe-sovereignty.ts`
- Test: `src/lib/observe-sovereignty.test.ts`

Rule (spec Q3=C): the observer's explicit affirmation is sovereign. Cloud result + observer did NOT act → `upgrade-primary`. Cloud result + observer affirmed → `parallel-suggestion` (never overwrite). No cloud result → `none`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/observe-sovereignty.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSovereignty } from './observe-sovereignty';

describe('resolveSovereignty', () => {
  it('upgrade-primary when cloud arrives and observer did not act', () => {
    expect(resolveSovereignty({ observerAffirmed: false, cloudArrived: true })).toBe('upgrade-primary');
  });

  it('parallel-suggestion when cloud arrives but observer already affirmed', () => {
    expect(resolveSovereignty({ observerAffirmed: true, cloudArrived: true })).toBe('parallel-suggestion');
  });

  it('none when no cloud result has arrived (regardless of affirmation)', () => {
    expect(resolveSovereignty({ observerAffirmed: false, cloudArrived: false })).toBe('none');
    expect(resolveSovereignty({ observerAffirmed: true, cloudArrived: false })).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/observe-sovereignty.test.ts`
Expected: FAIL — `Failed to resolve import "./observe-sovereignty"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/observe-sovereignty.ts
/**
 * Pure resolver for the "observer affirmation is sovereign" rule. The
 * machine never overrides an explicit human identification. See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */
export interface SovereigntyInput {
  /** True once the observer explicitly affirmed/corrected the ID. */
  observerAffirmed: boolean;
  /** True once an authoritative cloud result has arrived. */
  cloudArrived: boolean;
}

export type SovereigntyAction = 'upgrade-primary' | 'parallel-suggestion' | 'none';

export function resolveSovereignty(input: SovereigntyInput): SovereigntyAction {
  if (!input.cloudArrived) return 'none';
  return input.observerAffirmed ? 'parallel-suggestion' : 'upgrade-primary';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/observe-sovereignty.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/observe-sovereignty.ts src/lib/observe-sovereignty.test.ts
git commit -m "feat(observe): pure observer-sovereignty resolver"
```

---

### Task 3: Audit-trace builder

**Files:**
- Create: `src/lib/observe-audit-trace.ts`
- Test: `src/lib/observe-audit-trace.test.ts`

Builds the ordered, typed trace the "view trace" panel renders, from raw identification attempts (one per model that ran) — maps to `identifications` rows + cascade filter outcomes. Pure transform; sorted by attempt time ascending.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/observe-audit-trace.test.ts
import { describe, it, expect } from 'vitest';
import { buildAuditTrace, type IdAttempt } from './observe-audit-trace';

const attempts: IdAttempt[] = [
  { source: 'plantnet', where: 'cloud', scientificName: 'Quercus rugosa', confidence: 0.94, isPrimary: true, createdAt: '2026-05-16T10:02:09Z' },
  { source: 'onnx_efficientnet_lite0', where: 'device', scientificName: 'Quercus sp.', confidence: 0.31, isPrimary: false, createdAt: '2026-05-16T10:02:02Z' },
  { source: 'camera_trap_megadetector', where: 'device', scientificName: null, confidence: 0.71, isPrimary: false, createdAt: '2026-05-16T10:02:01Z', filteredLabel: 'animal' },
];

describe('buildAuditTrace', () => {
  it('sorts by createdAt ascending', () => {
    const t = buildAuditTrace(attempts);
    expect(t.map(e => e.source)).toEqual([
      'camera_trap_megadetector', 'onnx_efficientnet_lite0', 'plantnet',
    ]);
  });

  it('types the outcome per attempt', () => {
    const t = buildAuditTrace(attempts);
    const bySrc = Object.fromEntries(t.map(e => [e.source, e.outcome]));
    expect(bySrc['plantnet']).toBe('primary');
    expect(bySrc['onnx_efficientnet_lite0']).toBe('non-primary');
    expect(bySrc['camera_trap_megadetector']).toBe('pre-filter');
  });

  it('flags capped-source rows so the UI can explain the research-grade floor', () => {
    const t = buildAuditTrace(attempts);
    const en = t.find(e => e.source === 'onnx_efficientnet_lite0');
    expect(en?.capped).toBe(true);
    const pn = t.find(e => e.source === 'plantnet');
    expect(pn?.capped).toBe(false);
  });

  it('returns [] for no attempts', () => {
    expect(buildAuditTrace([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/observe-audit-trace.test.ts`
Expected: FAIL — `Failed to resolve import "./observe-audit-trace"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/observe-audit-trace.ts
/**
 * Pure builder for the audit "view trace" panel. One row per real
 * identification attempt (maps to identifications rows + cascade filter
 * outcomes), sorted oldest-first, with a typed outcome and a capped flag
 * for honest research-grade-floor messaging. See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */

// Sources whose registry confidence_ceiling is below the cascade
// ACCEPT_THRESHOLD (0.7) — they can never be authoritative / research-grade.
// EfficientNet 0.4, MegaDetector 0.4, Phi 0.35, Gemma 0.35. SpeciesNet
// (0.85) and cloud sources are NOT capped.
const CAPPED_SOURCES = new Set<string>([
  'onnx_efficientnet_lite0',
  'camera_trap_megadetector',
  'phi_vision',
  'onnx_gemma4_vision',
]);

export interface IdAttempt {
  source: string;
  where: 'device' | 'cloud';
  scientificName: string | null;
  confidence: number;
  isPrimary: boolean;
  createdAt: string;
  /** Set when MegaDetector pre-filtered this frame (animal/human/empty/vehicle). */
  filteredLabel?: string;
}

export type TraceOutcome = 'pre-filter' | 'primary' | 'non-primary';

export interface TraceEntry {
  source: string;
  where: 'device' | 'cloud';
  scientificName: string | null;
  confidence: number;
  outcome: TraceOutcome;
  capped: boolean;
  createdAt: string;
}

export function buildAuditTrace(attempts: IdAttempt[]): TraceEntry[] {
  return [...attempts]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((a) => ({
      source: a.source,
      where: a.where,
      scientificName: a.scientificName,
      confidence: a.confidence,
      outcome: a.filteredLabel
        ? 'pre-filter'
        : a.isPrimary
          ? 'primary'
          : 'non-primary',
      capped: CAPPED_SOURCES.has(a.source),
      createdAt: a.createdAt,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/observe-audit-trace.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
npx vitest run
npx tsc --noEmit
git add src/lib/observe-audit-trace.ts src/lib/observe-audit-trace.test.ts
git commit -m "feat(observe): pure audit-trace builder"
```

---

## Self-Review

**1. Spec coverage:** Covers the spec's pure decision surface — state machine S0–S3/S2′ (Task 1, with the explicit S1a/S1b boundary using the verified `ACCEPT_THRESHOLD = 0.7` and ceilings), sovereignty rule Q3=C (Task 2), audit trace mapping to `identifications` + capped flag honesty (Task 3). The card render + `ObserveView2` wiring + `review_requested` flag are explicitly out of scope (separate plans, stated in header — decomposition, not a gap). MegaDetector pre-filter availability is represented in the trace (`filteredLabel`→`pre-filter`) but its runtime wiring remains a later integration task, consistent with the prior foundation plan's note.

**2. Placeholder scan:** No TBD/TODO. Every step has complete code and exact commands.

**3. Type consistency:** `IdResult`/`CardStateInput`/`CardState` (Task 1), `SovereigntyInput`/`SovereigntyAction` (Task 2), `IdAttempt`/`TraceEntry`/`TraceOutcome` (Task 3) are each self-contained per module; no cross-task symbol reuse to drift. `ACCEPT_THRESHOLD` is declared locally in Task 1's module AND asserted equal to the canonical `./identifiers/cascade` export by Task 1's parity test — guards drift without a heavy import. `CAPPED_SOURCES` in Task 3 lists exactly the verified sub-0.7 ceilings (EfficientNet/MegaDetector/Phi/Gemma), explicitly excluding SpeciesNet 0.85 and cloud.
