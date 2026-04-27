# Module 20 — Conversational Chat (cascade interpreter + vision fallback)

**Status:** v1.0 (shipped 2026-04-25)
**Code:** `src/components/ChatView.astro`, `src/lib/chat-attachment-helpers.ts`
**Routes:** `/{en,es}/chat/`

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
       ├── runCascade({ media, mediaKind, byo_keys: {} },
       │              { excluded: ['webllm_phi35_vision'] })
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
   `src/lib/identifiers/cascade.ts` with `excluded: ['webllm_phi35_vision']`
   so the slow Phi pass doesn't happen on the primary path. For audio
   the `taxa: 'Animalia.Aves'` filter is set (BirdNET only handles
   birds today).
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
  per-call PlantNet / Anthropic costs. Setting `excluded:
  ['webllm_phi35_vision']` keeps the slow Phi pass off the primary
  path, which matters on low-end Android.
- No server cost: the chat path never hits an Edge Function.
