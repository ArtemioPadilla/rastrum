# Chat improvements — design

> Date: 2026-05-09
> Scope: `/{en,es}/chat/` — entity-context Q&A, Gemma 4 text backbone, ChatView decomposition
> Status: design approved; ready for implementation plan

## Context

The chat surface today (`src/components/ChatView.astro`, 1,441 LOC) is an on-device biodiversity assistant. It runs Llama-3.2-1B for text generation and Phi-3.5-vision / Gemma 4 E2B / EfficientNet / PlantNet / Claude Haiku for photo identification. Conversation history lives only in this device's IndexedDB (`chatTurns` Dexie store).

Three gaps the user has surfaced:

1. **Gemma 4 is wired as an identifier plugin but not as a text-chat backbone.** Gemma 4 E2B is a multimodal VLM and a stronger reasoner than the 1B-param Llama. The chat picker already exposes Gemma for vision; text chat still goes through Llama exclusively.
2. **There is no path to "chat about" an existing entity.** The chat can produce a "Save as observation" CTA after a photo cascade, but it cannot *receive* an existing observation, species, project, camera station, observer, location, or self-profile as conversational context.
3. **`ChatView.astro` is the largest single component in the repo.** Composer, picker, bubble rendering, cascade interpretation, audio recorder, voice input, and i18n bag all live in one file. Adding entity context on top would push it past 2,000 LOC.

The brainstorm settled five upstream questions:

- **Entry points** — both deep-link from entity surfaces AND in-chat picker.
- **Entity scope** — observations, species, projects, camera stations, observers, locations, self-profile (one `EntitySpec` interface, six built-ins, generic registry).
- **Behaviors** — Q&A, cross-entity follow-ups, drafting, Rastrum-guru help. **Read-only.**
- **Writes deferred** — guided actions ("apply this fix") become a separate v1.1 spec. Privileged writes need their own action contract, confirmation flow, RLS verification, and audit log.
- **Architecture** — entity card on attach + typed JSON tool calls for follow-ups (not eager system-prompt stuffing, not local RAG).

## Decision

Ship a single coordinated change that does four things together because none of them stand alone usefully:

1. Add **Gemma 4 E2B as a text-chat backbone** (Llama stays as fallback).
2. Add a **generic `EntitySpec` registry** with six built-in kinds and a stable `EntityCard` contract.
3. Add a **typed JSON tool layer** (`chat-tools.ts`) with six tools backed by Supabase RPCs.
4. **Decompose `ChatView.astro`** into orchestrator + four sibling components.

Writes are explicitly out of scope. Multi-round tool calling is explicitly out of scope (1-round cap in v1).

## Architecture

```
                          ┌─────────────────────────────────────────────┐
   User entity surfaces ──▶  Deep-link "Ask Rastrum" buttons             │
   (obs, species, etc.)   │  Pre-attach an entity ref in chat URL/state  │
                          └─────────────────────────────────────────────┘
                                       │
                                       ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  ChatView.astro (slimmed) + new ChatComposer.astro              │
   │  + ChatEntityPicker.astro + ChatEntityChip.astro                │
   └─────────────────────────────────────────────────────────────────┘
                  │                         │
                  ▼                         ▼
   ┌─────────────────────────┐   ┌─────────────────────────────────┐
   │ src/lib/chat-engine.ts  │   │ src/lib/chat-entities/          │
   │ (model dispatch:        │   │   registry.ts  (entity types)   │
   │  Gemma text default,    │   │   types.ts     (EntitySpec)     │
   │  Llama fallback)        │   │   *.ts         (per-entity)     │
   └─────────────────────────┘   └─────────────────────────────────┘
                  │                         │
                  ▼                         ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  src/lib/chat-tools.ts  — typed JSON tool dispatcher            │
   │  Tools: find_observations, find_species, find_projects,         │
   │         find_camera_stations, find_observers                    │
   └─────────────────────────────────────────────────────────────────┘
                  │
                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  Supabase RPCs (existing views + thin SECURITY INVOKER funcs)   │
   │    chat_entity_card(kind, id) → JSONB                           │
   │    chat_find_observations(filters) → SETOF compact rows         │
   │    chat_find_species(query) → SETOF compact rows                │
   │    …                                                             │
   └─────────────────────────────────────────────────────────────────┘
```

