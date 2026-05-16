# On-device-first photo runners — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make on-device photo identification run **without the cloud and first** in `local` mode, by extracting a pure runner-set resolver and removing the `ObserveView2.astro` photo hard-skip — the structural foundation of the local-first progressive card.

**Architecture:** A new pure module `src/lib/observe-runner-set.ts` decides *which* identifier runners run, given AI mode + media kind + availability, with local-first invariants. `ObserveView2.astro`'s pipeline loop calls it instead of the inline ad-hoc logic, and the `'local'`-mode photo `continue` skip is deleted. The resolver is unit-tested in isolation; the wiring is a mechanical substitution.

**Tech Stack:** TypeScript (strict), Vitest (happy-dom), Astro inline module script.

**Scope note:** R1 (`sync.ts` `?? 'human'`) and R2 (confidence-cap preservation) are separable invariants — they get their own short follow-up plan, because R1's correct fix depends on the manual-entry source path and must not be guessed here. This plan delivers the on-device-first runner foundation only.

---

### Task 1: Pure runner-set resolver

**Files:**
- Create: `src/lib/observe-runner-set.ts`
- Test: `src/lib/observe-runner-set.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/observe-runner-set.test.ts
import { describe, it, expect } from 'vitest';
import { resolveRunnerSet, type RunnerAvailability } from './observe-runner-set';

const none: RunnerAvailability = {
  plantnet: false, claude: false, phi: false, gemma: false,
  efficientNet: false, megaDetector: false, birdnet: false,
};

describe('resolveRunnerSet — local-first invariants', () => {
  it('local mode + photo runs available on-device photo runners, NO cloud', () => {
    const r = resolveRunnerSet({
      aiMode: 'local', mediaKind: 'photo',
      available: { ...none, efficientNet: true, megaDetector: true, phi: true, plantnet: true, claude: true },
    });
    expect(r).toContain('efficientNet');
    expect(r).toContain('phi');
    expect(r).toContain('megaDetector');
    expect(r).not.toContain('plantnet');
    expect(r).not.toContain('claude');
  });

  it('local mode + photo with nothing on-device returns [] (caller falls back)', () => {
    const r = resolveRunnerSet({
      aiMode: 'local', mediaKind: 'photo',
      available: { ...none, plantnet: true, claude: true },
    });
    expect(r).toEqual([]);
  });

  it('sponsored mode + photo runs cloud AND on-device in parallel', () => {
    const r = resolveRunnerSet({
      aiMode: 'sponsored', mediaKind: 'photo',
      available: { ...none, plantnet: true, claude: true, efficientNet: true },
    });
    expect(r).toEqual(expect.arrayContaining(['plantnet', 'claude', 'efficientNet']));
  });

  it('audio runs birdnet only, in any mode', () => {
    for (const aiMode of ['local', 'sponsored', 'own-key'] as const) {
      expect(
        resolveRunnerSet({ aiMode, mediaKind: 'audio', available: { ...none, birdnet: true, claude: true } }),
      ).toEqual(['birdnet']);
    }
  });

  it('own-key mode + photo excludes cloud claude when claude unavailable', () => {
    const r = resolveRunnerSet({
      aiMode: 'own-key', mediaKind: 'photo',
      available: { ...none, plantnet: true, claude: false, efficientNet: true },
    });
    expect(r).toContain('plantnet');
    expect(r).toContain('efficientNet');
    expect(r).not.toContain('claude');
  });

  it('unknown / unsupported media returns []', () => {
    expect(resolveRunnerSet({ aiMode: 'local', mediaKind: 'unknown', available: { ...none, efficientNet: true } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/observe-runner-set.test.ts`
