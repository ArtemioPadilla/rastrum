# AI settings tab redesign — unified plugin cards

**Date:** 2026-05-07
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Related modules:** 13 (identifier registry / cascade), 25 (privacy — BYO key handling), 32 (multi-provider vision + sponsor pools).

---

## Goals

1. Collapse the AI settings tab's twin-card structure (registry list + on-device download cards) into **one card per plugin**, with one toggle and one truthful status pill. Users currently navigate three independent toggles per heavy on-device plugin (registry "Disable", per-plugin `phi-vision-enable` checkbox, global `local-ai-optin`); this spec replaces them with a single source of truth.
2. Group cards by **media type → specialization**, mirroring how `runCascade()` actually filters plugins (`📷 Photo Identifiers · Specialists / Generalists`, `🔊 Audio Identifiers`, `🗂 Other local data`).
3. Hide plugins that **can never run** in the current deployment (e.g., SpeciesNet without `PUBLIC_SPECIESNET_WEIGHTS_URL`) — both from the registry list and the pipeline-flow preview.
4. Move sponsorship discovery **onto the Claude card itself** (`Use sponsorship` button when no source set; `via sponsorship · 47/100 IDs today` chip when active).
5. Keep dark + light mode parity using **only the Tailwind tokens already in `ProfileEditForm.astro`** — no new color tokens.

## Non-goals

- User-reorderable cascade. The cascade order remains deterministic (`sortForCascade()` by license cost ascending, confidence ceiling tiebreak). Letting users drag plugins around invites footguns (paid before free).
- Unifying Llama-3.2-1B into the cascade. It's a text helper for translation + chat, not a species identifier; it stays on the AI tab in its own `Other local data` group with a clearly different framing.
- Replacing the WebLLM/MLC runtime for Llama, or routing translation through Gemma instead. That's a separate consolidation discussion (mentioned in conversation; not part of this spec).
- Migrating cloud-side identifier behavior. The Edge Function `identify` and resolution order (BYO → personal sponsorship → platform pool → skip) are unchanged.
- Restructuring `[tab].astro` route file or moving routes. The AI tab stays at `/{en,es}/profile/settings/ai/`; ES tab path uses `ajustes` per existing convention.
- Re-pricing the cards' iconography. Each plugin keeps its current `brand` emoji from the registry.

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Card abstraction | **One unified card per plugin** | Today's two-card structure forces three toggles per on-device plugin; users have no single answer to "will this run when I press Identify?" |
| Section grouping | **By media type → specialist/generalist** (📷 / 🔊 / 🗂) | Mirrors `runCascade()`'s actual filter order. Specialists (PlantNet, MegaDetector) before generalists (Claude, Phi, Gemma, EfficientNet) matches the cascade's confidence-ceiling sort. |
| Heavy-model warning | **Once at section header, not per-card** | "Experimental — may crash on Apple Silicon Metal / Chromium 147+; confidence capped 0.35" applies to Phi *and* Gemma collectively. Per-card repetition is noise. |
| Llama placement | **AI tab, separate `Other local data` group** | It's still an AI download (download-card UX is consistent there) but framed honestly as "Not part of species identification." |
| Status pill vocabulary | **`Active` / `⏸ Disabled` / `No key` / `Not downloaded` / `⏳ N%` / `⚠ Unsupported`** | Drops today's mismatched mix of `Configured · edit`, `Coming soon`, `Disabled`, `Ready`. Pill always equals the operative state. |
| Default state after download | **Active** (no extra opt-in step) | Today users download then have to find a separate `Use Phi Vision in cascade` checkbox. Removing the step matches the user's intent (they downloaded *because* they wanted to use it). |
| "Not downloaded" cards | **Show only `[Download · 4.0 GB]` primary action — no Disable toggle** | Nothing to disable until the bytes are on disk. Reduces visual clutter for the resting state. |
| Disable preserves state | **Disable does NOT delete cache, key, or sponsorship** | Re-enable is one click; "delete" is its own destructive button. |
| Cascade order | **Stays deterministic** | User-reorderable cascade is a footgun. Pipeline preview is read-only with the caption "Order is automatic — free models try first." |
| Sponsorship surfacing | **E2: Inline secondary action on the Claude card** | When no source set: `[Use sponsorship]` next to `[Add key]`. When active: `via sponsorship · 47/100 IDs today` chip + `[Switch to BYO key]` ghost button. |
| SpeciesNet visibility | **Hide when `PUBLIC_SPECIESNET_WEIGHTS_URL` unset** | Plugin returns `model_not_bundled` from `isAvailable()` in that state — it can never run. Card is filtered from registry rendering and pipeline-flow preview. |
| Dark/light mode | **Reuse existing Tailwind tokens** (`bg-zinc-900`, `border-zinc-800`, `emerald-500/15` pill, `opacity-60` for disabled cards) | Existing `ProfileEditForm.astro` patterns; no new tokens. |

