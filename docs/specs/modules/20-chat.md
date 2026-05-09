# Module 20 — Conversational Chat (cascade interpreter + vision fallback + entity context)

**Status:** v1.1 (Gemma 4 text + entity context shipped 2026-05-09); v1.0 (shipped 2026-04-25)
**Code:** `src/components/ChatView.astro`, `src/lib/chat-attachment-helpers.ts`, `src/lib/chat-engine.ts`, `src/lib/chat-tools.ts`, `src/lib/chat-entities/`, `src/lib/chat-bubble-html.ts`, `src/lib/parse-attach-querystring.ts`
**Routes:** `/{en,es}/chat/` (with optional `?attach=<kind>:<id>` deep link)
**Spec/Plan:** `docs/superpowers/specs/2026-05-09-chat-improvements-design.md`, `docs/superpowers/plans/2026-05-09-chat-improvements.md`
**Runbook:** `docs/runbooks/chat-improvements.md`

## v1.1 additions (2026-05-09)

- **Gemma 4 E2B text backbone** — defaults over Llama-3.2-1B when WebGPU + ≥6 GB device memory; falls back to Llama on engine load failure (banner shown). Same weights as the existing vision identifier — one ~500 MB download powers both.
- **Two-button consent gate** — side-by-side cards let the user pick Gemma 4 (recommended, ~500 MB, stronger reasoning, also for photos) or Llama 3.2 1B (lighter, ~880 MB, text only) from /chat/ directly. `refreshState` checks BOTH caches.
- **Generic entity-context registry** (`src/lib/chat-entities/`) — `EntitySpec` interface mirrors the `Identifier` plugin pattern. Six built-ins: `observation`, `species`, `project`, `camera_station`, `observer`, `self_profile`. Each wraps a `supabase.rpc('chat_entity_card', { p_kind, p_id })` call returning a stable `EntityCard` JSONB.
- **Typed JSON tool layer** (`src/lib/chat-tools.ts`) — five read-only tools backed by Supabase RPCs (`chat_find_observations`, `chat_find_species`, `chat_find_projects`, `chat_find_camera_stations`, `chat_find_observers`). Hand-rolled validators (no Zod). 1-round cap per turn.
- **Streaming tool-call loop** (`src/lib/chat-engine.ts`) — model emits `{"tool":"…","args":{…}}` at the start of output; runtime detects, validates, dispatches, feeds the result back, re-prompts once.
- **Deep-link buttons** (`AskRastrumButton.astro`) — `💬 Ask Rastrum` on share-obs, public profile, project detail, species profile. Builds `/{lang}/chat/?attach=<kind>:<id>`; ChatView consumes the query string once and rewrites the URL via `history.replaceState`.
- **In-chat picker** (`ChatEntityPicker.astro`) — popover with 6 tabs and search, opens from the composer's `📋 Context` button.
- **Empty-state suggestion chips** — four pill buttons under the placeholder seed the input and submit on click.
- **Header model badge** — pill resolved client-side from cache status: "Gemma 4 · on-device" / "Llama 1B · on-device".
- **Mobile drawer** — Chat link added (was missing on `<sm` viewports).

### v1.1 SQL schema (in `docs/specs/infra/supabase-schema.sql`)

Twelve SECURITY INVOKER functions, all `LANGUAGE sql STABLE` (or `LANGUAGE plpgsql STABLE` for the dispatcher) with `SET search_path = public, extensions, pg_temp` and `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO authenticated`:

- `chat_entity_card(p_kind text, p_id text) → jsonb` — dispatcher routing by kind, swallows invalid uuid via `EXCEPTION WHEN invalid_text_representation`.
- `chat_obs_card(p_id uuid)` / `chat_species_card(p_query text)` / `chat_project_card(p_query text)` / `chat_camera_station_card(p_id uuid)` / `chat_observer_card(p_id uuid)` / `chat_self_profile_card(p_id uuid)` — per-kind builders.
- `chat_find_observations(p_filters jsonb, p_limit int)` / `chat_find_species` / `chat_find_projects` / `chat_find_camera_stations` / `chat_find_observers` — read-only filtered searches.

### v1.1 privacy invariants

- **Observation cards respect obscure_level.** Precise lat/lng returned only when `auth.uid() = observer_id`; everyone else gets the obscured centroid. `coords_obscured` field uses `IS DISTINCT FROM` for NULL-safe comparison.
- **`chat_self_profile_card` is self-only.** Filter `WHERE id = p_id AND id = auth.uid()`. Other-user lookups return NULL.
- **Observer cards via `community_observers` view** — never raw `users` (no centroid, no email, no `hide_from_leaderboards = true`).
- **Tool args are validated, never interpolated.** Hand-rolled validators reject non-objects, wrong types, missing required fields. RPCs receive typed args.

### v1.1 deferred to v1.2

