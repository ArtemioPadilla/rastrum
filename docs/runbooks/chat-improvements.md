# Chat improvements (2026-05-09 release)

Operator notes for the Gemma-text + entity-context chat redesign.

## What shipped

- **Gemma 4 E2B as text-chat backbone** — alongside Llama-3.2-1B.
  Defaults to Gemma when WebGPU + ≥6 GB device memory; falls back to
  Llama on engine load failure (banner shown). Same weights as the
  vision identifier — one ~500 MB download covers both.
- **Entity context** — chat can be deep-linked or in-chat picked from
  six entity kinds: observation, species, project, camera_station,
  observer, self_profile.
- **Five typed tools** (`find_observations`, `find_species`,
  `find_projects`, `find_camera_stations`, `find_observers`).
  1-round cap per turn.
- **In-chat picker** with 6 tabs (📋 button in the composer).
- **Deep-link buttons** on the share-obs page, public profile,
  project detail, and species profile pages.
- **Mobile drawer** — Chat link added (was missing on `<sm` viewports).

## Known limits (v1.1 follow-ups)

- Multi-round tool-calling (chains of tool calls) is capped at 1 round.
- No guided writes — chat surfaces no "apply this fix" buttons.
- `location` entity kind deferred until the locations-first-class
  schema lands.
- Streaming token-deltas from Gemma 4 emit as one chunk per turn
  (transformers.js streamer hookup is a v1.1 polish).
- ChatView decomposition (1,441 LOC → 4 sibling components) deferred —
  the new entity wiring is in-place. Existing photo/audio cascade,
  voice input, and model picker are untouched.
- MyObs cards don't have per-row Ask Rastrum buttons. Use the in-chat
  picker to attach an observation from the list.

## Smoke checks

After deploy:

- [ ] `/en/chat/?attach=observation:<known-id>` — chip renders, URL cleaned.
- [ ] `/en/chat/?attach=species:<taxa-uuid>` — chip renders.
- [ ] In-chat picker (📋 button) opens, tabs switch, search filters.
- [ ] Cross-entity follow-up: attach an obs, ask "find similar nearby" —
      model emits a tool call, results render.
- [ ] Offline: airplane mode → attached obs Q&A still works; tool call
      shows offline footer.
- [ ] Mobile drawer (≡ on `<sm`) shows the Chat section.
- [ ] Mobile composer with chip + photo attachment both staged.
- [ ] Gemma fallback: corrupt the OPFS Gemma cache, reload chat,
      observe the Llama-fallback banner.

## Telemetry events

Listen on `window` for `rastrum:onboarding-event` with these
`detail.type` values:

- `chat.entity.attached` `{ kind, source: "deep-link"|"picker" }`
- `chat.tool.called` `{ tool_name, ok }`
- `chat.tool.failed` `{ tool_name, reason }`
- `chat.engine.fallback` `{ from, to }`

Wire to your analytics in `BaseLayout.astro` if needed; the chat does
not call any analytics service directly.

## Rotating the schema

The new SQL functions live in `docs/specs/infra/supabase-schema.sql`
near the bottom (lines ~9908–10416). Re-applying with `make db-apply`
is safe (idempotent). The schema-security lint
(`infra/lint-schema-security.sql`) enforces the SECURITY INVOKER +
REVOKE PUBLIC + search_path invariants on every PR.

## SQL regression

`tests/sql/chat.sql` runs in `db-validate.yml` after every PR that
touches the schema. Cases include obscure-coords branching,
self-profile RLS gate, find_observations owner filter, and dispatcher
fallthrough on unknown kinds.

## Implementation files

- **SQL:** `docs/specs/infra/supabase-schema.sql` (chat_entity_card
  dispatcher + 6 per-kind builders + 5 chat_find_* functions).
- **Entity registry:** `src/lib/chat-entities/` (types, registry, 6
  EntitySpecs, bootstrap).
- **Tool layer:** `src/lib/chat-tools.ts` (5 tools + dispatcher with
  hand-rolled validators).
- **Engine:** `src/lib/chat-engine.ts` (Gemma default + Llama fallback
  + 1-round tool-call loop). `src/lib/local-ai.ts` exports
  `loadGemmaTextEngine`. `src/lib/onnx-vision.ts` exports
  `generateGemmaText`.
- **Helpers:** `src/lib/chat-bubble-html.ts` (escapeHtml,
  entityChipHtml, canonicalEntityUrl), `src/lib/parse-attach-querystring.ts`.
- **Components:** `src/components/ChatEntityPicker.astro`,
  `src/components/AskRastrumButton.astro`. ChatView + MobileDrawer
  modified in-place.