---

## Architecture

### Component shape

A TypeScript template function `renderPluginCard(props): string` lives in `src/lib/identifier-card-html.ts`. It produces the HTML for a card given resolved state. This matches the existing pattern in `ProfileEditForm.astro:1623-1719` where cards are built as template strings and joined into the `<ul id="identifier-list">` via `list.innerHTML`. We extract it so the template is testable and reusable; we do **not** introduce an `<Astro>` component because the cards live entirely inside a client-side `<script>` block (no SSR pass).

**XSS:** all plugin-controlled strings — `plugin.name`, `plugin.description`, `plugin.brand`, `plugin.capabilities.taxa[*]`, `availability.message`, `sponsorship.sponsor_handle` — pass through a single `escape()` helper before reaching innerHTML. Numeric fields (sponsorship counts, cache bytes) are formatted via `String(n)` / `bytesHuman(n)` and stay numeric; no quote characters can survive. Tests in `identifier-card-html.test.ts` assert that `<script>` and `<img onerror=...>` payloads injected into plugin name/description/sponsor handle are HTML-encoded in the output.

```ts
export interface PluginCardProps {
  lang: 'en' | 'es';
  plugin: Identifier;                    // from src/lib/identifiers/types.ts
  // NOTE (#719): the implementation uses `state: CardState` (pre-derived via
  // deriveCardState()) instead of raw `availability: AvailabilityResult`.
  // This was refined during implementation — state derivation was extracted
  // into identifier-state.ts so the same logic is shared between the UI and
  // cascade gates. The spec below reflects the actual implementation.
  state: CardState;                      // pre-derived by paintRegistry via deriveCardState()
  isDisabled: boolean;                   // from rastrum.pipeline.disabled
  cacheStatus: ModelCacheStatus | null;  // for on-device plugins
  byoKeysSet: Record<string, boolean>;   // per-key-name presence map
  sponsorship: ActiveSponsorship | null; // only meaningful for plugin.id === 'claude_haiku'
  plantnetQuota?: PlantNetQuota | null;  // only meaningful for plugin.id === 'plantnet'
}

export function renderPluginCard(props: PluginCardProps): string;
```