### Five load-bearing decisions

1. **One `EntitySpec` interface; six built-ins.** Mirrors the existing `Identifier` plugin pattern at `src/lib/identifiers/`. Each entity type registers `{ kind, label, fetchCard, suggestedTools }`. Adding a 7th type = one file + `register()` call.
2. **Tools are typed JSON, not free-text.** Model returns `{"tool":"find_observations","args":{…}}`. Runtime validates against a hand-rolled validator (no new Zod dependency — Rastrum doesn't use Zod elsewhere). Bad calls return `{error}` to the model so it can self-correct.
3. **Gemma 4 text becomes the default chat backbone.** New `loadGemmaTextEngine()` in `local-ai.ts` reuses the transformers.js path the vision plugin already uses. Llama stays as fallback for low-RAM devices and as the streaming engine for the cascade-interpretation path (which already works there and is tightly coupled to Llama's prompt shape).
4. **Chat-tools run client-side over Supabase, not as Edge Functions.** Each tool is a thin `supabase.rpc(...)` call. RLS is the security boundary — chat queries as the signed-in user. No new Edge-Function surface to deploy.
5. **`ChatView.astro` decomposes into orchestrator + 4 siblings.** 1,441 LOC → ~400 LOC orchestrator + `ChatComposer` + `ChatEntityPicker` + `ChatEntityChip` + `ChatBubble`. Each independently testable.

## Components

### New components (Astro)

- **`src/components/ChatComposer.astro`** (~250 LOC). Owns icons + textarea + send + attachment chip + model picker. Dispatches `chat:attach-photo`, `chat:attach-audio`, `chat:attach-entity`, `chat:submit`. One reason to change.
- **`src/components/ChatEntityPicker.astro`** (~180 LOC). Popover triggered from composer's "📋 Attach context" button. Tabs: Observations / Species / Projects / Stations / Observers / Locations. Each tab queries one Supabase RPC for the user's recent rows. Search input filters within the active tab. Selecting a row dispatches `chat:attach-entity` and closes.
- **`src/components/ChatEntityChip.astro`** (~80 LOC). Compact representation of an attached entity inside the composer and inside historical bubbles. Shows kind icon + label + remove "×". Click opens the entity's canonical page in a new tab.
- **`src/components/ChatBubble.astro`** (~150 LOC). Bubble rendering + cascade footer + compare footer + bubble actions. Pure render, no fetches.
- **`src/components/AskRastrumButton.astro`** (~30 LOC). Deep-link button. Drops into `ShareObsView`, `MyObsItem`, `SpeciesProfileView`, `ProjectDetailView`, `CameraStationItem`, `PublicProfileView`, `LocationDetailView`. Builds `/{lang}/chat/?attach={kind}:{id}`.

### New libs (TypeScript)

- **`src/lib/chat-entities/types.ts`** — `EntityKind`, `EntityCard`, `EntitySpec` interfaces.
- **`src/lib/chat-entities/registry.ts`** — singleton registry with collision detection (mirrors `identifiers/registry.ts`).
- **`src/lib/chat-entities/{observation,species,project,camera-station,observer,location,self-profile}.ts`** — one file per built-in. Each exports an `EntitySpec` that knows how to fetch its card and which tools are most useful for its kind.
- **`src/lib/chat-entities/index.ts`** — `bootstrapChatEntities()` — single call from ChatView mount.
- **`src/lib/chat-tools.ts`** — tool registry + dispatcher. `runTool({name, args})` returns `{ok, data} | {error}`. Each tool has a hand-rolled `validateArgs(args)` and a `run(args)`. Five tools at v1: `find_observations`, `find_species`, `find_projects`, `find_camera_stations`, `find_observers`. (Karma and self-profile data ride inside the `self_profile` entity card; no separate tool needed.)
- **`src/lib/chat-engine.ts`** — model dispatch. `getActiveEngine(): 'gemma'|'llama'`, `streamChat(messages, tools)`. Wraps `loadGemmaTextEngine()` + `loadTextEngine()`. Owns the tool-call loop (parse JSON, dispatch tool, append result, re-prompt — 1 round cap).
- **`src/lib/local-ai.ts`** — extended with `loadGemmaTextEngine(onProgress)`. Reuses transformers.js path from the existing vision plugin.

### Schema additions

In `infra/supabase-schema.sql`, six SECURITY INVOKER functions:

- `chat_entity_card(p_kind text, p_id text) → jsonb` — dispatcher to per-kind card builders based on `p_kind`.
- `chat_find_observations(p_filters jsonb, p_limit int) → setof jsonb`
- `chat_find_species(p_query text, p_limit int) → setof jsonb`
- `chat_find_projects(p_query text, p_limit int) → setof jsonb`
- `chat_find_camera_stations(p_project_id uuid, p_limit int) → setof jsonb`
- `chat_find_observers(p_query text, p_limit int) → setof jsonb`

All grant EXECUTE to `authenticated`. Anon gets nothing — chat-with-context is signed-in only. Each function pins `search_path = public, extensions, pg_temp` per the schema-security invariant the lint guard already enforces.

### Modified components

- **`src/components/ChatView.astro`** — slims from 1,441 → ~400 LOC. Becomes pure orchestrator: mounts new components, holds `conversation: ChatTurn[]`, wires events, persists to Dexie. Cascade-interpretation streaming + audio/photo paths move into `ChatBubble` and `chat-engine` respectively.
- **`src/components/ProfileEditForm.astro`** — adds a "Gemma 4 (text chat)" download card mirroring the existing Phi/Llama cards. Reuses the model-cache UI pattern.
- **`src/i18n/en.json` + `es.json`** — new keys under `chat.entities.*`, `chat.tools.*`, `chat.attach_entity_*`. EN/ES parity required.

### What stays put

- `src/lib/chat-history.ts`, `chat-attachment-helpers.ts`, `chat-hint.ts` — unchanged.
- The existing identifier cascade (`identify-runners.ts`, etc.) — unchanged. Chat tools query *for* observations, they don't replace identification.

## Data flow

### Flow A — Deep-link entry

```
1.  User clicks "💬 Ask Rastrum" on /share/obs/?id=X
2.  Browser navigates to /en/chat/?attach=observation:X
3.  ChatView mount reads `?attach=`, validates kind ∈ EntityKind
4.  fetchEntityCard('observation', X)  →  supabase.rpc('chat_entity_card', {p_kind, p_id})
5.  RPC returns { kind, id, label, summary_text, fields, suggested_questions }
6.  ChatView dispatches chat:attach-entity → ChatComposer renders chip
7.  ChatComposer also seeds the input with one suggested_question (greyed placeholder)
8.  User edits or accepts → submits → chat-engine streams reply
```

The querystring is consumed once; ChatView replaces it with `history.replaceState` so a refresh doesn't re-attach.

### Flow B — In-chat picker entry

```
1.  User clicks "📋 Attach context" in composer
2.  ChatEntityPicker opens, default tab = Observations
3.  Picker calls supabase.rpc('chat_find_observations', {p_filters: {owner: 'me'}, p_limit: 20})
4.  User picks a row → picker dispatches chat:attach-entity, closes
5.  Same fetchEntityCard path as Flow A from step 4
```

### Flow C — Conversation turn with tools

```
1.  User submits text (with attached entity card)
2.  chat-engine builds messages:
       system: CHAT_SYSTEM_PROMPT + tool definitions JSON-schema
       system: [Context] <entity card serialized as plain text>
       (history of prior turns, each ≤120 tokens)
       user:   <text>
3.  chat-engine.streamChat() begins streaming from Gemma (or Llama fallback)
4.  Model emits either prose OR a tool call:
       {"tool":"find_observations","args":{"species":"Setophaga magnolia","near":"obs:X","radius_km":50}}
5.  If a tool call is detected (lookahead match on `{"tool":`), runtime stops streaming,
    validates args, dispatches via runTool() → supabase.rpc(...)
6.  Tool result appended as a `tool` role message; model is re-prompted (single round-trip)
7.  Final prose streams into the bubble; tool_calls are persisted on the turn
    (rendered as a collapsed "🔧 Looked at 3 observations" footer)
```

**Tool-call loop is capped at 1 round per user turn in v1.** Multi-round (model emits tool call → result → another tool call) is a v1.1 follow-up. Stops the model from spiralling.

### Flow D — Offline degrade

- `fetchEntityCard` fails → composer shows "Couldn't load context — try when online" and the chip is removed. User can still chat without context.
- Tool dispatch fails (network) → tool returns `{error: "offline"}` — model says "I can't look that up right now" and answers from the entity card it already has.
- The chat itself stays alive offline because Gemma/Llama run on-device; only the entity layer needs network.

### Entity-card schema

Stable contract — every entity kind serializes to the same shape:

```ts
interface EntityCard {
  kind: 'observation' | 'species' | 'project' | 'camera_station'
       | 'observer' | 'location' | 'self_profile';
  id: string;                  // uuid for db rows; slug for species/projects
  label: string;               // 1-line display ("Setophaga magnolia · May 8 · CDMX")
  thumbnail?: string;          // optional 64×64 R2 URL
  summary_text: string;        // ≤500 chars, plain prose; what the model "reads"
  fields: Record<string,        // key/value for structured rendering in the chip popover
    string | number | boolean | null>;
  suggested_questions: string[]; // 2–3 EN/ES strings keyed off the entity kind + locale
  related: {                   // typed pointers the model can use as tool args
    project_id?: string;
    primary_taxon_id?: string;
    location_id?: string;
    observer_id?: string;
  };
}
```

### Conversation persistence

- `ChatTurnRecord` (Dexie store, already exists) gets two optional new fields: `entity_attachment?: { kind, id, label }` and `tool_calls?: Array<{name, args, result}>`.
- The full entity card is **not** persisted on every turn — only the lightweight `entity_attachment`. On rehydrate, ChatView re-fetches the card if needed.
- Existing `CHAT_HISTORY_LIMIT = 50` stays.

## Error handling

| Failure mode | Behavior | Surfacing |
|---|---|---|
| `?attach=…` with unknown `kind` or non-uuid `id` | Silently drop the param, render plain chat | No error UI |
| `chat_entity_card` RPC returns 404 (entity gone, RLS hides it) | Toast "Couldn't find that {kind}", chip not added | Toast (existing `notify()` helper) |
| `chat_entity_card` RPC throws (network/server) | Show "Try again when online", composer unblocked, no chip | Inline composer error (existing `chat-attach-error` element) |
| Picker tab fetch fails | Empty list + "Couldn't load — try again" with retry button | In-tab inline message |
| Model emits tool call with invalid JSON | Treat as prose, append hidden system note, re-prompt **once**, then give up | Silent recovery |
| Tool args fail validator | Append `{"error":"invalid_args","detail":…}` as tool result; model gets one more chance | Footer shows "🔧 (failed) find_observations" |
| Tool RPC throws | `{"error":"network"}` fed back; model recovers in prose | Footer shows "🔧 (offline) find_observations" |
| Model exceeds 1-round tool-call cap | Drop subsequent tool calls, force prose | No user-visible error |
| Gemma engine fails to load | Auto-fallback to Llama, log a warn-once to console | Banner: "Using lighter model — Gemma unavailable" |
| Both engines fail | Disable composer, show consent gate again | Existing path |

## Privacy invariants (load-bearing)

1. **Observation cards respect `obscure_level`.** `chat_obs_card` reads from `obs_public_read` (which already enforces this), not raw `observations`. For sensitive species, precise coords are returned only when the requester is the observer; everyone else receives the obscured centroid. Implemented as `CASE WHEN auth.uid() = observer_user_id THEN <precise> ELSE <obscured> END` in the RPC.
2. **Observer cards are public-fields only.** `chat_observer_card` joins `community_observers` (the public view) — no email, no centroid, no private profile fields. Self-profile is a separate `kind = self_profile` that pulls private fields gated by `auth.uid() = id`.
3. **Tool args are validated, not interpolated.** Chat tools never construct SQL — they pass typed args to RPCs. Prevents prompt-injection-as-SQL-injection from a hostile entity card.
4. **Chat content stays on-device.** Already true. Adding entity attachments doesn't change that — the entity *card* travels through Supabase, but the conversation transcript still lives only in Dexie.
5. **`function_errors` audit on RPCs.** Every chat-tool RPC writes through the existing `function_errors` sink on exception — same pattern admin EFs use. Lets us see misuse without logging conversation content.

## Performance budgets

- **Entity-card fetch** ≤200 ms p95 (single-row RPC over warm Supabase).
- **Picker first-paint** ≤150 ms (skeleton if slower).
- **Gemma 4 E2B text load** one-time ~500 MB download via existing transformers.js cache; subsequent loads <2 s.
- **Per-turn token budget**:
  - System + tools schema: ≤600 tokens
  - Entity card serialised: ≤500 tokens
  - History: last 6 turns, each truncated to 120 tokens → ≤720
  - User text: free
  - Reserve 1024 for output → fits comfortably in Gemma 4's 8k context with headroom
- **`ChatView.astro` size** target ≤500 LOC after decomposition.

## Telemetry (no PII)

Piggybacks the existing onboarding-event bus pattern — no new analytics dep:

- `chat.entity.attached` `{ kind, source: 'deep-link'|'picker' }`
- `chat.tool.called` `{ tool_name, ok }`
- `chat.tool.failed` `{ tool_name, reason: 'validation'|'network'|'rls' }`
- `chat.engine.fallback` `{ from: 'gemma', to: 'llama' }`

## Testing

### Unit (Vitest)

- `src/lib/chat-entities/registry.test.ts` — collision detection, register/lookup, bootstrap idempotency. Mirrors `identifiers/registry.test.ts`.
- `src/lib/chat-entities/observation.test.ts` — entity-card serializer with mocked RPC: obscure_level coarsening, owner-vs-non-owner branch, missing media handling.
- `src/lib/chat-entities/{species,project,camera-station,observer,location,self-profile}.test.ts` — one happy-path + one RLS-denied test each.
- `src/lib/chat-tools.test.ts` — args validator (good/bad inputs per tool), dispatcher round-trip with mocked Supabase, `{error: 'offline'}` propagation.
- `src/lib/chat-engine.test.ts` — mocked Gemma stream emitting:
  1. Pure prose → bubble assembled correctly
  2. Single tool call → dispatch → re-prompt → final prose
  3. Tool call with invalid JSON → fallback to prose
  4. Tool call with bad args → error result fed back, model recovers
  5. Two tool calls in one turn → second is dropped (1-round cap)
  6. Gemma load fails → Llama fallback engaged, warning emitted
- `src/lib/local-ai.test.ts` — extend with `loadGemmaTextEngine` (mocked at the transformers.js boundary, same pattern as `local-ai.test.ts`).
- `src/lib/chat-history.test.ts` — extend for the new optional fields.
- `src/lib/chat-attachment-helpers.test.ts` — keep existing tests; add tests for `parseAttachQuerystring` (querystring → `{kind, id}` validator).

### Component tests (happy-dom via Vitest)

- `tests/unit/chat-entity-picker.test.ts` — tab switch fires the right RPC; selection dispatches `chat:attach-entity`; empty state renders.
- `tests/unit/chat-composer.test.ts` — chip render/remove; suggested-question seeding; "📋" button toggles picker; existing photo/audio paths still work.
- `tests/unit/ask-rastrum-button.test.ts` — builds correct deep-link URL per locale + entity kind.

### SQL pgTAP (`infra/sql-tests/chat.sql`)

Wired into the existing `db-validate.yml` Postgres-17 service container.

- `chat_entity_card('observation', X)` returns coarsened coords for non-owner of an obscured species.
- `chat_entity_card('self_profile', uid)` rejects when `auth.uid() != uid`.
- `chat_find_observations` respects RLS — anon gets nothing.
- `chat_find_observers` returns from `community_observers` (no centroid).
- All six new functions have explicit `REVOKE EXECUTE … FROM PUBLIC` + `GRANT TO authenticated`.
- Idempotency: drop+create the functions twice in the test, second pass must succeed.

### E2E (Playwright)

Two specs added to the intentionally minimal suite. Both run on chromium + mobile-chrome.

- `tests/e2e/chat-deep-link.spec.ts` — sign-in via test fixture, navigate to a seeded `/share/obs/?id=…`, click "Ask Rastrum", assert chip is present in composer with the expected label, assert URL was rewritten (no `?attach=` after).
- `tests/e2e/chat-entity-picker.spec.ts` — open chat directly, click "📋", switch to Species tab, type, pick a row, assert chip appears.

Tool-call flows are NOT in E2E — they need a deterministic model output and would be flaky; those are unit-tested with mocks.

### Manual smoke checklist (in the runbook)

- Deep-link from each entity surface (obs / species / project / station / observer / location / self profile).
- Picker tab switching, search, EN+ES copy.
- Cross-entity follow-up: attach an obs, ask "find similar observations nearby", assert the model emits a tool call and the result renders.
- Offline: airplane mode → obs already attached → Q&A still works; "find similar nearby" → graceful failure.
- Mobile composer with chip + attachment chip both staged.
- Gemma fallback: corrupt the OPFS Gemma cache, reload chat, observe the Llama-fallback banner.

### Regression guards

- `scripts/check-define-vars-imports.sh` already runs in CI.
- The schema-security lint (`infra/lint-schema-security.sql`) already runs in `db-validate.yml` — automatically covers the new RPCs' `search_path` + `REVOKE PUBLIC` requirements.
- No new CI workflows needed.

## Out of scope (v1.1 follow-ups)

- **Guided actions / writes.** Chat surfacing "Apply this fix" buttons that perform privileged writes. Needs its own typed action contract, confirmation step, RLS verification, audit log, undo semantics.
- **Multi-round tool calling.** Model emits tool call → result → *another* tool call in the same user turn. The 1-round cap is a deliberate v1 floor.
- **Local RAG over Dexie.** Embedding model + vector index for fully-offline entity Q&A. YAGNI for v1; the on-device card already covers offline Q&A about the *attached* entity.
- **Chat history sync.** Conversations remain device-local — no cross-device sync, no Supabase persistence.
- **Voice output.** Speech recognition (input) is already wired; speech synthesis (output) is not in scope.

## Open questions

None remaining at design close. All architectural forks resolved during brainstorm.

## References

- `src/components/ChatView.astro` — current 1,441-LOC monolith.
- `src/lib/local-ai.ts` — text + vision engine loaders.
- `src/lib/identifiers/` — pattern the entity registry mirrors.
- `docs/specs/modules/11-in-browser-ai.md` — the in-browser AI module spec.
- `docs/specs/modules/13-identifier-registry.md` — pattern for plugin registries.
- `infra/lint-schema-security.sql` — schema-security invariants the new RPCs must satisfy.
