# #804 — "Not in your dex yet" filter on Contextual Species Chips

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggle pill on `ContextualSpeciesChips` that filters to show only species the signed-in user hasn't observed yet, using the `has_observed_by_viewer` field already returned by `probable_taxa_at()`.

**Architecture:** The RPC already returns `has_observed_by_viewer boolean` per taxon. Client-side JS already receives and renders this data (the "not in your dex yet" badge uses it). We add a `data-filter-new-only` toggle button visible only for authenticated users. On toggle, JS re-renders the chip list filtering `has_observed_by_viewer === false`. No new server query needed — filter is pure client-side over the already-fetched results.

**Tech Stack:** TypeScript, Astro, Supabase (RPC already done), Vitest

---

## File Map

- **Modify:** `src/components/ContextualSpeciesChips.astro` — add toggle button HTML + JS filter logic
- **Modify:** `src/lib/algorithms.ts` — update `contextual_species_chips` copy to mention the filter
- **Create:** `tests/unit/contextual-chips-filter.test.ts` — unit test for filter logic

---

### Task 1: Extract and test the filter logic

**Files:**
- Create: `tests/unit/contextual-chips-filter.test.ts`

- [ ] **Step 1: Write failing test for filter function**

```typescript
// tests/unit/contextual-chips-filter.test.ts
import { describe, it, expect } from 'vitest';
import { filterChipsByDex } from '../../src/lib/contextual-chips-filter';

const mockChips = [
  { taxon_id: 'a', scientific_name: 'Sp A', has_observed_by_viewer: false },
  { taxon_id: 'b', scientific_name: 'Sp B', has_observed_by_viewer: true },
  { taxon_id: 'c', scientific_name: 'Sp C', has_observed_by_viewer: false },
  { taxon_id: 'd', scientific_name: 'Sp D', has_observed_by_viewer: null },
];

describe('filterChipsByDex', () => {
  it('returns all chips when newOnly=false', () => {
    expect(filterChipsByDex(mockChips, false)).toHaveLength(4);
  });

  it('returns only unobserved chips when newOnly=true', () => {
    const result = filterChipsByDex(mockChips, true);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.taxon_id)).toEqual(['a', 'c']);
  });

  it('treats null has_observed_by_viewer as unobserved (anon user)', () => {
    const anon = [{ taxon_id: 'x', scientific_name: 'Sp X', has_observed_by_viewer: null }];
    expect(filterChipsByDex(anon, true)).toHaveLength(0); // null = viewer unknown, don't claim "new"
  });

  it('returns empty array if all are observed', () => {
    const allObserved = mockChips.map(c => ({ ...c, has_observed_by_viewer: true }));
    expect(filterChipsByDex(allObserved, true)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/contextual-chips-filter.test.ts 2>&1 | tail -8
```

- [ ] **Step 3: Create `src/lib/contextual-chips-filter.ts`**

```typescript
// src/lib/contextual-chips-filter.ts
/**
 * Filter helpers for ContextualSpeciesChips "not in dex yet" toggle.
 * Pure functions — no Supabase, no DOM. Testable in isolation.
 */

export interface ChipRow {
  taxon_id: string;
  scientific_name: string;
  has_observed_by_viewer: boolean | null;
  [key: string]: unknown;
}

/**
 * Filter chip rows.
 * @param chips - Full chip list from probable_taxa_at() RPC
 * @param newOnly - When true, return only species with has_observed_by_viewer === false
 *                  (null = viewer unknown → excluded when filtering)
 */
export function filterChipsByDex(chips: ChipRow[], newOnly: boolean): ChipRow[] {
  if (!newOnly) return chips;
  return chips.filter(c => c.has_observed_by_viewer === false);
}
```