- Multi-round tool-calling (chains).
- Guided writes ("apply this fix" buttons) — needs typed action contract + audit log + undo.
- `location` entity kind — waits for `public.locations` from the locations-first-class spec.
- ChatView decomposition (1,441 LOC → 4 sibling components).
- Per-row Ask Rastrum buttons on MyObs cards.
- E2E specs for deep-link + picker.
- Streaming token-deltas from Gemma 4 (currently one chunk per turn).

---

## v1.0 (original — cascade interpreter + vision fallback)


The chat page is a single-screen "ask Rastrum about this" surface. Users
attach a photo or short audio clip, optionally type a free-form question,
and get a natural-language reply. Behind the chat bubble the page runs the
identifier cascade and uses a 1B-parameter on-device LLM to turn the
structured cascade result into prose. When the cascade returns nothing
useful (no plugin available, audio unrecognised, or photo confidence
< 0.4) the page falls back to a vision-LLM that reads the picture
directly.

The chat is **not** a research-grade entry point — it never writes to
`observations`. To turn a chat-derived ID into a saved observation the
page hands the cascade result + media blob URL off to `/observe` via
`sessionStorage`. See "Observe-page handoff" below.

---

## Why a separate surface from `/identify` and `/observe`

| Surface | Purpose | Saves obs | Cascade | LLM |
|---|---|---|---|---|
| `/identify` | "What is this?" no-friction probe | no | PlantNet-only direct call | none |
| `/chat` | Conversational, photo/audio + free text | no | full cascade (excl. Phi-vision) | yes — Llama interprets, Phi/Claude as vision fallback |
| `/observe` | Logged observation with GPS/notes | yes (Dexie outbox) | full cascade | none |

Chat is the **only** surface that fuses identification with a free-form
language model. Keeping it separate from `/observe` lets the form stay
predictable for power users while the chat absorbs the "what's the bird
that just flew by?" use case.

---

## Architecture

```
attachment (photo|audio Blob)
       │
       ├── runCascade({ media, mediaKind, byo_keys: {} }, opts)
       │   ├── opts honors per-plugin isAvailable() — Phi + Gemma each
       │   │   self-gate on their opt-in pref so they only run when the
       │   │   user has explicitly enabled them in Profile → Edit.
       │   └── (PR #644) the chat picker can also force a single plugin
       │       (PlantNet / Claude / Phi / Gemma / EfficientNet) or fan
       │       out to "Compare all" — bypassing the cascade.
       │       → { best, alternates }
       │
       ├── if best.confidence ≥ 0.4
       │       └── Llama-3.2-1B prose interpretation streamed into bubble
       │
       └── else (cascade failed or low-confidence on a photo)
               └── runVisionFallback(att, userText, onUpdate)
                     ├── Phi-3.5-vision on-device (preferred when cached)
                     └── Claude Haiku BYO key (network fallback)
```

**Models:**

- **Llama-3.2-1B** (instruct, q4f16_1, ~700 MB). The "interpreter" — never
  identifies; just turns `{scientific_name, confidence, source, …}` into
  2-4 sentences in EN or ES. See [`11-in-browser-ai.md`](11-in-browser-ai.md).
- **Phi-3.5-vision** (q4f16_1, ~2.4 GB). On-device vision-LLM used as the
  "looking more carefully" fallback when the cascade returns nothing or
  confidence < 0.4. Same model used by the `webllm_phi35_vision` plugin
  but invoked directly (with a chat-style prompt) rather than via the
  identifier interface.
- **Claude Haiku 4.5** via BYO key — network fallback if the user has not
  downloaded Phi-vision but has set `byo.anthropic`. Same vision payload
  shape as the cascade plugin, different prompt.

**Confidence threshold:** `ACCEPT_LOW = 0.4` in `ChatView.astro`. Matches
the `enforce_research_grade_quality` trigger so chat replies and saved
observations agree on the quality bar.

---

## Data flow

1. **Attach.** `chat-photo-input` (with `capture="environment"`),
   `chat-gallery-input`, or `chat-audio-input` (audio MIME via
   `MediaRecorder`). One attachment per turn — adding a new one replaces
   the chip.
2. **Submit.** User types optional text, hits send. The page renders a
   user-side bubble with the attachment thumbnail and text, and a
   placeholder bot bubble.
3. **Cascade.** `runAttachmentCascade(att)` calls `runCascade()` from
   `src/lib/identifiers/cascade.ts` with the unified `buildCascadeOptions`
   result. Phi and Gemma are *not* hardcoded-excluded any more (PR #644
   dropped that hack); both runtimes self-gate via their `isAvailable()`
   on a per-runtime opt-in pref, so they only run when the user has
   explicitly enabled them. For audio, `taxa: 'Animalia.Aves'` is set
   (BirdNET only handles birds today).
4. **Interpret.** If `best.confidence ≥ 0.4`, the page builds a
   `buildCascadeInterpretationPrompt(...)` and streams the Llama reply
   into the placeholder bubble. The bubble also gets a "Save as
   observation" footer (`renderCascadeFooter`) with the species + a
   sources line.
5. **Vision fallback.** If the cascade fails on a photo, `runVisionFallback`
   tries Phi-3.5-vision (on-device, prompts for download via
   `<dialog>` if not cached) and finally Claude Haiku BYO. Audio with no
   confident match has no fallback — the page surfaces the cascade's
   alternates instead.
