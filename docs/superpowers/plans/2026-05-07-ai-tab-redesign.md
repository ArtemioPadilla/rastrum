# AI Settings Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the AI settings tab's twin-card structure into one unified card per plugin, migrate the four-key localStorage state to a single source of truth (`rastrum.disabledPlugins`), surface sponsorships on the Claude card, and group plugins by media-type → specialist/generalist.

**Architecture:** A pure TypeScript template function (`renderPluginCard`) builds card HTML inside the existing client-side `paintRegistry()` script. State derivation lives in `identifier-state.ts` so it's testable and reusable from `ObservationForm` + `ObserveView2` (which today probe localStorage directly). The existing on-device download JS (`vision-download` / `birdnet-download` / etc.) stays — it just gets wrapped in a `wireOnDeviceControls(rootEl)` function called once per `paintRegistry` cycle, so binding happens after the unified cards exist in the DOM.

**Tech Stack:** Astro (static SSG), TypeScript strict, vitest + happy-dom, Tailwind 3, existing identifier registry (`src/lib/identifiers/`), existing `local-ai.ts` for cache utilities.

**Spec:** [`docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md`](../specs/2026-05-07-ai-tab-redesign-design.md)

---

## File map

**New files:**
- `src/lib/identifier-state.ts` (~120 lines) — `CardState` discriminated union, `deriveCardState()` pure function, `runStorageMigration()` one-shot.
- `src/lib/identifier-card-html.ts` (~280 lines) — `renderPluginCard()` template function, escape helper, per-state markup branches.
- `tests/unit/identifier-state.test.ts` — tests for both functions.
- `tests/unit/identifier-card-html.test.ts` — snapshot-style assertions per state.

**Heavy edits:**
- `src/components/ProfileEditForm.astro` — `paintRegistry` rewrite, deletion of static on-device cards (lines ~277–509 in current file, ~277–509 will all change), wrap on-device JS (lines ~826–1554) in `wireOnDeviceControls(root)` function.

**Light edits:**
- `src/components/ObservationForm.astro` — replace 5 `localStorage.getItem(...)` probes with registry calls.
- `src/components/ObserveView2.astro` — replace 4 `localStorage.getItem(...)` probes with registry calls.
- `src/i18n/en.json`, `src/i18n/es.json` — add `pipeline.section.*` keys.

**No changes:** Edge Functions, SQL schema, the cascade itself (`src/lib/identifiers/cascade.ts`), individual plugin files (`plantnet.ts`, `claude.ts`, `phi-vision.ts`, etc.).

---

### Task 0: Worktree setup

**Files:** none (git only)

- [ ] **Step 1: Create worktree off main**

Run:
```bash
git checkout main && git pull --ff-only
git worktree add .worktrees/refactor-ai-tab-unified -b refactor/ai-tab-unified main
cd .worktrees/refactor-ai-tab-unified
```

Expected: new branch `refactor/ai-tab-unified` checked out at `.worktrees/refactor-ai-tab-unified/`.

- [ ] **Step 2: Confirm baseline tests + typecheck pass**

Run:
```bash
npm run typecheck && npm run test
```

Expected: typecheck clean, all tests passing (≥ 1022 today). If any fail, stop — main is broken; fix before proceeding.

---

### Task 1: identifier-state.ts (TDD)

**Files:**
- Create: `src/lib/identifier-state.ts`
- Test: `tests/unit/identifier-state.test.ts`

This module is the single source of truth for "what state is each plugin's card in?" and the one-shot migration that consolidates the four legacy localStorage keys into `rastrum.disabledPlugins`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/identifier-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveCardState,
  runStorageMigration,
  type DerivedStateInput,
} from '../../src/lib/identifier-state';

// localStorage shim (matches the byo-keys.test.ts pattern)
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    length: 0,
    key: () => null,
  } as Storage;
});

function input(overrides: Partial<DerivedStateInput> = {}): DerivedStateInput {
  return {
    pluginId: 'webllm_phi35_vision',
    runtime: 'client',
    availability: { ready: true },
    isDisabled: false,
    cacheStatus: { cached: true, approxBytes: 4_000_000_000, entries: 15 },
    byoKeysSet: false,
    ...overrides,
  };
}

describe('deriveCardState', () => {
  it('returns active when ready and not disabled', () => {
    expect(deriveCardState(input())).toEqual({ kind: 'active' });
  });

  it('returns disabled when user has flipped the toggle', () => {
    expect(deriveCardState(input({ isDisabled: true }))).toEqual({ kind: 'disabled' });
  });

  it('returns no-key for cloud plugin missing required key', () => {
    const s = deriveCardState(input({
      runtime: 'cloud',
      availability: { ready: false, reason: 'needs_key' },
      cacheStatus: null,
    }));
    expect(s).toEqual({ kind: 'no-key' });
  });

  it('returns not-downloaded for on-device plugin without cache', () => {
    const s = deriveCardState(input({
      cacheStatus: { cached: false, approxBytes: 0, entries: 0 },
      availability: { ready: false, reason: 'needs_download' },
    }));
    expect(s).toEqual({ kind: 'not-downloaded' });
  });

  it('returns unsupported for missing WebGPU', () => {
    const s = deriveCardState(input({
      availability: { ready: false, reason: 'unsupported', message: 'WebGPU unavailable' },
    }));
    expect(s).toEqual({ kind: 'unsupported', reason: 'webgpu', message: 'WebGPU unavailable' });
  });

  it('returns unsupported for insufficient memory', () => {
    const s = deriveCardState(input({
      availability: { ready: false, reason: 'insufficient_memory', message: 'Need > 4 GB RAM' },
    }));
    expect(s).toEqual({ kind: 'unsupported', reason: 'memory', message: 'Need > 4 GB RAM' });
  });

  it('disabled state takes precedence over availability', () => {
    // User explicitly disabled a fully-ready plugin
    expect(deriveCardState(input({ isDisabled: true }))).toEqual({ kind: 'disabled' });
  });
});

