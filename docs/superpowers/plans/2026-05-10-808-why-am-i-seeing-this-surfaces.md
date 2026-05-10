# #808 — WhyAmISeeingThis: register contextual_species algorithm entry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Register the `contextual_species` algorithm entry in `src/lib/algorithms.ts` with full EN+ES copy, confirm the WhyAmISeeingThis pill is wired in `ContextualSpeciesChips.astro`, and update the algorithms docs catalog. Buddy (#732) and mini-bioblitz (#747) entries are deferred until those parent features ship.

**Architecture:** Pure frontend disclosure layer — no schema changes. The `WhyAmISeeingThisDialog` is already mounted globally and reads from `ALGORITHMS`. Adding a new entry = one object in `algorithms.ts` + mounting the `<WhyAmISeeingThis>` pill in the component. The contextual chips component already has `algorithm="contextual_species_chips"` wired — the mismatch with the issue's `contextual_species` ID needs reconciling (see Task 1).

**Tech Stack:** TypeScript, Astro, Vitest

---

## File Map

- **Modify:** `src/lib/algorithms.ts` — add `contextual_species` entry (or confirm `contextual_species_chips` is correct ID)
- **Verify/Modify:** `src/components/ContextualSpeciesChips.astro` — ensure pill algorithm ID matches catalog
- **Modify:** `tests/unit/algorithms.test.ts` (create if not exists) — catalog shape tests
- **Verify:** `src/components/AlgorithmsDocView.astro` — catalog page auto-renders from ALGORITHMS, no manual update needed

---

### Task 1: Audit algorithm ID mismatch + add catalog entry

**Files:**
- Modify: `src/lib/algorithms.ts`

- [ ] **Step 1: Check current state**
```bash
cd /home/ubuntu/rastrum && grep -n "contextual_species" src/lib/algorithms.ts src/components/ContextualSpeciesChips.astro
```

The component uses `algorithm="contextual_species_chips"`. The issue calls it `contextual_species`. Determine which is canonical:
- If `contextual_species_chips` is NOT in `AlgorithmId` type → the pill renders but the dialog shows no content (graceful degradation). Need to add the entry.
- Use `contextual_species_chips` as the ID (matches the existing component) for consistency.

- [ ] **Step 2: Write failing test**

Create `tests/unit/algorithms.test.ts` if it doesn't exist:

```typescript
// tests/unit/algorithms.test.ts
import { describe, it, expect } from 'vitest';
import { ALGORITHMS, getAlgorithm, type AlgorithmId } from '../../src/lib/algorithms';

describe('ALGORITHMS catalog', () => {
  const ids = Object.keys(ALGORITHMS) as AlgorithmId[];

  it('has entries for all known ranked surfaces', () => {
    const required: AlgorithmId[] = [
      'explore_recent',
      'explore_species_recent',
      'community_observers',
      'contextual_species_chips',
      'falta_dex_missing',
      'profile_percentile_cards',
      'active_observers_today',
      'home_recent_nearby',
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  it('every entry has EN and ES copy with non-empty inputs', () => {
    for (const id of ids) {
      const entry = ALGORITHMS[id];
      expect(entry.copy.en.inputs.length).toBeGreaterThan(0);
      expect(entry.copy.es.inputs.length).toBeGreaterThan(0);
    }
  });

  it('contextual_species_chips has GPS + month + density inputs', () => {
    const entry = ALGORITHMS['contextual_species_chips'];
    const enInputs = entry.copy.en.inputs.join(' ');
    expect(enInputs).toMatch(/location|GPS|centroid/i);
    expect(enInputs).toMatch(/month|season/i);
  });

  it('getAlgorithm returns entry for valid id', () => {
    expect(getAlgorithm('explore_recent')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run — expect fail if contextual_species_chips missing**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/algorithms.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Add `contextual_species_chips` entry to `src/lib/algorithms.ts`**

Add to the `AlgorithmId` union type:
```typescript
| 'contextual_species_chips'
```
(If already present, skip this step.)

Add to `ALGORITHMS` object:
```typescript
contextual_species_chips: {
  headline: {
    en: 'Why am I seeing these species?',
    es: '¿Por qué veo estas especies?',
  },
  summary: {
    en: 'A density estimate from wild community observations near your current location and month.',
    es: 'Una estimación de densidad basada en observaciones silvestres de la comunidad cerca de tu ubicación actual y mes.',
  },
  copy: {
    en: {
      inputs: [
        'Your current GPS location (centroid, ~50 km radius)',
        'Current calendar month ±1 (year-wrapping at Jan/Dec)',
        'Count of wild community observations in that area + month window',
        'Whether you have already observed each species (for the "new to me" filter)',
        'No curated baseline — real community sightings only',
      ],
      window: 'Wild public observations within ~50 km, current month ±1, all years',
      settings_label: 'Edit location in profile settings',
    },
    es: {
      inputs: [
        'Tu ubicación GPS actual (centroide, radio ~50 km)',
        'Mes calendario actual ±1 (con ajuste en ene/dic)',
        'Conteo de observaciones silvestres de la comunidad en esa área + ventana de mes',
        'Si ya observaste cada especie (para el filtro "solo nuevas para mí")',
        'Sin baseline curado — solo observaciones reales de la comunidad',
      ],
      window: 'Observaciones públicas silvestres dentro de ~50 km, mes actual ±1, todos los años',
      settings_label: 'Editar ubicación en configuración de perfil',
    },
  },
  settings_path: {
    en: '/en/profile/settings',
    es: '/es/perfil/configuracion',
  },
},
```

- [ ] **Step 5: Run tests — expect pass**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/algorithms.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Commit**
```bash
git add src/lib/algorithms.ts tests/unit/algorithms.test.ts
git commit -m "feat(algorithms): register contextual_species_chips in algorithm catalog