6. **Save handoff.** The "Save as observation" button writes a
   `PendingObservation` JSON blob to
   `sessionStorage[rastrum.pendingObservation]` and navigates to
   `/observe`. The form picks up the blob URL, MIME, top species,
   confidence and pre-fills its fields. See
   `src/lib/chat-attachment-helpers.ts → buildPendingObservation /
   parsePendingObservation`.

---

## File map

| File | Purpose |
|---|---|
| `src/components/ChatView.astro` | UI shell, composer, conversation log, inline scripts. ~925 lines. |
| `src/lib/chat-attachment-helpers.ts` | Pure helpers: prompt builders, `PENDING_OBSERVATION_KEY`, `pluginIdToObservationSource`. Side-effect free for unit tests. |
| `src/lib/chat-attachment-helpers.test.ts` | Vitest coverage for both prompt builders and the pending-observation round-trip. |
| `src/pages/{en,es}/chat.astro` | Locale-paired entry points; both render `<ChatView lang />`. |
| `src/lib/identifiers/cascade.ts` | The cascade engine the page calls. |
| `src/lib/local-ai.ts` | `loadTextEngine` (Llama) + `loadVisionEngine` (Phi-vision) + cache helpers. |

---

## Privacy

The chat page inherits the cascade's privacy model:

- **Photos.** Sent to PlantNet (if the plugin is available and the user
  has a key) and/or Anthropic (only if the user has a BYO Claude key).
  Never logged server-side. Phi-vision and the on-device cascade run
  entirely in-browser — no network egress.
- **Audio.** BirdNET-Lite is on-device only (model weights live on R2,
  inference runs in `onnxruntime-web`). Audio never leaves the device.
- **Free-text.** Stays in-browser. The Llama interpreter runs locally;
  no chat history is persisted (clearing the page or hitting "Clear"
  empties the in-memory `conversation[]`).
- **Save handoff.** When the user accepts "Save as observation" the
  page writes a blob URL to `sessionStorage`. That URL is local to the
  tab; it expires when the tab closes.

There is no `chat_sessions` table at v1.0. The Scout v0 module
([`docs/progress.json` → `scout-v0`](../../progress.json)) plans a
server-side chat with pgvector RAG; that is a separate spec.

---

## Edge cases

| Case | Behaviour |
|---|---|
| No LLM downloaded, no BYO key | Cascade still runs; the bubble shows a structured fallback (top species + alternates) without the prose layer. The consent gate prompts for download. |
| Attachment too large | Photos are not resized client-side here (the cascade plugins resize internally). Audio is capped at the `MediaRecorder` 30 s limit shared with `ObservationForm`. |
| Multiple attachments | The composer accepts one chip at a time. Adding a new file replaces the previous chip. To run the cascade on a fresh photo the user submits, then attaches again. |
| Audio + photo in same message | Not supported — the chip is single-attachment. The backlog allows it but the cascade engine takes one media kind per call. |
| Cascade returns no `best`, only alternates | The page renders alternates with their plugin sources. The "Save as observation" footer is hidden. |
| Phi-vision download cancelled | The `<dialog>` resolves to `cancel`, the page falls back to Claude Haiku BYO if a key is set, otherwise renders a "no-match" message. |
| Private-mode `sessionStorage` | The `try { sessionStorage.setItem(...) } catch {}` swallows the error; the user sees the species in chat but the save handoff silently no-ops. |
| Slow / failed Llama load | The placeholder bubble keeps the structured cascade summary; the prose layer is best-effort. |

---

## Tests

- `src/lib/chat-attachment-helpers.test.ts` covers:
  - `buildCascadeInterpretationPrompt` — top match formatting,
    alternates filtering, locale-aware language hint, common-name
    selection, confidence "below 40%" guard.
  - `buildVisionFallbackPrompt` — locale + user text inclusion.
  - `buildPendingObservation` / `parsePendingObservation` — round-trip
    through JSON, defensive parsing of malformed blobs, kind enum
    enforcement.
  - `pluginIdToObservationSource` — every plugin id maps to a valid
    `IDSource` value.

The browser-side surface (mic capture, dialog, streaming Llama tokens)
is intentionally not unit-tested. Light Playwright smoke coverage in
`tests/e2e/chat.spec.ts` (if added) is the right place.

---

## Cost / risk notes

- Llama and Phi-vision are downloaded once per device (~700 MB and
  ~2.4 GB respectively) into the WebLLM IndexedDB cache. The page
  calls `requestPersistentStorage()` indirectly via
  `local-ai.ts` to resist iOS eviction.
- The cascade fan-out for photos is unchanged from `/observe` — same
  per-call PlantNet / Anthropic costs. Phi and Gemma stay off the
  primary path by being opt-in only (their respective `isAvailable()`
  return `disabled` unless the user has flipped the toggle in
  Profile → Edit), which matters on low-end Android.
- No server cost: the chat path never hits an Edge Function.