describe('runStorageMigration', () => {
  it('is a no-op when no legacy keys are present', () => {
    runStorageMigration();
    expect(localStorage.getItem('rastrum.disabledPlugins')).toBeNull();
  });

  it('migrates usePhiVision=false → adds webllm_phi35_vision to disabledPlugins', () => {
    localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .toContain('webllm_phi35_vision');
    expect(localStorage.getItem('rastrum.prefs.usePhiVision')).toBeNull();
  });

  it('migrates usePhiVision=true → does NOT add to disabledPlugins, removes legacy key', () => {
    localStorage.setItem('rastrum.prefs.usePhiVision', 'true');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .not.toContain('webllm_phi35_vision');
    expect(localStorage.getItem('rastrum.prefs.usePhiVision')).toBeNull();
  });

  it('migrates useGemmaVision the same way', () => {
    localStorage.setItem('rastrum.prefs.useGemmaVision', 'false');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .toContain('onnx_gemma4_vision');
  });

  it('removes localAiOptIn key (no behavioral mapping needed)', () => {
    localStorage.setItem('rastrum.localAiOptIn', 'true');
    runStorageMigration();
    expect(localStorage.getItem('rastrum.localAiOptIn')).toBeNull();
  });

  it('is idempotent — running twice does not duplicate disabledPlugins entries', () => {
    localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    runStorageMigration();
    runStorageMigration();
    const list = JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]');
    expect(list.filter((id: string) => id === 'webllm_phi35_vision')).toHaveLength(1);
  });

  it('preserves existing disabledPlugins entries', () => {
    localStorage.setItem('rastrum.disabledPlugins', JSON.stringify(['claude_haiku']));
    localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    runStorageMigration();
    const list = JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]');
    expect(list).toContain('claude_haiku');
    expect(list).toContain('webllm_phi35_vision');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run tests/unit/identifier-state.test.ts
```

Expected: All tests fail with `Cannot find module '../../src/lib/identifier-state'`.

- [ ] **Step 3: Create `src/lib/identifier-state.ts`**

Create `src/lib/identifier-state.ts`:

```typescript
/**
 * State derivation for identifier plugin cards on the AI settings tab.
 *
 * Single source of truth for "what is the card showing right now?". The
 * UI (paintRegistry) and the cascade gates (ObservationForm /
 * ObserveView2) both call deriveCardState so the visual state on the
 * settings tab cannot drift from the runtime gating decision.
 *
 * Also owns the one-shot localStorage migration that retires the
 * pre-redesign keys (`rastrum.localAiOptIn`,
 * `rastrum.prefs.usePhiVision`, `rastrum.prefs.useGemmaVision`) in
 * favor of the single `rastrum.disabledPlugins` source of truth.
 */
import type { IdentifierAvailability } from './identifiers/types';
import type { ModelCacheStatus } from './local-ai';

export interface DerivedStateInput {
  pluginId: string;
  runtime: 'cloud' | 'client';
  availability: IdentifierAvailability;
  isDisabled: boolean;
  /** null for cloud plugins; ModelCacheStatus for on-device. */
  cacheStatus: ModelCacheStatus | null;
  /** True when the plugin needs a key and the user has saved one. */
  byoKeysSet: boolean;
}

export type CardState =
  | { kind: 'active' }
  | { kind: 'disabled' }
  | { kind: 'no-key' }
  | { kind: 'not-downloaded' }
  | { kind: 'downloading'; pct: number; mb: { current: number; total: number } }
  | { kind: 'unsupported'; reason: 'webgpu' | 'memory' | 'env-missing' | 'other'; message?: string };

export function deriveCardState(input: DerivedStateInput): CardState {
  // User-flipped Disable wins over everything except actual unsupportedness.
  if (input.isDisabled && input.availability.ready) {
    return { kind: 'disabled' };
  }
  if (input.availability.ready) {
    return { kind: 'active' };
  }
  // Not ready — translate availability reason into the card's vocabulary.
  switch (input.availability.reason) {
    case 'needs_key':
      return { kind: 'no-key' };
    case 'needs_download':
      return { kind: 'not-downloaded' };
    case 'model_not_bundled':
      return { kind: 'unsupported', reason: 'env-missing', message: input.availability.message };
    case 'unsupported':
      return { kind: 'unsupported', reason: 'webgpu', message: input.availability.message };
    case 'insufficient_memory':
      return { kind: 'unsupported', reason: 'memory', message: input.availability.message };
    case 'disabled':
      return { kind: 'disabled' };
    default:
      return { kind: 'unsupported', reason: 'other', message: input.availability.message };
  }
}

const LEGACY_KEY_LOCAL_AI_OPTIN = 'rastrum.localAiOptIn';
const LEGACY_KEY_USE_PHI = 'rastrum.prefs.usePhiVision';
const LEGACY_KEY_USE_GEMMA = 'rastrum.prefs.useGemmaVision';
const DISABLED_PLUGINS_KEY = 'rastrum.disabledPlugins';

const LEGACY_PLUGIN_MAP: Record<string, string> = {
  [LEGACY_KEY_USE_PHI]: 'webllm_phi35_vision',
  [LEGACY_KEY_USE_GEMMA]: 'onnx_gemma4_vision',
};

/**
 * Idempotent. Reads the three legacy preference keys; if a key is set
 * to 'false', it adds the corresponding plugin id to `disabledPlugins`.
 * Always deletes the legacy keys after reading. Safe to call on every
 * AI tab paint — after the first run there's nothing to do.
 */
export function runStorageMigration(): void {
  // Snapshot current disabled list (default empty) and convert to a Set
  // so we can dedupe.
  const raw = localStorage.getItem(DISABLED_PLUGINS_KEY);
  let disabled: Set<string>;
  try {
    disabled = new Set<string>(JSON.parse(raw ?? '[]'));
  } catch {
    disabled = new Set<string>();
  }

  let changed = false;
  for (const [legacyKey, pluginId] of Object.entries(LEGACY_PLUGIN_MAP)) {
    const value = localStorage.getItem(legacyKey);
    if (value === null) continue;
    // Only 'true' means "user wanted this enabled". Any other value (the
    // 'false' the toggle wrote, or anything malformed) means disabled.
    if (value !== 'true' && !disabled.has(pluginId)) {
      disabled.add(pluginId);
      changed = true;
    }
    localStorage.removeItem(legacyKey);
    changed = true;
  }

  // The umbrella opt-in carries no per-plugin info; just retire it.
  if (localStorage.getItem(LEGACY_KEY_LOCAL_AI_OPTIN) !== null) {
    localStorage.removeItem(LEGACY_KEY_LOCAL_AI_OPTIN);
    changed = true;
  }

  if (changed) {
    localStorage.setItem(DISABLED_PLUGINS_KEY, JSON.stringify([...disabled]));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run tests/unit/identifier-state.test.ts
```

Expected: all 13 tests pass.

- [ ] **Step 5: Run full typecheck**

Run:
```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/identifier-state.ts tests/unit/identifier-state.test.ts
git commit -m "feat(identifiers): add identifier-state module + storage migration

Pure deriveCardState() function turns plugin availability + disabled
state into a discriminated CardState union the UI can render directly.
runStorageMigration() retires the four legacy keys in favor of
rastrum.disabledPlugins. Both fully tested.

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: identifier-card-html.ts (TDD)

**Files:**
- Create: `src/lib/identifier-card-html.ts`
- Test: `tests/unit/identifier-card-html.test.ts`

The pure rendering function. Takes resolved state, returns the `<li>` HTML for one card. Does NOT touch the DOM. Lets `paintRegistry` build the registry list as `cards.join('')`, the same shape it produces today.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/identifier-card-html.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderPluginCard, type PluginCardProps } from '../../src/lib/identifier-card-html';
import type { Identifier } from '../../src/lib/identifiers/types';

const phi: Identifier = {
  id: 'webllm_phi35_vision',
  name: 'Phi-3.5-vision',
  brand: '🧠',
  description: 'Heavy on-device generalist.',
  capabilities: {
    runtime: 'client',
    media: ['photo'],
    taxa: ['*'],
    license: 'free',
    confidence_ceiling: 0.35,
  },
  isAvailable: async () => ({ ready: true }),
  identify: async () => { throw new Error('not used in tests'); },
};

const claude: Identifier = {
  id: 'claude_haiku',
  name: 'Claude Haiku 4.5 (Vision)',
  brand: '✦',
  description: 'Anthropic Claude Haiku 4.5 with vision input.',
  capabilities: {
    runtime: 'cloud',
    media: ['photo'],
    taxa: ['*'],
    license: 'byo-key',
  },
  keySpec: [{ name: 'anthropic', label: 'Anthropic API key', placeholder: 'sk-ant-…', optional: true }],
  isAvailable: async () => ({ ready: false, reason: 'needs_key' }),
  identify: async () => { throw new Error('not used in tests'); },
};

function props(overrides: Partial<PluginCardProps> = {}): PluginCardProps {
  return {
    lang: 'en',
    plugin: phi,
    state: { kind: 'active' },
    isDisabled: false,
    cacheStatus: { cached: true, approxBytes: 4_000_000_000, entries: 15 },
    byoKeysSet: {},
    sponsorship: null,
    ...overrides,
  };
}

describe('renderPluginCard', () => {
  it('renders an active on-device card with name, brand, and Active pill', () => {
    const html = renderPluginCard(props());
    expect(html).toContain('Phi-3.5-vision');
    expect(html).toContain('🧠');
    expect(html).toContain('Active');
    expect(html).toContain('data-toggle-plugin="webllm_phi35_vision"');
    expect(html).toContain('Disable');
  });

  it('renders disabled card with opacity-60 and Enable button', () => {
    const html = renderPluginCard(props({
      state: { kind: 'disabled' }, isDisabled: true,
    }));
    expect(html).toContain('opacity-60');
    expect(html).toContain('Enable');
    expect(html).toContain('Disabled');
    expect(html).not.toMatch(/>Disable<\/button>/);
  });

  it('renders not-downloaded card with primary Download CTA, no Disable toggle', () => {
    const html = renderPluginCard(props({
      state: { kind: 'not-downloaded' },
      cacheStatus: { cached: false, approxBytes: 0, entries: 0 },
    }));
    expect(html).toContain('Not downloaded');
    expect(html).toMatch(/Download.*4\.0 GB/);
    // No Disable toggle when nothing to disable
    expect(html).not.toMatch(/data-toggle-plugin/);
  });

  it('renders no-key cloud card with Add key primary button', () => {
    const html = renderPluginCard(props({
      plugin: claude,
      state: { kind: 'no-key' },
      cacheStatus: null,
    }));
    expect(html).toContain('Claude Haiku');
    expect(html).toContain('No key');
    expect(html).toContain('Add key');
    expect(html).toContain('data-add-key="claude_haiku"');
  });

  it('renders unsupported card with the message inline', () => {
    const html = renderPluginCard(props({
      state: { kind: 'unsupported', reason: 'webgpu', message: 'WebGPU unavailable' },
    }));
    expect(html).toContain('Unsupported');
    expect(html).toContain('WebGPU unavailable');
  });

  it('renders sponsorship chip on Claude card when active', () => {
    const html = renderPluginCard(props({
      plugin: claude,
      state: { kind: 'active' },
      cacheStatus: null,
      sponsorship: { sponsor_handle: 'alice', daily_limit: 100, used_today: 47 },
    }));
    expect(html).toContain('via sponsorship');
    expect(html).toContain('@alice');
    expect(html).toMatch(/47\s*\/\s*100/);
    expect(html).toContain('Use my own key');
  });

  it('omits the daily count when sponsorship has no limit/usage info', () => {
    const html = renderPluginCard(props({
      plugin: claude,
      state: { kind: 'active' },
      cacheStatus: null,
      sponsorship: { sponsor_handle: 'alice', daily_limit: null, used_today: null },
    }));
    expect(html).toContain('via sponsorship');
    expect(html).toContain('@alice');
    expect(html).not.toMatch(/IDs today/);
  });

  it('escapes HTML in plugin description and sponsor handle', () => {
    const evil: Identifier = { ...phi, description: '<img src=x onerror=alert(1)>', name: '<script>' };
    const html = renderPluginCard(props({
      plugin: evil,
      sponsorship: { sponsor_handle: '<svg>', daily_limit: 1, used_today: 0 },
    }));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders Spanish strings when lang=es', () => {
    const html = renderPluginCard(props({ lang: 'es' }));
    expect(html).toContain('Activo');
    expect(html).toContain('Desactivar');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run tests/unit/identifier-card-html.test.ts
```

Expected: all 9 tests fail with `Cannot find module '../../src/lib/identifier-card-html'`.

- [ ] **Step 3: Create `src/lib/identifier-card-html.ts`**

Create `src/lib/identifier-card-html.ts`:

```typescript
/**
 * Pure HTML template for one plugin card on the AI settings tab.
 *
 * Returns a string ready to be joined with siblings into the
 * registry list's innerHTML. Keeps all class names + element IDs
 * compatible with the existing on-device download JS in
 * ProfileEditForm.astro (vision-download, birdnet-status, etc.) so
 * wireOnDeviceControls(rootEl) can bind to them after innerHTML is
 * set.
 *
 * Element IDs that downstream JS expects (do NOT rename):
 *   webllm_phi35_vision     → vision-download / vision-delete / vision-status / vision-progress / phi-vision-enable
 *   onnx_gemma4_vision      → gemma-vision-{download,delete,status,progress,enable}
 *   birdnet_lite            → birdnet-{download,delete,status,progress}
 *   onnx_efficientnet_lite0 → onnx-base-{download,delete,status,progress}
 *   camera_trap_megadetector → megadetector-{download,delete,status,progress}
 *   speciesnet_distilled    → speciesnet-{download,delete,status,progress}
 */
import type { Identifier } from './identifiers/types';
import type { ModelCacheStatus } from './local-ai';
import type { CardState } from './identifier-state';

export interface ActiveSponsorship {
  sponsor_handle: string;
  daily_limit: number | null;
  used_today: number | null;
}

export interface PluginCardProps {
  lang: 'en' | 'es';
  plugin: Identifier;
  state: CardState;
  isDisabled: boolean;
  cacheStatus: ModelCacheStatus | null;
  /** Map of keySpec.name → present-and-non-empty? */
  byoKeysSet: Record<string, boolean>;
  /** Only meaningful for plugin.id === 'claude_haiku'. */
  sponsorship: ActiveSponsorship | null;
}

function escape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]!));
}

function bytesHuman(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

interface Strings {
  active: string; disabled: string; no_key: string; not_downloaded: string; unsupported: string;
  enable: string; disable: string; download: string; delete: string; add_key: string;
  use_own_key: string; via_sponsorship: string; sponsored_by: string; ids_today: string;
}

const STRINGS: Record<'en' | 'es', Strings> = {
  en: {
    active: 'Active', disabled: '⏸ Disabled', no_key: 'No key', not_downloaded: 'Not downloaded',
    unsupported: '⚠ Unsupported', enable: 'Enable', disable: 'Disable', download: 'Download',
    delete: 'Delete', add_key: 'Add key', use_own_key: 'Use my own key',
    via_sponsorship: 'via sponsorship', sponsored_by: 'sponsored by', ids_today: 'IDs today',
  },
  es: {
    active: 'Activo', disabled: '⏸ Desactivado', no_key: 'Sin API key', not_downloaded: 'Sin descargar',
    unsupported: '⚠ No soportado', enable: 'Activar', disable: 'Desactivar', download: 'Descargar',
    delete: 'Eliminar', add_key: 'Agregar API key', use_own_key: 'Usar tu propia API key',
    via_sponsorship: 'vía patrocinio', sponsored_by: 'patrocinado por', ids_today: 'IDs hoy',
  },
};

function pillFor(state: CardState, t: Strings): string {
  // Tailwind classes match existing patterns at ProfileEditForm.astro:1708.
  const baseClass = 'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded';
  switch (state.kind) {
    case 'active':
      return `<span class="${baseClass} bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">${t.active}</span>`;
    case 'disabled':
      return `<span class="${baseClass} bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">${t.disabled}</span>`;
    case 'no-key':
      return `<span class="${baseClass} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">${t.no_key}</span>`;
    case 'not-downloaded':
      return `<span class="${baseClass} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">${t.not_downloaded}</span>`;
    case 'downloading':
      return `<span class="${baseClass} bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">⏳ ${state.pct}%</span>`;
    case 'unsupported':
      return `<span class="${baseClass} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300">${t.unsupported}</span>`;
  }
}

function actionsFor(p: PluginCardProps, t: Strings): string {
  const id = escape(p.plugin.id);
  const onDeviceIds: Record<string, string> = {
    webllm_phi35_vision: 'vision',
    onnx_gemma4_vision: 'gemma-vision',
    birdnet_lite: 'birdnet',
    onnx_efficientnet_lite0: 'onnx-base',
    camera_trap_megadetector: 'megadetector',
    speciesnet_distilled: 'speciesnet',
  };
  const dlPrefix = onDeviceIds[p.plugin.id];

  const primaryBtn = (label: string, dataAttr: string, value: string) =>
    `<button type="button" ${dataAttr}="${value}" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">${label}</button>`;

  const ghostBtn = (label: string, dataAttr: string, value: string) =>
    `<button type="button" ${dataAttr}="${value}" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">${label}</button>`;

  const dangerBtn = (label: string, dataAttr: string, value: string) =>
    `<button type="button" ${dataAttr}="${value}" class="rounded-lg border border-red-300 dark:border-red-900/50 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">${label}</button>`;

  const toggleBtn = (label: string) =>
    `<button type="button" data-toggle-plugin="${id}" class="rounded-lg border border-emerald-600/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-2 py-1 text-[10px] font-medium">${label}</button>`;

  switch (p.state.kind) {
    case 'active': {
      // Cloud plugin: edit-key + disable. On-device: re-download + delete + disable.
      if (p.plugin.capabilities.runtime === 'cloud') {
        return `${ghostBtn(t.add_key, 'data-edit-key', id)} ${toggleBtn(t.disable)}`;
      }
      const idBase = dlPrefix ?? '';
      return `
        <button type="button" id="${idBase}-download" class="rounded-lg border border-emerald-600/60 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">Re-download</button>
        <button type="button" id="${idBase}-delete" class="rounded-lg border border-red-300 dark:border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">${t.delete}</button>
        ${toggleBtn(t.disable)}
      `;
    }
    case 'disabled': {
      if (p.plugin.capabilities.runtime === 'cloud') {
        return toggleBtn(t.enable);
      }
      const idBase = dlPrefix ?? '';
      return `${dangerBtn(t.delete, 'id', `${idBase}-delete`)} ${toggleBtn(t.enable)}`;
    }
    case 'no-key':
      return primaryBtn(t.add_key, 'data-add-key', id);
    case 'not-downloaded': {
      const sizeLabel = bytesHuman(p.cacheStatus?.approxBytes ?? 0) || '?';
      const idBase = dlPrefix ?? '';
      return `<button type="button" id="${idBase}-download" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">${t.download} · ${escape(p.plugin.capabilities.media[0] === 'audio' ? '50 MB' : sizeLabel)}</button>`;
    }
    case 'downloading': {
      const idBase = dlPrefix ?? '';
      return `<button type="button" id="${idBase}-cancel" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px]">Cancel</button>`;
    }
    case 'unsupported':
      return '';
  }
}

function metaLine(p: PluginCardProps): string {
  const c = p.plugin.capabilities;
  const parts: string[] = [];
  parts.push(c.runtime === 'cloud' ? 'cloud' : 'on-device');
  parts.push(c.media.map((m) => ({ photo: '📷', audio: '🔊', video: '🎞' }[m] ?? m)).join(''));
  if (c.taxa.length) parts.push(c.taxa.join(', '));
  if (c.confidence_ceiling) parts.push(`cap ≤ ${c.confidence_ceiling.toFixed(2)}`);
  if (p.cacheStatus?.cached) parts.push(`${bytesHuman(p.cacheStatus.approxBytes)} cached`);
  return parts.join(' · ');
}

function sponsorshipLine(p: PluginCardProps, t: Strings): string {
  if (p.plugin.id !== 'claude_haiku' || !p.sponsorship) return '';
  const handle = `@${escape(p.sponsorship.sponsor_handle)}`;
  const usage = p.sponsorship.daily_limit !== null && p.sponsorship.used_today !== null
    ? ` · ${p.sponsorship.used_today} / ${p.sponsorship.daily_limit} ${t.ids_today}`
    : '';
  return `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 ml-1">${t.via_sponsorship}</span><div class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">${t.sponsored_by} ${handle}${usage}</div>`;
}

export function renderPluginCard(p: PluginCardProps): string {
  const t = STRINGS[p.lang];
  const liClass = p.state.kind === 'disabled'
    ? 'rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 opacity-60 p-3'
    : 'rounded-lg border border-zinc-200 dark:border-zinc-800 p-3';

  const message = p.state.kind === 'unsupported' && p.state.message
    ? `<p class="text-[10px] text-zinc-500 italic mt-1">${escape(p.state.message)}</p>`
    : '';

  return `
    <li class="${liClass}">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            ${p.plugin.brand ? `<span class="text-base">${escape(p.plugin.brand)}</span>` : ''}
            <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">${escape(p.plugin.name)}</p>
            ${pillFor(p.state, t)}
            ${sponsorshipLine(p, t)}
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${escape(p.plugin.description)}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 font-mono">${escape(metaLine(p))}</p>
          ${message}
        </div>
        <div class="flex flex-wrap gap-2 flex-none">
          ${actionsFor(p, t)}
        </div>
      </div>
    </li>
  `.trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run tests/unit/identifier-card-html.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/identifier-card-html.ts tests/unit/identifier-card-html.test.ts
git commit -m "feat(identifiers): add renderPluginCard template

Pure function turning resolved CardState into the unified card HTML.
Element IDs match existing on-device download JS conventions
(vision-download, birdnet-status, etc.) so wireOnDeviceControls()
can bind after innerHTML is set. XSS-safe escapes everywhere.

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: i18n keys for new section headers

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

Section headers + the shared experimental warning need translatable strings. Today's `pipeline.section_title` etc. exist; we add new sub-keys that the rewritten paintRegistry will read.

- [ ] **Step 1: Find current pipeline keys**

Run:
```bash
grep -n '"pipeline"' src/i18n/en.json
```

Expected: locates the `"pipeline": { ... }` block.

- [ ] **Step 2: Add section keys to en.json**

Inside the existing `"pipeline": { ... }` object, add these keys (maintain alphabetical order of siblings):

```json
"section_photo_specialists": "📷 Photo identifiers · Specialists",
"section_photo_generalists": "📷 Photo identifiers · Generalists",
"section_audio": "🔊 Audio identifiers",
"section_other_local_data": "🗂 Other local data",
"experimental_warning": "Experimental — these may crash on some devices, and confidence is hard-capped at 0.35. Try Phi or Gemma; if one crashes, try the other."
```

- [ ] **Step 3: Add the same keys to es.json**

```json
"section_photo_specialists": "📷 Identificadores de foto · Especialistas",
"section_photo_generalists": "📷 Identificadores de foto · Generalistas",
"section_audio": "🔊 Identificadores de audio",
"section_other_local_data": "🗂 Otros datos locales",
"experimental_warning": "Experimental — pueden bloquearse en algunos dispositivos y la confianza se limita a 0.35. Prueba Phi o Gemma; si uno falla, prueba el otro."
```

- [ ] **Step 4: Verify JSON is valid**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/en.json','utf8'))" && \
node -e "JSON.parse(require('fs').readFileSync('src/i18n/es.json','utf8'))"
```

Expected: no output (success). If parse error, fix the JSON.

- [ ] **Step 5: Run typecheck (i18n keys feed into TS via t())**

Run:
```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "i18n: section headers for unified AI tab

Adds pipeline.section_{photo_specialists,photo_generalists,audio,other_local_data}
and pipeline.experimental_warning for the redesigned grouping.

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wrap on-device JS in `wireOnDeviceControls()` function

**Files:**
- Modify: `src/components/ProfileEditForm.astro` (lines ~822–1554, the on-device control script)

The on-device JS today binds at script-evaluate time via top-level `const optinBox = document.getElementById('local-ai-optin')` style. Static cards exist at evaluate time, so binding works. After Task 5 deletes the static cards, those `const`s would capture `null`. We pre-emptively wrap the whole block in a function that takes the now-painted root element.

- [ ] **Step 1: Locate the start of the on-device script block**

Open `src/components/ProfileEditForm.astro`. Find:
```typescript
  // ── AI settings: WebLLM opt-in + per-model download / delete ──
  const LAI_OPTIN = 'rastrum.localAiOptIn';
  const optinBox = document.getElementById('local-ai-optin') as HTMLInputElement | null;
```

This starts the block (around line 821 in the current file). Find the matching end — look for the line just before `// ── Identity linking (issue #286) ──` (around line 1554). Mark these as the boundary.

- [ ] **Step 2: Wrap the block in `function wireOnDeviceControls()`**

Replace the entire block from `// ── AI settings: WebLLM opt-in...` through (but NOT including) `// ── Identity linking...` with:

```typescript
  // ── AI settings: on-device download / delete control wiring ──
  // Wrapped in a function called from paintRegistry() after the
  // unified cards are inserted, so the getElementById calls find
  // the elements rather than capturing null at script-evaluate.
  function wireOnDeviceControls() {
    const LAI_OPTIN = 'rastrum.localAiOptIn'; // legacy; migration removes it on first paint
    // [PASTE THE EXISTING BLOCK CONTENTS HERE — no edits to body]
  }
  // Single call here so the existing first-paint flow continues to work
  // for any markup that might still be present (Phase B's static cards).
  // paintRegistry() will call wireOnDeviceControls() again after it
  // replaces the markup; the bindings are idempotent since they go
  // through addEventListener on (now-different) elements.
  wireOnDeviceControls();
```

Critical mechanics:
- The function body is the EXACT existing code, indented one level deeper.
- Move all `const` declarations from top-level into the function body.
- The `LAI_OPTIN` constant moves inside (it's only used here).
- All `?.addEventListener` and `getElementById` calls remain as-is.

- [ ] **Step 3: Run typecheck — catches scope mistakes**

Run:
```bash
npm run typecheck
```

Expected: clean. If you see errors like "Cannot find name 'optinBox'", you missed moving a const into the function body. Fix and retry.

- [ ] **Step 4: Run tests**

Run:
```bash
npm run test
```

Expected: all 1031 tests passing (Tasks 1–2 added 22; baseline was 1022; +9 new).

- [ ] **Step 5: Build to verify Astro syntax**

Run:
```bash
npm run build
```

Expected: 231 pages built, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProfileEditForm.astro
git commit -m "refactor(profile-edit): wrap on-device JS in wireOnDeviceControls()

Pure scope refactor: existing top-level const declarations + handlers
move into a function. Same behavior; one call site after the function
def keeps Phase-B markup working until Task 5 deletes it.

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rewrite paintRegistry for unified cards

**Files:**
- Modify: `src/components/ProfileEditForm.astro` (the `async function paintRegistry()` block, currently around line 1593)

The biggest single change. Pre-resolve everything, run migration, sort, group, render unified cards, call wireOnDeviceControls, wire the new event delegations.

- [ ] **Step 1: Replace `paintRegistry` function body**

In `src/components/ProfileEditForm.astro`, replace the entire `async function paintRegistry()` (starts ~line 1593, ends ~line 1796) with:

```typescript
  // ── Identifier registry list (modular platform) — unified cards ──
  async function paintRegistry() {
    const list = document.getElementById('identifier-list');
    if (!list) return;

    const [
      { bootstrapIdentifiers },
      byo,
      { runStorageMigration, deriveCardState },
      { renderPluginCard },
      { getModelCacheStatus },
      sponsorshipMod,
    ] = await Promise.all([
      import('../lib/identifiers'),
      import('../lib/byo-keys'),
      import('../lib/identifier-state'),
      import('../lib/identifier-card-html'),
      import('../lib/local-ai'),
      import('../lib/sponsorships').catch(() => ({ getActiveAnthropicSponsorship: async () => null })),
    ]);
    runStorageMigration();

    const reg = bootstrapIdentifiers();
    const plugins = reg.list();
    const isEs = document.documentElement.lang === 'es';
    const lang: 'en' | 'es' = isEs ? 'es' : 'en';

    // Pre-resolve availability + cache + sponsorship in parallel.
    const ON_DEVICE_MODEL_IDS: Record<string, string> = {
      webllm_phi35_vision: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
      onnx_gemma4_vision: 'gemma-3n-e2b-vision',
      birdnet_lite: 'BirdNET-Lite-v2.4',
      onnx_efficientnet_lite0: 'efficientnet-lite0',
      camera_trap_megadetector: 'megadetector-v5a',
      speciesnet_distilled: 'speciesnet-v1',
    };

    const [availabilities, cacheStatuses, sponsorship] = await Promise.all([
      Promise.all(plugins.map(async (p) => [p.id, await p.isAvailable()] as const)),
      Promise.all(plugins.map(async (p) => {
        const modelId = ON_DEVICE_MODEL_IDS[p.id];
        return [p.id, modelId ? await getModelCacheStatus(modelId).catch(() => null) : null] as const;
      })),
      sponsorshipMod.getActiveAnthropicSponsorship?.().catch(() => null) ?? null,
    ]);

    const availabilityMap = new Map(availabilities);
    const cacheMap = new Map(cacheStatuses);
    const disabled = getDisabledPlugins();

    // Filter out plugins that can never run in this deployment.
    const visiblePlugins = plugins.filter((p) =>
      availabilityMap.get(p.id)?.reason !== 'model_not_bundled'
    );

    // Group by section.
    type Section = 'photo_specialists' | 'photo_generalists' | 'audio' | 'experimental';
    const SECTION_OF: Record<string, Section> = {
      plantnet: 'photo_specialists',
      camera_trap_megadetector: 'photo_specialists',
      claude_haiku: 'photo_generalists',
      onnx_efficientnet_lite0: 'photo_generalists',
      birdnet_lite: 'audio',
      webllm_phi35_vision: 'experimental',
      onnx_gemma4_vision: 'experimental',
    };
    const SECTION_ORDER: Section[] = ['photo_specialists', 'photo_generalists', 'experimental', 'audio'];

    const grouped = new Map<Section, typeof visiblePlugins>();
    for (const s of SECTION_ORDER) grouped.set(s, []);
    for (const p of visiblePlugins) {
      const section = SECTION_OF[p.id] ?? 'photo_generalists';
      grouped.get(section)!.push(p);
    }

    const t = (key: string) => {
      const tree = (((tr as unknown) as Record<string, Record<string, string>>).pipeline)[key];
      return tree ?? key;
    };

    function renderSection(section: Section, headerKey: string, plugins: Identifier[]): string {
      if (!plugins.length) return '';
      const warning = section === 'experimental'
        ? `<p class="text-xs text-amber-700 dark:text-amber-400 mb-2">${escapeAttr(t('experimental_warning'))}</p>`
        : '';
      const cards = plugins.map((p) => {
        const av = availabilityMap.get(p.id) ?? { ready: false, reason: 'unsupported' as const };
        const cache = cacheMap.get(p.id) ?? null;
        const isDisabled = disabled.includes(p.id);
        const state = deriveCardState({
          pluginId: p.id,
          runtime: p.capabilities.runtime,
          availability: av,
          isDisabled,
          cacheStatus: cache,
          byoKeysSet: byo.hasKeysForPlugin(p.id),
        });
        return renderPluginCard({
          lang,
          plugin: p,
          state,
          isDisabled,
          cacheStatus: cache,
          byoKeysSet: { /* extended by inline form on Add key click */ },
          sponsorship: p.id === 'claude_haiku' ? sponsorship : null,
        });
      }).join('');
      return `
        <li class="rastrum-section-header" role="presentation">
          <h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mt-4 mb-2">${escapeAttr(t(headerKey))}</h3>
          ${warning}
        </li>
        ${cards}
      `;
    }

    list.innerHTML = `
      ${renderSection('photo_specialists', 'section_photo_specialists', grouped.get('photo_specialists')!)}
      ${renderSection('photo_generalists', 'section_photo_generalists', grouped.get('photo_generalists')!)}
      ${renderSection('experimental',      'section_photo_generalists', grouped.get('experimental')!)}
      ${renderSection('audio',             'section_audio',             grouped.get('audio')!)}
    `;

    // Hide quick-setup banner when at least one non-PlantNet plugin is ready.
    const banner = document.getElementById('quick-setup-banner');
    const anyNonPlantNetReady = visiblePlugins.some(
      (p) => p.id !== 'plantnet' && availabilityMap.get(p.id)?.ready === true
    );
    if (anyNonPlantNetReady && banner) banner.classList.add('hidden');

    // Wire toggle buttons (delegated via data attribute).
    list.querySelectorAll<HTMLButtonElement>('[data-toggle-plugin]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.togglePlugin!;
        togglePluginDisabled(id);
        paintRegistry();
      });
    });

    // Wire Add key buttons (delegated). Opens an inline form (separate
    // mini-component; reuse the existing per-plugin form scheme).
    list.querySelectorAll<HTMLButtonElement>('[data-add-key], [data-edit-key]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.addKey ?? btn.dataset.editKey!;
        const plugin = reg.get(id);
        if (!plugin?.keySpec?.length) return;
        // Delegate to an existing mini-modal pattern; we reuse the
        // confirm-dialog wrapper as a key-entry dialog.
        const newKey = window.prompt(plugin.keySpec[0].label, byo.getKey(id, plugin.keySpec[0].name) ?? '');
        if (newKey == null) return;
        if (newKey.trim()) {
          byo.setKey(id, plugin.keySpec[0].name, newKey.trim());
        } else {
          byo.clearKey(id, plugin.keySpec[0].name);
        }
        await paintRegistry();
      });
    });

    // Re-bind the on-device download / delete / progress controls onto
    // their (now-painted) elements.
    wireOnDeviceControls();

    // Update pipeline-flow visualization.
    updatePipelineFlow(visiblePlugins.map((p) => ({
      id: p.id, name: p.name, brand: p.brand,
      capabilities: {
        media: p.capabilities.media,
        license: p.capabilities.license,
        confidence_ceiling: p.capabilities.confidence_ceiling,
      },
    })));
  }

  function escapeAttr(s: string): string {
    return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]!));
  }

  paintRegistry().catch(() => {});
```

A note on the `Add key` flow: a `window.prompt` is used as a v1 minimum. The richer inline form is a follow-up.

- [ ] **Step 2: Add the missing import for togglePluginDisabled**

Search the file for `togglePluginDisabled`. The existing block already imports it from `../lib/identifier-prefs`. If it's not available in scope of `paintRegistry`, add at the top of the script block (with other dynamic imports):

```typescript
const { getDisabledPlugins, togglePluginDisabled } = await import('../lib/identifier-prefs');
```

If those are already declared elsewhere in the same script as top-level const, no change needed. (Existing line: `src/components/ProfileEditForm.astro:1538`.)

- [ ] **Step 3: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Build**

Run:
```bash
npm run build
```

Expected: 231 pages, no errors.

- [ ] **Step 5: Run tests**

Run:
```bash
npm run test
```

Expected: all passing.

- [ ] **Step 6: Smoke-test the dev server**

Run:
```bash
npm run dev
```

Open `http://localhost:4321/en/profile/settings/ai/`. Confirm:
- Cards appear under section headers (📷 Specialists / 📷 Generalists / experimental warning / 🔊 Audio).
- Active Plant/Net card has `[Disable]` button.
- Phi/Gemma cards (currently Disabled by default) show `[Enable]`.
- Toggle clicks update card opacity + status pill without page reload.
- Pipeline preview chips reflect the current registry state.

Stop server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProfileEditForm.astro
git commit -m "refactor(profile-edit): paintRegistry renders unified cards

- Pre-resolve availability + cache status + sponsorship in parallel
- Run storage migration once per paint (idempotent after first call)
- Group plugins into 4 sections with experimental warning at section level
- Use renderPluginCard from lib/identifier-card-html
- Re-bind on-device download controls via wireOnDeviceControls() after innerHTML

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Delete static on-device card markup

**Files:**
- Modify: `src/components/ProfileEditForm.astro` (lines ~277–509, the static on-device sections)

After Task 5, paintRegistry generates these cards client-side. The static markup is dead code; delete it.

- [ ] **Step 1: Locate the static block**

Open `src/components/ProfileEditForm.astro`. Find the comment `<!-- On-device AI controls -->` (around line 277 after Phase B reorder, or 271 before). Find the matching closing for the offline maps block (`<!-- Offline maps — Mexico (pmtiles) -->` end div, around line 509).

- [ ] **Step 2: Delete the entire range**

Remove everything from `<!-- On-device AI controls -->` through and including the closing `</div>` of the offline maps block. The result should leave the `<!-- Legacy hidden field for BYO key migration -->` block intact and immediately followed by the `<!-- ── Confirmation modals ── -->` block.

- [ ] **Step 3: Verify the AI section still has its outer `</section>` close**

After the deletion, the `{showAI && (` wrapper opened around line 191 should still close with `</section>` and `)}`. If your edit broke the closing, fix it.

- [ ] **Step 4: Build to confirm Astro JSX is balanced**

Run:
```bash
npm run build
```

Expected: 231 pages built. If you see "Expected ')'" or "Unexpected token", the JSX braces are unbalanced; re-inspect Step 2.

- [ ] **Step 5: Smoke-test in dev server**

Run:
```bash
npm run dev
```

Open the AI tab. The cards should still appear (now generated by paintRegistry). The download buttons should work — open DevTools, click `Download (50 MB)` on BirdNET, watch the network tab.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProfileEditForm.astro
git commit -m "refactor(profile-edit): delete static on-device card markup

paintRegistry now generates these cards client-side; the static markup
was dead. Element IDs (vision-download, birdnet-status, etc.) remain
since renderPluginCard emits them.

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update ObservationForm.astro to use registry instead of localStorage

**Files:**
- Modify: `src/components/ObservationForm.astro`

Replace direct `localStorage.getItem('rastrum.prefs.usePhiVision')` style probes with calls into the identifier registry. Keeps lazy-load behavior because `isAvailable()` returns ready=false unless the model is cached AND the plugin isn't in `disabledPlugins`.

- [ ] **Step 1: Find all probe sites**

Run:
```bash
grep -n "rastrum.prefs.usePhiVision\|rastrum.prefs.useGemmaVision\|LOCAL_AI_OPTIN\|rastrum.localAiOptIn" src/components/ObservationForm.astro
```

You'll see ~5 hits. Note each line.

- [ ] **Step 2: Add a helper at the top of the script block**

Near the top of the `<script>` block (after the existing imports), add:

```typescript
// Registry-based replacement for localStorage probes. Returns true if
// the plugin is downloaded, opted-in (not in disabledPlugins), and
// supported on this device. Used to gate Phi / Gemma load attempts.
async function pluginReady(pluginId: string): Promise<boolean> {
  const [{ bootstrapIdentifiers }, prefs] = await Promise.all([
    import('../lib/identifiers'),
    import('../lib/identifier-prefs'),
  ]);
  const reg = bootstrapIdentifiers();
  const p = reg.get(pluginId);
  if (!p) return false;
  if (prefs.getDisabledPlugins().includes(pluginId)) return false;
  const av = await p.isAvailable();
  return av.ready;
}
```

- [ ] **Step 3: Replace the probe sites**

For each hit from Step 1, rewrite. Examples:

```typescript
// Before:
phi = s.cached && (localStorage.getItem('rastrum.prefs.usePhiVision') === 'true');
// After:
phi = await pluginReady('webllm_phi35_vision');
```

```typescript
// Before:
if (localStorage.getItem('rastrum.prefs.useGemmaVision') !== 'true') return;
// After:
if (!(await pluginReady('onnx_gemma4_vision'))) return;
```

```typescript
// Before:
const localAiOptIn = localStorage.getItem(LOCAL_AI_OPTIN) === 'true';
// After (the global opt-in is removed; the per-plugin readiness IS the gate):
const localAiOptIn = await pluginReady('webllm_phi35_vision') || await pluginReady('onnx_gemma4_vision');
```

If the surrounding function isn't async, make it async (and propagate `await` to its callers).

Remove the `const LOCAL_AI_OPTIN = ...` constant declaration.

- [ ] **Step 4: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected: clean. If you see "await is only allowed in async functions", you missed making a caller async.

- [ ] **Step 5: Run tests**

Run:
```bash
npm run test
```

Expected: all passing. Pay attention to any tests that mock `localStorage.rastrum.prefs.*` directly — they may need updating to mock the registry. If a test breaks, mock at `bootstrapIdentifiers()` boundary instead.

- [ ] **Step 6: Smoke test**

Open `http://localhost:4321/en/observe/`, upload a photo, watch the cascade. Phi shouldn't fire when disabled; should fire when enabled (via Settings → AI tab toggle).

- [ ] **Step 7: Commit**

```bash
git add src/components/ObservationForm.astro
git commit -m "refactor(observation-form): gate local AI via registry, not localStorage

Replaces direct localStorage probes for usePhiVision / useGemmaVision /
LOCAL_AI_OPTIN with await pluginReady(id) calls into the identifier
registry. Lazy-load behavior preserved (isAvailable returns ready=false
unless cached AND not disabled).

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Update ObserveView2.astro to use registry instead of localStorage

**Files:**
- Modify: `src/components/ObserveView2.astro`

Same pattern as Task 7, smaller file.

- [ ] **Step 1: Find all probe sites**

Run:
```bash
grep -n "rastrum.prefs.usePhiVision\|rastrum.prefs.useGemmaVision\|rastrum.localAiOptIn" src/components/ObserveView2.astro
```

- [ ] **Step 2: Add the same `pluginReady` helper at script top**

Copy the helper function from Task 7 Step 2 into the top of `ObserveView2.astro`'s `<script>` block. (We're not extracting it to a shared module because it's small and each component has its own script bundle anyway.)

- [ ] **Step 3: Replace each probe**

For each line found in Step 1, replace with `await pluginReady('<plugin-id>')`. Make enclosing functions async if needed.

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npm run test
```

Expected: clean + all passing.

- [ ] **Step 5: Smoke test**

Same flow as Task 7 — confirm Phi/Gemma respect the AI tab toggle without page reload.

- [ ] **Step 6: Commit**

```bash
git add src/components/ObserveView2.astro
git commit -m "refactor(observe-view2): gate local AI via registry, not localStorage

Same pattern as ObservationForm: pluginReady(id) helper replaces direct
localStorage probes. Removes the last reader of the legacy keys.

Refs spec: docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no legacy localStorage keys remain in codebase**

Run:
```bash
grep -rn "rastrum.prefs.usePhiVision\|rastrum.prefs.useGemmaVision\|rastrum.localAiOptIn\|LOCAL_AI_OPTIN\|LAI_OPTIN\|PHI_OPTIN\|GEMMA_OPTIN_KEY" src/ tests/ 2>/dev/null
```

Expected: zero hits in `src/` (only mentions allowed: `src/lib/identifier-state.ts` may reference the constant names as part of the migration). `tests/` may have one hit in the migration test asserting cleanup.

- [ ] **Step 2: Run the full pre-PR checklist**

Run:
```bash
npm run typecheck && npm run test && npm run build
```

Expected: clean / all passing / 231 pages built.

- [ ] **Step 3: Manually test the full lifecycle for one heavy model**

In dev server (`npm run dev`):
1. Open `http://localhost:4321/en/profile/settings/ai/`.
2. Find Phi-3.5-vision. State pill: `⏸ Disabled` (default).
3. Click the model's `Download (4.0 GB)` button (or skip if you don't want 4 GB).
4. Click `Enable`. State should flip to `Active`.
5. Reload page. State should still be `Active`.
6. Open DevTools → Application → Local Storage. Confirm:
   - `rastrum.disabledPlugins` does NOT contain `webllm_phi35_vision`.
   - `rastrum.prefs.usePhiVision` does NOT exist (migrated away).
   - `rastrum.localAiOptIn` does NOT exist.
7. Click `Disable`. State pill flips to `⏸ Disabled`. `rastrum.disabledPlugins` now contains `webllm_phi35_vision`.

- [ ] **Step 4: Test dark mode**

Toggle theme via header button. Confirm:
- Card surface is `zinc-900` against `zinc-950` page background.
- Active pill: emerald-400 text on emerald/15 background.
- Disabled pill: zinc-400 text on zinc-800 background.
- All buttons remain readable.

- [ ] **Step 5: Test ES locale**

Navigate to `http://localhost:4321/es/perfil/ajustes/ai/`. Confirm:
- Section headers in Spanish.
- Pill text in Spanish (`Activo`, `⏸ Desactivado`, `Sin descargar`).
- Action buttons in Spanish (`Activar`, `Desactivar`, `Eliminar`).

- [ ] **Step 6: Verify SpeciesNet is hidden**

Confirm SpeciesNet card does NOT appear in the registry list (matches Phase B behavior). Pipeline-flow chip strip should also exclude it.

- [ ] **Step 7: Push branch and open PR**

```bash
git push -u origin refactor/ai-tab-unified
gh pr create --base main --title "refactor(settings): unified AI tab plugin cards" --body "$(cat <<'EOF'
## Summary
- Collapses today's twin-card structure (registry + on-device download cards) into one unified card per plugin
- Migrates four legacy localStorage keys (\`rastrum.localAiOptIn\`, \`rastrum.prefs.usePhiVision\`, \`rastrum.prefs.useGemmaVision\`) into a single source of truth (\`rastrum.disabledPlugins\`)
- Groups plugins by media-type → specialist/generalist (📷 Photo Specialists / 📷 Photo Generalists / Experimental / 🔊 Audio / 🗂 Other local data)
- Surfaces sponsorship status on the Claude card itself (chip + sponsor handle + optional daily count)
- Reuses existing Tailwind tokens — no new color tokens

## Spec & brainstorm
- Design spec: \`docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md\`
- Visual mockups (private): \`.superpowers/brainstorm/\`

## Test plan
- [ ] Typecheck clean
- [ ] All vitest tests pass (1031 expected)
- [ ] \`npm run build\` produces 231 pages
- [ ] Manual smoke: download Phi → enable → reload → disable, confirms migration
- [ ] Dark mode parity verified
- [ ] ES locale verified
- [ ] SpeciesNet hidden when \`PUBLIC_SPECIESNET_WEIGHTS_URL\` unset

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Save it.

- [ ] **Step 8: Cleanup**

```bash
cd /Users/artemiopadilla/Documents/repos/GitHub/personal/rastrum
git worktree remove .worktrees/refactor-ai-tab-unified
```

Expected: worktree cleanly removed.

---

## Self-review notes

- **Spec coverage check.** Each spec section maps to a task: state machine + storage migration → Tasks 1, 7, 8; rendering → Task 2; layout grouping + section headers → Tasks 3, 5; dead static markup removal → Task 6; lifecycle wiring → Task 4. Sponsorship surfacing is integrated into Task 2 (renderer) + Task 5 (paintRegistry fetches it).
- **No placeholders.** Every step has either complete code or an exact command. The only "TODO-shaped" item is the v1 `window.prompt` for adding API keys (Task 5 Step 1) — explicitly noted as a v1 minimum with the richer inline form deferred. That's a deliberate scope decision, not a placeholder.
- **Type consistency.** `CardState` from `identifier-state.ts` is consumed by `renderPluginCard` (Task 2) and produced inside `paintRegistry` (Task 5) via `deriveCardState` — same type, same property names. Element IDs (`vision-download`, `birdnet-status`, etc.) match between `identifier-card-html.ts` (Task 2) and the existing on-device JS that Task 4 wraps.
- **Estimated effort.** ~1 day for an engineer following the plan: Tasks 1–3 ≈ 90 min, Tasks 4–6 ≈ 4 hours, Tasks 7–8 ≈ 90 min, Task 9 ≈ 30 min.
