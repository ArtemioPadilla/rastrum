# Module 21 — Identify (no-save quick probe)

**Status:** v1.0 (shipped 2026-04-25)
**Code:** `src/components/IdentifyView.astro`
**Routes:** `/{en,es}/identify/` (`/en/identify/`, `/es/identificar/`)

The `/identify` page is the lowest-friction "what is this?" surface in
Rastrum. The user picks a photo, the page asks PlantNet, the page
renders the top match plus alternates. **It never saves.** That choice
is deliberate — `/observe` is the right surface for a logged
observation, and `/chat` is the right surface for a free-form
conversation. `/identify` exists for the hallway naturalist who wants
the answer in two taps and is gone.

---

## Why deliberately narrow

| Surface | Saves obs | Cascade scope | LLM | Friction |
|---|---|---|---|---|
| `/identify` | no | PlantNet only | none | 2 taps (camera/gallery → result) |
| `/chat` | no (handoff) | full cascade (excl. Phi) | Llama interpreter | 2 taps + reply latency |
| `/observe` | yes (Dexie outbox) | full cascade | none | full form |

The page intentionally does **not** call `runCascade()`. PlantNet is
chosen as the single gateway because:

1. It's the cheapest plugin to run on a stranger's phone — no model
   download, no Anthropic billing, just a single REST call.
2. It returns a clean top-N list with common names per locale, which
   maps trivially to the page's "top match + others" layout.
3. The page would otherwise need to handle Phi-vision consent, BYO
   Claude prompts, and BirdNET audio handoff — all of which already
   exist on `/chat` or `/observe`.

If a user wants the full cascade, the page links them to `/observe`
explicitly:

> "Quick identify, no save. Want to log a full observation with location?
> Go to the observation form."

---

## Architecture

```
file (camera or gallery)
       │
       ├── resolvePlantNetKey()
       │     ├── window.__RASTRUM_PLANTNET_KEY__   // dev injection
       │     ├── import.meta.env.PUBLIC_PLANTNET_KEY  // build-time
       │     └── byo-keys.getKey('plantnet','plantnet')  // user-supplied
       │
       └── POST https://my-api.plantnet.org/v2/identify/all?api-key=<k>&lang=<lang>&nb-results=5
             body: FormData { images: <file>, organs: 'auto' }
             timeout: 20 s (AbortController)
       └── renderResults(top, alternates)
```

There is no Edge Function in the path. The page calls PlantNet directly
from the browser. The key is resolved client-side from three sources, in
order of preference. If no key is found, the page renders an inline
amber notice pointing the user to `/profile/edit`.

---

## File map

| File | Purpose |
|---|---|
| `src/components/IdentifyView.astro` | Single-file UI + script. ~183 lines. |
| `src/pages/en/identify.astro` | EN entry, mounts `<IdentifyView lang="en"/>`. |
| `src/pages/es/identificar.astro` | ES entry, same component, `lang="es"`. |
| `src/lib/byo-keys.ts` | Per-plugin key store, used as the third resolver. |

The page does not depend on `src/lib/identifiers/`. Adding a new plugin
to the registry has no effect on `/identify`. That's a feature.

---

## i18n / EN-ES parity

The page is bilingual but renders inline ES strings for two messages
(amber "no key" notice and the link CTA) because they reference
locale-specific routes (`/perfil/editar/` vs `/profile/edit/`). All
other strings come from `tr.identify.*` and `tr.observe.*`.

Routes are declared in `src/i18n/utils.ts → routes.identify`:

```ts
identify: { en: '/identify', es: '/identificar' }
```

---

## Edge cases

| Case | Behaviour |
|---|---|
| No PlantNet key (env, BYO, or window) | Amber notice with a link to `/{lang}/{profile-edit}` and `getDocPath(lang, 'features')`. No network call. |
| PlantNet returns 0 results | "No matches. Try another photo, closer or with better light." |
| PlantNet HTTP error | Renders `Error: PlantNet HTTP <status>` in red. The 20 s `AbortController` timeout surfaces as `Error: ABORT_ERR`. |
| Non-plant photo | PlantNet still returns plant guesses with low scores. The page does not gate on confidence — the user sees the % and can decide. The page does not redirect to Claude/Phi-vision. |
| Camera not available | The `capture="environment"` hint falls back to a normal file picker on desktop browsers. |
| HTML injection in API response | `escapeHtml(s)` is applied to every species name, common name, and error message before innerHTML insertion. |

---

## Privacy

- The photo is uploaded **to PlantNet only**, identified by the user's
  own API key. Rastrum's servers never see the image.
- No `observations` row is written. Nothing persists beyond the in-memory
  preview URL (revoked when the page navigates away).
- The 20 s timeout is short on purpose — a stalled call should fail loud
  rather than hang on a metered connection.

The page is safe to use signed-out and offline-capable up to the
network call.

---

## Tests

The page is intentionally unit-test-thin: `escapeHtml` and the rendering
paths are exercised by manual / Playwright coverage. The shared
`byo-keys` resolver path is covered by `src/lib/byo-keys.test.ts`. If a
future change introduces a non-trivial transform on PlantNet results, it
should land in a `identify-helpers.ts` so we can unit-test it without
the DOM.

---

## When to extend

If `/identify` ever needs:

- **Audio support** — re-route the user to `/observe` instead. The
  cascade is already there.
- **Phi-vision fallback** — that's `/chat`. Don't recreate it here.
- **Saving** — that's `/observe`. The "Save" button on the page
  should remain a link, not a form.

The page is a hallway probe. Keep it that way.