- [ ] **Step 4: Run tests — expect pass**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/contextual-chips-filter.test.ts 2>&1 | tail -8
```

- [ ] **Step 5: Commit**
```bash
git add src/lib/contextual-chips-filter.ts tests/unit/contextual-chips-filter.test.ts
git commit -m "feat(chips): add filterChipsByDex() helper with tests"
```

---

### Task 2: Add toggle UI + wire filter in ContextualSpeciesChips

**Files:**
- Modify: `src/components/ContextualSpeciesChips.astro`

- [ ] **Step 1: Add i18n keys (add to the `ctx` destructure block, with fallbacks)**

In the frontmatter section where `ctx` is destructured, add:
```typescript
const filterNewLabel = (ctx as any).filter_new_only ?? (isEs ? 'Solo nuevas para mí' : 'New to me only');
const filterAllLabel = (ctx as any).filter_all ?? (isEs ? 'Ver todas' : 'Show all');
```

- [ ] **Step 2: Add toggle button HTML after the heading row**

Find the `<div class="flex items-start justify-between gap-3">` block. After the closing `</div>` of that block, add:

```html
<!-- New-to-me filter toggle — only shown for signed-in users (JS reveals it) -->
<div id="obs2-chips-filter-wrap" class="hidden flex items-center gap-2">
  <button
    type="button"
    id="obs2-chips-filter-btn"
    class="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:border-emerald-400 dark:hover:border-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
    data-active="false"
    data-label-new={filterNewLabel}
    data-label-all={filterAllLabel}
    aria-pressed="false"
  >
    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2a7 7 0 1 0 0 14A7 7 0 0 0 12 2z"/><path d="M12 8v4l3 3"/>
    </svg>
    <span id="obs2-chips-filter-label">{filterNewLabel}</span>
  </button>
</div>
```

- [ ] **Step 3: Wire filter logic in the `<script>` block**

In the script block, find where `chipRows` is stored after the RPC call. The component stores results in a module-level variable. Add:

```typescript
import { filterChipsByDex, type ChipRow } from '../lib/contextual-chips-filter';

// After the existing let declarations, add:
let allChipRows: ChipRow[] = [];
let newOnlyActive = false;

// In the renderChips() function (or wherever chips are rendered), replace:
//   const rows = chipRows;
// with:
//   const rows = filterChipsByDex(allChipRows, newOnlyActive);

// After fetching + storing chipRows, also store to allChipRows:
//   allChipRows = chipRows;
```

Wire the toggle button:
```typescript
const filterBtn = document.getElementById('obs2-chips-filter-btn');
const filterWrap = document.getElementById('obs2-chips-filter-wrap');
const filterLabel = document.getElementById('obs2-chips-filter-label');

filterBtn?.addEventListener('click', () => {
  newOnlyActive = !newOnlyActive;
  filterBtn.setAttribute('aria-pressed', newOnlyActive ? 'true' : 'false');
  filterBtn.dataset.active = newOnlyActive ? 'true' : 'false';
  filterBtn.classList.toggle('border-emerald-500', newOnlyActive);
  filterBtn.classList.toggle('text-emerald-700', newOnlyActive);
  filterBtn.classList.toggle('dark:text-emerald-400', newOnlyActive);
  if (filterLabel) {
    filterLabel.textContent = newOnlyActive
      ? (filterBtn.dataset.labelAll ?? 'Show all')
      : (filterBtn.dataset.labelNew ?? 'New to me only');
  }
  renderChips(filterChipsByDex(allChipRows, newOnlyActive));
});

// Show filter wrap only for authenticated users (after getCachedUser resolves)
import { getCachedUser } from '../lib/supabase';
getCachedUser().then(user => {
  if (user && filterWrap) filterWrap.classList.remove('hidden');
}).catch(() => {});
```

- [ ] **Step 4: TypeScript check**
```bash
cd /home/ubuntu/rastrum && npx tsc --noEmit 2>&1 | grep -v "huggingface\|onnx\|identify" | grep "error TS" | head -10
```

- [ ] **Step 5: Commit**
```bash
git add src/components/ContextualSpeciesChips.astro src/lib/contextual-chips-filter.ts
git commit -m "feat(chips): add 'new to me only' toggle filter on contextual species chips

Closes #804. Signed-in users see a toggle pill that filters chips to
show only species not yet in their dex. Uses has_observed_by_viewer
already returned by probable_taxa_at() — no additional server query."
```

---

### Task 3: Update algorithms.ts copy

**Files:**
- Modify: `src/lib/algorithms.ts`

- [ ] **Step 1: Update the `contextual_species_chips` algorithm entry**

Find the `contextual_species_chips` entry in `ALGORITHMS`. Update the `inputs` array to mention the new filter:

```typescript
// In the en.inputs array, add:
'Filter toggle: "New to me only" — hides species already in the user\'s dex (has_observed_by_viewer)',
// In es.inputs array, add:
'Filtro: "Solo nuevas para mí" — oculta especies ya en el dex del usuario (has_observed_by_viewer)',
```

- [ ] **Step 2: Commit**
```bash
git add src/lib/algorithms.ts
git commit -m "docs(algorithms): document new-to-me filter in contextual_species_chips algorithm"
```