**Llama-3.2-1B and the offline map** aren't in the identifier registry — they're just downloads on the same surface. Rather than overload `Identifier` with a `synthetic: true` flag (review feedback from #673), they get a separate, smaller helper:

```ts
export interface LocalDataCardProps {
  lang: 'en' | 'es';
  id: string;                       // 'llama-3.2-1b' | 'offline-map-mx'
  name: string;
  description: string;              // single-line caption
  brand?: string;                   // emoji
  cacheStatus: ModelCacheStatus | null;
  /** Element id prefix that the on-device JS expects (e.g. 'text', 'pmtiles'). */
  domIdPrefix: string;
}
export function renderLocalDataCard(props: LocalDataCardProps): string;
```

It produces the same Tailwind-styled card shape as `renderPluginCard` but with no toggle, no key form, and no sponsorship affordance — just download/delete/progress controls keyed by `domIdPrefix` so the existing on-device JS keeps binding to `text-download` / `pmtiles-download` etc.

### State derivation (single source of truth)

A new `src/lib/identifier-state.ts` exposes:

```ts
type CardState =
  | { kind: 'active' }
  | { kind: 'disabled' }                              // user-flipped
  | { kind: 'no-key' }                                // cloud, missing required key
  | { kind: 'not-downloaded' }                        // on-device, no cache
  | { kind: 'downloading'; pct: number; mb: { current: number; total: number } }
  | { kind: 'unsupported'; reason: 'webgpu' | 'memory' | 'env-missing' };

export function deriveCardState(input: Props): CardState;
```

`deriveCardState` is pure; consumed by both the rendering function and `ObserveView2.astro` / `ObservationForm.astro` (they currently probe `localStorage.rastrum.prefs.usePhiVision` directly — they switch to asking the registry).

### Storage migration

**Preserving the old opt-in semantics is critical** (review feedback from #673). OLD behavior: `webllm_phi35_vision` only ran when `localStorage.rastrum.prefs.usePhiVision === 'true'` exactly. Any other value — `'false'`, missing, malformed — meant *not running*. The migration MUST preserve that: every user who is *not* running Phi today must continue *not* running it tomorrow.

Concretely: treat `null` (key never set) and `'false'` (explicit opt-out) identically — both add the plugin id to `disabledPlugins`. Only `'true'` keeps the plugin out of `disabledPlugins`. This avoids surprise activations.

To avoid polluting brand-new browsers (no legacy keys at all) with synthetic disable entries, the migration short-circuits if none of the three legacy keys is present in localStorage. New users hit the new UI directly and get the standard `Disable` toggle UX without baggage.

Today's keys, with their fates:

| Key | Today | After |
|---|---|---|
| `rastrum.disabledPlugins` | array of plugin ids the cascade should skip | **Source of truth.** Unchanged. |
| `rastrum.localAiOptIn` | umbrella opt-in for "use on-device when no cloud key" | **Removed.** Each plugin's own enable state is sufficient. |
| `rastrum.prefs.usePhiVision` | per-plugin enable for Phi | **Removed.** Migrated at startup: if `usePhiVision === 'true'`, leave Phi out of `disabledPlugins`; if `'false'` *or any other value present*, add `webllm_phi35_vision` to `disabledPlugins`. Then delete the old key. |
| `rastrum.prefs.useGemmaVision` | per-plugin enable for Gemma | **Removed.** Same migration as Phi → `onnx_gemma4_vision`. |
| `rastrum.byoKeys` | per-plugin BYO keys | **Unchanged.** |

Migration runs once on first AI-tab load after the upgrade. Idempotent: re-running is a no-op because the legacy keys are deleted on first run. Brand-new browsers skip migration entirely (no legacy keys present).

### File touches

- **New:** `src/components/PluginCard.astro` (~220 lines including embedded Tailwind classes for all 6 states).
- **New:** `src/lib/identifier-state.ts` (~80 lines, `deriveCardState` + types + the migration runner).
- **Heavy edit:** `src/components/ProfileEditForm.astro` — `paintRegistry` becomes the orchestrator: resolve availability for all plugins, run the migration once, render `<PluginCard>` per plugin grouped by section, wire up event handlers via delegation. Static on-device card markup (`#vision-download` / `#birdnet-download` / etc.) is **deleted**; the JS that bound to those IDs (~700 lines from line ~826 to ~1554) is wrapped in a `wireOnDeviceControls(rootEl)` function called from `paintRegistry` after the unified cards are inserted.
- **Light edit:** `src/components/ObserveView2.astro` and `src/components/ObservationForm.astro` — replace direct `localStorage.getItem('rastrum.prefs.usePhiVision')` and `localStorage.getItem(LOCAL_AI_OPTIN)` probes with `registry.get('webllm_phi35_vision')` + `!disabledPlugins.includes(...)` + `(await isAvailable()).ready`. The lazy-load behavior ("only spin up Phi when user has it enabled") is preserved because `isAvailable()` returns ready=false unless cached AND not disabled. Net behavior identical; one source of truth.
- **i18n:** `src/i18n/{en,es}.json` — new `pipeline.section.*` keys for the four group headers and the experimental warning. Existing strings (`tr.auth.local_ai_*`, `tr.auth.birdnet_*`, etc.) are reused or retired in line with the markup they belonged to.

### Layout

The static `{showAI && (...)}` block becomes:

```
<section> [ Pipeline preview (read-only chips, by media type) ]
<section> 📷 Photo identifiers · Specialists
  <PluginCard plantnet />
  <PluginCard megadetector_camera_trap />
<section> 📷 Photo identifiers · Generalists
  <PluginCard claude_haiku />
  <PluginCard onnx_efficientnet_lite0 />
  [Experimental section header with shared warning]
  <PluginCard webllm_phi35_vision />
  <PluginCard onnx_gemma4_vision />
<section> 🔊 Audio identifiers
  <PluginCard birdnet_lite />
<section> 🗂 Other local data
  <SyntheticCard llama-3.2-1b />
  <SyntheticCard offline-map-mx />
```

`<SyntheticCard>` is a thin variant of `<PluginCard>` for items that aren't in the identifier registry (Llama text helper, offline maps). Same visual style, no `Disable` toggle (only `[Re-download]` and `[Delete]` for cached, or `[Download]` for not-cached).

---

## Data flow

### Photo identification (cascade run)

1. User submits a photo from `ObservationForm.astro`.
2. `ObservationForm` calls `runCascade(input, options)` where `options.excluded = [...getDisabledPlugins()]` from `identifier-prefs.ts`. **No more localStorage probes for `usePhiVision` / `useGemmaVision`.**
3. Cascade filters by media type, then by `excluded`, then by `isAvailable()`. Plugins with `model_not_bundled` are skipped silently.
4. First plugin to return confidence ≥ 0.7 wins; otherwise the best-of-set is returned.

### AI tab paint

1. User opens `/{en,es}/profile/settings/ai/`. Static markup renders skeleton (group headers + `<li>Loading…</li>`).
2. `paintRegistry()` runs:
   1. `runStorageMigration()` — moves any legacy `rastrum.prefs.use{Phi,Gemma}Vision` flags into `rastrum.disabledPlugins` and deletes them. Idempotent.
   2. Pre-resolve `availability = Map<id, AvailabilityResult>` for all registered plugins via `Promise.all`.
   3. Filter out plugins where `availability.get(id)?.reason === 'model_not_bundled'`.
   4. Sort surviving plugins by `DISPLAY_ORDER` (cloud first, then on-device light → heavy, then experimental).
   5. Render `<PluginCard>` per plugin into the appropriate section by `(media, taxa, runtime)`.
   6. Render `<SyntheticCard>` for Llama and offline-map.
   7. Call `wireOnDeviceControls(listEl)` to bind download / delete / progress listeners to the now-existing element IDs. (Element IDs preserved from today's static markup so the existing JS keeps working.)
3. User toggles `Enable` / `Disable`: `togglePluginDisabled(id)` → `paintRegistry()` re-runs.
4. User clicks `Download (4.0 GB)`: existing on-device JS handles download via `local-ai.ts` / `*-cache.ts`; on success, `paintRegistry()` re-runs to flip the card to `Active`.

### Sponsorship resolution (Claude card)

1. On paint, fetch the user's active sponsorship via existing `lib/sponsorships.ts` (returns `{ provider: 'anthropic', sponsor_handle, daily_limit, used_today } | null`).
2. If no key AND no sponsorship → show `[Use sponsorship]` + `[Add key]` buttons. `[Use sponsorship]` deep-links to `/{en,es}/profile/sponsored-by/`.
3. If sponsorship active → status pill = `Active`, additional `via sponsorship` chip, meta line shows `sponsored by @sponsor`. Daily usage `· N/M IDs today` is appended only when `daily_limit` and `used_today` are both populated by `getActiveSponsorship()`. The button is `[Use my own key]` (ghost) — clicking expands the inline key form.
4. If both BYO key AND sponsorship are configured → BYO key wins (matches server-side resolution order). Card shows `Active` with a small `BYO key (sponsorship as fallback)` chip.

---

## Error handling

- **Download failure** (network, CORS, disk full): card transitions to `⚠ Unsupported` state with the failure message inline (`Disk full`, `Model server unreachable`, etc.). User can retry via `[Download]` button.
- **WebGPU unavailable**: heavy on-device cards (Phi, Gemma) immediately render in `⚠ Unsupported` state with text `Needs WebGPU. Try Chrome 113+ or Safari 17+.`. The light on-device cards (EfficientNet, MegaDetector via WASM) are unaffected.
- **localStorage quota exceeded** during migration: log a `console.warn`, skip the migration this session, leave old keys in place. Next visit retries. Users keep working with old behavior in the meantime.
- **`getActiveSponsorship()` 4xx/5xx**: card falls back to "no sponsorship" UI. Doesn't block the rest of the AI tab from rendering.
- **Plugin's `isAvailable()` throws**: caught and treated as `{ ready: false, reason: 'unsupported', message: e.message }`. Pill shows `⚠ Unsupported` with the message.

---

## Testing

### New unit tests

- `tests/unit/identifier-state.test.ts`
  - `deriveCardState` for each of the 6 states across cloud + on-device plugin shapes.
  - `runStorageMigration` is idempotent (running twice doesn't duplicate disable entries).
  - Migration handles missing keys, `'true'` keys, `'false'` keys, malformed values.
- `tests/unit/profile-edit-paint-registry.test.ts`
  - SpeciesNet without `PUBLIC_SPECIESNET_WEIGHTS_URL` → `availability.reason === 'model_not_bundled'` → filtered from `visiblePlugins` and `updatePipelineFlow`.
  - Sort order produces `[plantnet, claude_haiku, onnx_efficientnet_lite0, ...]`.

### Existing tests to keep passing

- All 1022 tests in `tests/unit/`. Especially `cron-auth.test.ts` (streak-push), `local-ai.test.ts` (Llama mocking), and any `cascade.test.ts` (sortForCascade unchanged).

### Manual smoke

- Toggle each plugin Enable/Disable; confirm `runCascade()` skips disabled ones.
- Download Phi → page should render `Active` immediately (no separate opt-in step).
- Open AI tab on a fresh browser with the legacy `rastrum.prefs.usePhiVision = 'false'` set; after first paint, key should be gone and `webllm_phi35_vision` should appear in `rastrum.disabledPlugins`.
- Dark + light mode visual check on each state of each card type.

---

## Migration / rollout

1. **Phase B already shipped** (separate PR — branch `refactor/ai-tab-cleanup`): removes the SpeciesNet "Coming soon" card, sorts the registry, fixes the Streak/Security tab leaks. Reviewed and on hold pending this redesign.
2. **Phase A (this spec):**
   - One PR. Lands the new `<PluginCard>`, `<SyntheticCard>`, `identifier-state.ts`, and the `ProfileEditForm.astro` rewrite.
   - Migration runs once per browser on first AI-tab load. Logged to `console` via the existing `[rastrum]` prefix.
   - Rollback: revert the PR. Old localStorage keys are gone (migration deleted them) but the old code's `?? false` defaults make absent-key the same as `false` (on-device plugin disabled), so rollback users see Phi/Gemma in the Disabled state and can re-enable. Acceptable — they lost their old preference but didn't break.
3. **No DB / Edge Function changes.** Pure client-side.
4. **No CI changes.** Existing typecheck + vitest + build CI catches regressions.
5. **No new dependencies.** Reuses existing onnx-runtime-web, transformers.js, WebLLM/MLC, supabase-js, MapLibre.

---

## Risks

| Risk | Mitigation |
|---|---|
| `wireOnDeviceControls` binds before unified cards exist if execution order changes | Call sequence is explicit: `paintRegistry` `await`s availability resolution + DOM insertion *before* calling `wireOnDeviceControls(listEl)`. New helper function takes the just-painted root element so binding is local. Type-safe. |
| Migration runs at the wrong time (before plugin list loads) | Migration only touches localStorage keys; it doesn't depend on the registry. Safe to run first. |
| User had Phi enabled, post-migration it shows Disabled | Migration reads old key `'true'` and explicitly *does not* add to `disabledPlugins`, so card stays Active. Test case covers this. |
| Sponsorship card section flickers (no sponsorship → loaded) | Render the Claude card first with `[Add key] [Use sponsorship]` skeleton; replace with `via sponsorship` chip after `getActiveSponsorship()` resolves. Same pattern as the Bell badge. |
| ObservationForm + ObserveView2 fail to find a plugin's enable state | They now use the registry's `isAvailable()` + `disabledPlugins`. Both APIs are already exported and tested. |
| Theme tokens behave differently in production CDN cache | We're reusing existing tokens that have shipped for months. No risk. |

---

## Open questions

1. **Sponsorship fallback when BYO key fails.** If a user has both a BYO key and an active sponsorship, and the BYO key returns 401 (e.g., revoked at console.anthropic.com), should the cascade fall back to the sponsorship for that one call? Today it doesn't. This spec keeps current behavior. Worth a follow-up.
2. **Llama re-platforming.** Whether to eventually retire WebLLM/MLC by routing translation through Gemma via transformers.js — discussed in conversation, deferred to its own spec.
3. **Quota visibility for PlantNet.** Currently the card meta says `500/day free`. We don't actually surface the user's used-quota number anywhere. Not in scope here, but a clean follow-up: a small `347 / 500 IDs today` chip on the PlantNet card matching Claude's sponsorship chip.