Closes #808 (contextual surface). Buddy (#732) and mini-bioblitz (#747)
entries deferred until those parent features ship."
```

---

### Task 2: Verify WhyAmISeeingThis pill in ContextualSpeciesChips

**Files:**
- Verify: `src/components/ContextualSpeciesChips.astro`

- [ ] **Step 1: Confirm pill is mounted and ID matches**
```bash
cd /home/ubuntu/rastrum && grep -n "WhyAmISeeingThis\|algorithm=" src/components/ContextualSpeciesChips.astro
```

Expected output:
```
69:    <WhyAmISeeingThis algorithm="contextual_species_chips" lang={lang} className="shrink-0" />
```

If the ID doesn't match `contextual_species_chips`, update it to match.

- [ ] **Step 2: TypeScript check — ensure AlgorithmId type includes the new ID**
```bash
cd /home/ubuntu/rastrum && npx tsc --noEmit 2>&1 | grep -v "huggingface\|onnx\|identify" | grep "error TS" | head -10
```

- [ ] **Step 3: Commit (if any changes needed)**
```bash
git add src/components/ContextualSpeciesChips.astro
git commit -m "fix(chips): align WhyAmISeeingThis algorithm ID with catalog entry"
```

---

### Task 3: Add deferred entries as stubs with comments

**Files:**
- Modify: `src/lib/algorithms.ts`

Per the issue, buddy and mini-bioblitz entries should be added when those parent features ship. Add them as commented stubs so the next engineer knows where to add them:

- [ ] **Step 1: Add comment stubs at end of ALGORITHMS object**

```typescript
// ── Deferred entries (wire when parent feature ships) ──────────────────────
// buddy_suggestions: #732 — wire when buddy observation suggestions land
// mini_bioblitz_ranking: #747 — wire when mini-bioblitz duels land
// ──────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Commit**
```bash
git add src/lib/algorithms.ts
git commit -m "docs(algorithms): add deferred stub comments for buddy + mini-bioblitz (#808)"
```

---

### Task 4: Run full test suite + build check

- [ ] **Step 1: Run all tests**
```bash
cd /home/ubuntu/rastrum && npx vitest run 2>&1 | tail -15
```

- [ ] **Step 2: TypeScript check**
```bash
cd /home/ubuntu/rastrum && npx tsc --noEmit 2>&1 | grep -v "huggingface\|onnx\|identify" | grep "error TS" | head -10
```

- [ ] **Step 3: Final commit if any cleanup**
```bash
git add -A && git diff --cached --stat
# Only commit if there are changes
```