Expected: FAIL — `Failed to resolve import "./observe-runner-set"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/observe-runner-set.ts
/**
 * Pure decision: which identifier runners run for one pipeline node.
 *
 * Local-first invariants:
 *  - `local` mode never returns a cloud runner.
 *  - `local` + photo is NOT skipped — it returns the available on-device
 *    photo runners (efficientNet / phi / gemma) plus the megaDetector
 *    pre-filter. Returns [] only when nothing on-device is available, so
 *    the caller can fall back to `sponsored`.
 *  - `sponsored` / `own-key` run cloud runners AND on-device in parallel.
 *  - audio is birdnet-only in every mode.
 *
 * Returns abstract runner names; the caller maps them to concrete
 * runner-map keys.
 */
export type AiMode = 'sponsored' | 'own-key' | 'local';
export type MediaKind = 'photo' | 'audio' | 'video' | 'unknown';

export interface RunnerAvailability {
  plantnet: boolean;
  claude: boolean;
  phi: boolean;
  gemma: boolean;
  efficientNet: boolean;
  megaDetector: boolean;
  birdnet: boolean;
}

export interface ResolveInput {
  aiMode: AiMode;
  mediaKind: MediaKind;
  available: RunnerAvailability;
}

const ONDEVICE_PHOTO: Array<keyof RunnerAvailability> = [
  'megaDetector', 'efficientNet', 'phi', 'gemma',
];
const CLOUD_PHOTO: Array<keyof RunnerAvailability> = ['plantnet', 'claude'];

export function resolveRunnerSet(input: ResolveInput): string[] {
  const { aiMode, mediaKind, available } = input;

  if (mediaKind === 'audio') {
    return available.birdnet ? ['birdnet'] : [];
  }
  if (mediaKind !== 'photo') {
    return [];
  }

  const onDevice = ONDEVICE_PHOTO.filter((k) => available[k]);

  if (aiMode === 'local') {
    return onDevice; // [] → caller falls back to sponsored
  }

  const cloud = CLOUD_PHOTO.filter((k) => available[k]);
  return [...cloud, ...onDevice];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/observe-runner-set.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/observe-runner-set.ts src/lib/observe-runner-set.test.ts
git commit -m "feat(observe): pure on-device-first runner-set resolver"
```

---

### Task 2: Wire resolver into ObserveView2 + delete the photo skip

**Files:**
- Modify: `src/components/ObserveView2.astro` (the `runPipeline` photo branch, currently lines ~890–925; the `'local'`-mode skip is the line `if (aiMode === 'local') { setNodeState(state, node.id, 'skipped', undefined, 'Local-only mode'); continue; }`)

**Context (current code, for orientation — do not assume line numbers, match on text):**

```ts
      if (pf.kind === 'photo') {
        if (aiMode === 'local') { setNodeState(state, node.id, 'skipped', undefined, 'Local-only mode'); continue; }
        const runners: Record<string, import('../lib/identify-cascade-client').IdentifierRunner> = {};
        runners.plantnet = makePlantNetRunner(lang as 'en' | 'es');
        if (aiMode === 'own-key') {
          const { hasKeysForPlugin } = await import('../lib/byo-keys');
          if (hasKeysForPlugin('claude_haiku') && await hasAnthropicKey()) runners.claude_haiku = makeClaudeRunner(lang as 'en' | 'es');
        } else {
          if (await claudeAvailable()) runners.claude_haiku = makeClaudeRunner(lang as 'en' | 'es');
        }
        try {
          if (await pluginReady('webllm_phi35_vision')) {
            runners.webllm_phi35_vision = makePhiRunner(lang as 'en' | 'es');
          }
        } catch { /* WebLLM unavailable, skip */ }
        try {
          if (await pluginReady('onnx_gemma4_vision')) {
            const { makeGemmaRunner } = await import('../lib/identify-runners');
            runners.onnx_gemma4_vision = makeGemmaRunner(lang as 'en' | 'es');
          }
        } catch { /* transformers.js unavailable, skip */ }
        // EfficientNet block follows (getOnnxBaseCacheStatus → runners.onnx_efficientnet_lite0)
```

- [ ] **Step 1: Add the resolver import**

At the top of the `<script>` module in `ObserveView2.astro` (with the other `../lib/...` imports, next to `import { selfHealChunk } from '../lib/chunk-reload';`), add:

```ts
import { resolveRunnerSet, type RunnerAvailability } from '../lib/observe-runner-set';
```

- [ ] **Step 2: Replace the photo branch's runner assembly**

Replace the block from `if (aiMode === 'local') { setNodeState(...'Local-only mode'); continue; }` through the end of the EfficientNet block with the following. Compute availability first, resolve, then build only the resolved runners. (Keep the existing `makePlantNetRunner`/`makeClaudeRunner`/`makePhiRunner`/`makeGemmaRunner`/EfficientNet runner factories — only the *selection* changes.)

