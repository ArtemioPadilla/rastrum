# Progressive Card — View-Model Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single pure composer, `buildCardViewModel`, that ties the three shipped pure resolvers (`resolveCardState`, `resolveSovereignty`, `buildAuditTrace`) into one view model the eventual DOM render layer consumes — so the render slice has one clean, fully-tested seam to bind to.

**Architecture:** One new pure module `src/lib/observe-card-vm.ts` composing the already-merged `observe-card-state.ts` / `observe-sovereignty.ts` / `observe-audit-trace.ts` (all on `main` via #1115). No DOM/network — same pattern as `observe-runner-set.ts`. The DOM render + `ObserveView2` wiring is the **next, separate plan** (it binds to this VM). This plan produces working, independently-testable software on its own.

**Tech Stack:** TypeScript (strict), Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md`. Scope-check decomposition: pure logic (#1115, done) → **this VM seam** → DOM render/wiring (future plan) → review-request + downloads (future plans).

---

### Task 1: Card view-model composer

**Files:**
- Create: `src/lib/observe-card-vm.ts`
- Test: `src/lib/observe-card-vm.test.ts`

The composer takes the same primitive inputs the resolvers need and returns one object the render layer reads directly: the resolved `state`, the `sovereignty` action, the ordered `trace`, plus a render-ready `headline` (what scientific name the card shows) and `sourceLabel` (e.g. `"PlantNet · 94%"` or `"En tu dispositivo · EfficientNet"`). Pure string assembly only — no i18n here (the render layer localizes the static chrome; `sourceLabel` is data, not a sentence).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/observe-card-vm.test.ts
import { describe, it, expect } from 'vitest';
import { buildCardViewModel, type CardVmInput } from './observe-card-vm';
import type { IdAttempt } from './observe-audit-trace';

const base: CardVmInput = {
  provisional: null,
  cloud: null,
  observerAffirmed: false,
  online: true,
  hasOnDeviceModel: true,
  attempts: [],
};

describe('buildCardViewModel', () => {
  it('S0 with no headline/sourceLabel when nothing resolved', () => {
    const vm = buildCardViewModel(base);
    expect(vm.state).toBe('S0');
    expect(vm.sovereignty).toBe('none');
    expect(vm.headline).toBeNull();
    expect(vm.sourceLabel).toBeNull();
    expect(vm.trace).toEqual([]);
  });

  it('S1a with cloud headline + source label when an authoritative cloud result exists', () => {
    const vm = buildCardViewModel({
      ...base,
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
    });
    expect(vm.state).toBe('S1a');
    expect(vm.sovereignty).toBe('upgrade-primary');
    expect(vm.headline).toBe('Quercus rugosa');
    expect(vm.sourceLabel).toBe('plantnet · 94%');
  });

  it('S1b headline/source come from the provisional when there is no cloud', () => {
    const vm = buildCardViewModel({
      ...base,
      provisional: { scientificName: 'Quercus sp.', confidence: 0.31, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 },
    });
    expect(vm.state).toBe('S1b');
    expect(vm.sovereignty).toBe('none');
    expect(vm.headline).toBe('Quercus sp.');
    expect(vm.sourceLabel).toBe('onnx_efficientnet_lite0 · 31%');
  });

  it('S2prime keeps the observer headline; sovereignty is parallel-suggestion', () => {
    const vm = buildCardViewModel({
      ...base,
      provisional: { scientificName: 'Quercus crassifolia', confidence: 1, source: 'human', confidenceCeiling: 1 },
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
      observerAffirmed: true,
    });
    expect(vm.state).toBe('S2prime');
    expect(vm.sovereignty).toBe('parallel-suggestion');
    expect(vm.headline).toBe('Quercus crassifolia');
  });

  it('passes the audit trace through, oldest-first', () => {
    const attempts: IdAttempt[] = [
      { source: 'plantnet', where: 'cloud', scientificName: 'Quercus rugosa', confidence: 0.94, isPrimary: true, createdAt: '2026-05-16T10:02:09Z' },
      { source: 'onnx_efficientnet_lite0', where: 'device', scientificName: 'Quercus sp.', confidence: 0.31, isPrimary: false, createdAt: '2026-05-16T10:02:02Z' },
    ];
    const vm = buildCardViewModel({ ...base, cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 }, attempts });
    expect(vm.trace.map(e => e.source)).toEqual(['onnx_efficientnet_lite0', 'plantnet']);
  });

  it('sourceLabel rounds confidence to whole percent', () => {
    const vm = buildCardViewModel({
      ...base,
      cloud: { scientificName: 'X', confidence: 0.666, source: 'claude_haiku', confidenceCeiling: 1 },
    });
    expect(vm.sourceLabel).toBe('claude_haiku · 67%');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `npx vitest run src/lib/observe-card-vm.test.ts`
Expected: FAIL — `Failed to resolve import "./observe-card-vm"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/observe-card-vm.ts
/**
 * Pure composer: ties the three card resolvers into one view model the
 * DOM render layer consumes. No DOM / network / i18n (the render layer
 * localizes static chrome; sourceLabel is data). See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */
import { resolveCardState, type IdResult, type CardState } from './observe-card-state';
import { resolveSovereignty, type SovereigntyAction } from './observe-sovereignty';
import { buildAuditTrace, type IdAttempt, type TraceEntry } from './observe-audit-trace';

export interface CardVmInput {
  provisional: IdResult | null;
  cloud: IdResult | null;
  observerAffirmed: boolean;
  online: boolean;
  hasOnDeviceModel: boolean;
  attempts: IdAttempt[];
}

export interface CardViewModel {
  state: CardState;
  sovereignty: SovereigntyAction;
  trace: TraceEntry[];
  /** Scientific name the card displays, or null when nothing resolved. */
  headline: string | null;
  /** Data label "source · NN%", or null when nothing resolved. */
  sourceLabel: string | null;
}

function labelFor(r: IdResult): string {
  return `${r.source} · ${Math.round(r.confidence * 100)}%`;
}

export function buildCardViewModel(input: CardVmInput): CardViewModel {
  const state = resolveCardState({
    provisional: input.provisional,
    cloud: input.cloud,
    observerAffirmed: input.observerAffirmed,
    online: input.online,
    hasOnDeviceModel: input.hasOnDeviceModel,
  });
  const sovereignty = resolveSovereignty({
    observerAffirmed: input.observerAffirmed,
    cloudArrived: input.cloud !== null,
  });
  const trace = buildAuditTrace(input.attempts);

  // Headline source priority: an affirmed observer ID wins (sovereignty);
  // otherwise the cloud result if present; otherwise the provisional.
  const primary: IdResult | null =
    input.observerAffirmed && input.provisional
      ? input.provisional
      : input.cloud ?? input.provisional;

  return {
    state,
    sovereignty,
    trace,
    headline: primary ? primary.scientificName : null,
    sourceLabel: primary ? labelFor(primary) : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/observe-card-vm.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
npx vitest run
npx tsc --noEmit
git add src/lib/observe-card-vm.ts src/lib/observe-card-vm.test.ts
git commit -m "feat(observe): pure card view-model composer"
```

---

## Self-Review

**1. Spec coverage:** Provides the single seam the render slice binds to — composes the spec's state machine, sovereignty rule, and audit trace into one view model, plus the render-ready `headline`/`sourceLabel`. The DOM render, action handlers (Sí/No/No-sé), `review_requested`, and downloads UX remain explicitly separate later plans (stated in header — decomposition, not gaps).

**2. Placeholder scan:** No TBD/TODO. Full code + exact commands in every step.

**3. Type consistency:** Imports `IdResult`/`CardState` from `observe-card-state`, `SovereigntyAction` from `observe-sovereignty`, `IdAttempt`/`TraceEntry` from `observe-audit-trace` — these are the exact exported names of the modules merged in #1115. `CardVmInput`/`CardViewModel` are defined once here and used consistently in the test. The headline-priority rule (affirmed observer ID wins, else cloud, else provisional) matches the sovereignty intent encoded in `observe-card-state` (S2prime keeps the observer's ID primary).