```ts
      if (pf.kind === 'photo') {
        const { hasKeysForPlugin } = await import('../lib/byo-keys');
        const { getOnnxBaseCacheStatus, getOnnxBaseWeightsBaseUrl } = await import('../lib/identifiers/onnx-base-cache');
        const efficientNetCached = getOnnxBaseWeightsBaseUrl()
          ? await getOnnxBaseCacheStatus().then(s => s.modelCached && s.labelsCached).catch(() => false)
          : false;
        const avail: RunnerAvailability = {
          plantnet: true, // EF operator key — always reachable when online
          claude: aiMode === 'own-key'
            ? (hasKeysForPlugin('claude_haiku') && await hasAnthropicKey())
            : await claudeAvailable(),
          phi: await pluginReady('webllm_phi35_vision').catch(() => false),
          gemma: await pluginReady('onnx_gemma4_vision').catch(() => false),
          efficientNet: efficientNetCached,
          megaDetector: false, // pre-filter wiring is a later card-spec task; not in this slice
          birdnet: false,
        };
        let chosen = resolveRunnerSet({ aiMode, mediaKind: 'photo', available: avail });
        if (aiMode === 'local' && chosen.length === 0) {
          // Nothing on-device for photos — honest fallback to sponsored.
          aiMode = 'sponsored'; writeAiMode('sponsored'); applyModeStyles('sponsored');
          showModeToast(isEs ? 'Sin modelo on-device para fotos — usando patrocinado.' : 'No on-device photo model — using sponsored.');
          chosen = resolveRunnerSet({ aiMode, mediaKind: 'photo', available: avail });
        }
        const runners: Record<string, import('../lib/identify-cascade-client').IdentifierRunner> = {};
        if (chosen.includes('plantnet')) runners.plantnet = makePlantNetRunner(lang as 'en' | 'es');
        if (chosen.includes('claude')) runners.claude_haiku = makeClaudeRunner(lang as 'en' | 'es');
        if (chosen.includes('phi')) runners.webllm_phi35_vision = makePhiRunner(lang as 'en' | 'es');
        if (chosen.includes('gemma')) {
          const { makeGemmaRunner } = await import('../lib/identify-runners');
          runners.onnx_gemma4_vision = makeGemmaRunner(lang as 'en' | 'es');
        }
        if (chosen.includes('efficientNet')) {
          const { makeEfficientNetRunner } = await import('../lib/identify-runners');
          runners.onnx_efficientnet_lite0 = makeEfficientNetRunner(lang as 'en' | 'es');
        }
```

> Note for the implementer: confirm the exact EfficientNet runner factory name and plugin key by reading the *existing* EfficientNet block you are replacing (search `onnx_efficientnet` / `getOnnxBaseCacheStatus` in `ObserveView2.astro` and `src/lib/identify-runners.ts`). Use the names found there verbatim — do not invent. If the existing code uses a different factory name than `makeEfficientNetRunner`, use the existing one.

- [ ] **Step 3: Remove the now-dead BirdNET-only `local` gate (lines ~878–882)**

The earlier block `} else if (aiMode === 'local') { const { getBirdNETCacheStatus ... } ... if (!ok) { aiMode = 'sponsored'; ... } }` pre-empted `local` mode to sponsored whenever BirdNET wasn't cached — that defeats on-device photo. Delete that `else if (aiMode === 'local') { ... }` arm entirely; per-node resolution (Step 2 for photo, the existing audio branch for BirdNET) now handles availability correctly.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Full unit suite + build**

Run: `npx vitest run` then `npm run build`
Expected: all tests pass; build completes (no Astro/JSX error).

- [ ] **Step 6: Commit**

```bash
git add src/components/ObserveView2.astro
git commit -m "feat(observe): on-device-first photo ID — resolver-driven runners, delete :891 skip"
```

---

### Task 3: Regression guard — local mode no longer skips photos

**Files:**
- Test: `src/lib/observe-runner-set.test.ts` (extend)

- [ ] **Step 1: Add the regression test**

```typescript
it('REGRESSION: local + photo with a cached on-device model never returns [] (no skip)', () => {
  const r = resolveRunnerSet({
    aiMode: 'local', mediaKind: 'photo',
    available: { plantnet: true, claude: true, phi: false, gemma: false,
      efficientNet: true, megaDetector: false, birdnet: false },
  });
  expect(r.length).toBeGreaterThan(0);
  expect(r).not.toContain('plantnet');
});
```

- [ ] **Step 2: Run + verify pass**

Run: `npx vitest run src/lib/observe-runner-set.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/observe-runner-set.test.ts
git commit -m "test(observe): regression guard — local mode runs on-device photo runners"
```

---

## Self-Review

- **Spec coverage:** Implements the amended foundation ("remove `:891`
  skip + runner-set resolver, on-device photo without/before cloud").
  R1/R2 explicitly scoped out to a follow-up plan (stated in header) —
  not a gap, a decomposition. MegaDetector pre-filter availability is
  wired as `false` here with an inline note that it's a later card-spec
  task — consistent with the spec's "orchestration" being a separate
  concern.
- **Placeholder scan:** No TBD/TODO. The one implementer note (EfficientNet
  factory name) instructs reading existing code and using it verbatim —
  this is correct guidance, not a placeholder, because inventing the name
  would be the error.
- **Type consistency:** `RunnerAvailability` / `ResolveInput` /
  `resolveRunnerSet` names match across Task 1 and Task 2. Abstract names
  (`plantnet`,`claude`,`phi`,`gemma`,`efficientNet`,`megaDetector`,
  `birdnet`) are consistent between resolver and wiring.
