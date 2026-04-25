# Module 11 — In-Browser AI (WebLLM)

**Version target:** v0.3 (text helpers) → v0.5 (vision fallback)
**Status:** Code shipped — opt-in per user; models downloaded on demand.
**References:** [LexMX](https://github.com/ArtemioPadilla/LexMX) (WebLLM patterns).

---

## Overview

Rastrum integrates the [MLC WebLLM runtime](https://github.com/mlc-ai/web-llm)
to run small language and vision-language models **fully on-device**, using
WebGPU. Two purposes:

1. **Identification fallback** when the user has neither a server-side
   `ANTHROPIC_API_KEY` (operator-set) nor a client-side BYO key
   (user-provided in profile/edit). Uses `Phi-3.5-vision-instruct`.
2. **Text helpers** for translation (ES↔EN), narrative field-note
   generation, and local search over the user's own observation history.
   Uses `Llama-3.2-1B-Instruct`.

Implemented in `src/lib/local-ai.ts`. Wired into `src/lib/sync.ts`'s
identify pipeline and into `src/components/ProfileEditForm.astro` (the
opt-in UI).

---

## Anthropic key — three configurations

The `identify` Edge Function (module 01) now accepts an optional
`client_anthropic_key` in the request body. The decision tree:

| Server `ANTHROPIC_API_KEY` set? | Client BYO key set? | Behaviour |
|---|---|---|
| ✅ | (any) | Server key used. Cost billed to operator. |
| ❌ | ✅ | Client key forwarded to Anthropic for this single call. Cost billed to user's Anthropic account. Key never persisted server-side. |
| ❌ | ❌ | Edge Function returns `{"error":"no_id_engine_available"}`. Client checks `localStorage['rastrum.localAiOptIn']`; if true, runs Phi-3.5-vision locally; otherwise queues for manual ID. |

The BYO key lives in the browser only (`localStorage['rastrum.byoAnthropicKey']`).
Each `identify` call forwards it once, in the request body, over HTTPS to
the Edge Function. The function uses it for the Anthropic call, then
forgets it. **Never stored in any database. Never logged.**

---

## Models

### Phi-3.5-vision-instruct-q4f16_1-MLC

**Why this model.** Currently the only vision-language model in WebLLM's
prebuilt list. ~3.95 GB VRAM, ~3.5 B params, accepts `{image_url, text}`
multipart messages exactly like Anthropic / OpenAI APIs do.

**Why we cap its confidence at 0.4.** Phi-3.5-vision was *not* trained on
taxonomic data. It will confidently hallucinate species names, especially
for Neotropical taxa. The database trigger
`enforce_research_grade_quality_trigger` blocks observations with
`confidence < 0.4` from ever reaching research-grade — Phi's output is
locked under that ceiling, so it never contaminates the citizen-science
dataset.

**What it's good for in Rastrum:**
- Last-resort offline ID when no Claude/PlantNet access exists
- Coarse "is this a plant / animal / fungus / unknown?" pre-filter
- Caption generation for the observation form ("describe what you see")

**What it's not good for:**
- Authoritative species ID. Use PlantNet + Claude.
- Sensitive species (NOM-059) detection. The hallucination risk here is a
  conservation-safety concern — never use Phi for that path.

### Llama-3.2-1B-Instruct-q4f16_1-MLC

**Why this model.** Smallest WebLLM-prebuilt that gives coherent
multilingual responses for short prompts. ~880 MB VRAM, low-resource
flag, runs on integrated GPUs and modest phones.

**What it's good for:**
- Translating short observation notes between Spanish and English
- Generating field-note narratives from structured observation data
- Local NLU on the user's own observation history ("show me my mushroom
  observations from October")

**What it's not good for:**
- Anything requiring world knowledge or current information. It's a
  small text model — keep prompts narrowly scoped.

---

## Hardware requirements

| Requirement | Reason |
|---|---|
| WebGPU | Required by WebLLM; we feature-detect and hide the toggle when absent |
| ≥4 GB available VRAM | For Phi-3.5-vision; text-only mode needs ~1 GB |
| ~5 GB free disk | OPFS cache for both models |

Detected via `navigator.gpu` — `localAISupported()` in `src/lib/local-ai.ts`.

---

## UX rules

1. **Never auto-download.** Models load only on explicit button click.
2. **Modal confirmation before every download.** The button click opens a
   dialog explaining: exact size, that the model runs entirely on-device
   after download, that the download is one-time + persistent, and that
   the user should prefer Wi-Fi. The user must click **Download** to
   proceed; **Not now** cancels with no side effect.
3. **Opt-in cascade.** Three independent levels in profile/edit:
   - Bring-your-own Anthropic key (text input, server-side fallback)
   - "Allow on-device AI as fallback" toggle (governs whether sync.ts
     ever calls into WebLLM)
   - Per-model download (vision / text), each requiring its own
     confirmation dialog
4. **Persistent storage.** `loadVisionEngine` / `loadTextEngine` call
   `navigator.storage.persist()` before any network fetch, so iOS Safari
   doesn't evict OPFS data after 7 days of non-use.
5. **Disclaimer always visible** when opting in: "Phi-3.5-vision is a
   general AI without taxonomic training. Results are capped at low
   confidence and never count toward research-grade."
6. **Cache lifecycle is transparent and reversible.** Each model card in
   profile/edit shows live state pulled from the Cache API:
   - **Not downloaded · ~size** — initial state, single Download button.
   - **Cached on this device · X GB · N files** — after first download.
     Buttons swap to Re-download + Delete from device.
   - **Loaded in GPU** — when `unload()` hasn't been called.
7. **Three eviction paths**:
   - **Unload (free GPU memory).** Keeps disk cache, drops VRAM.
   - **Delete from device.** Per-model. Removes Cache API entries
     matching the model id. User can re-download anytime.
   - **Delete all on-device AI data.** Nuclear; drops both models and
     all WebLLM-related cache buckets.
8. **Storage usage indicator.** A small line under the model cards
   displays `navigator.storage.estimate()` so the user knows how much
   of the origin's quota they're using.

## Cache implementation notes

WebLLM caches model shards via the standard `caches.open()` API under
three named buckets: `webllm/model`, `webllm/wasm`, `webllm/config`. The
bucket names are part of WebLLM's runtime contract — if a future version
renames them, our cache management functions (`getModelCacheStatus`,
`clearModelCache`, `clearAllModelCaches` in `src/lib/local-ai.ts`) must
be updated. Cache API entries are URL-keyed; we match the model id via
substring against `req.url`.

---

## Files

| File | Purpose |
|---|---|
| `src/lib/local-ai.ts` | Singleton engines, lazy-loaded; `identifyImageLocal`, `translateNote`, `generateFieldNote` |
| `src/lib/sync.ts` | Routes BYO key into `identify`; runs `runLocalFallback` when no engine + opt-in |
| `src/components/ProfileEditForm.astro` | UI for BYO key + WebLLM toggles |
| `supabase/functions/identify/index.ts` | Accepts optional `client_anthropic_key`; returns `no_id_engine_available` cleanly |

---

## Open questions / future work

1. **Better offline ID via TF.js.** A fine-tuned MobileNet trained on
   iNaturalist + GBIF would beat Phi-3.5-vision at 1/100th the download
   size. Tracked as a separate v0.5 module (planned, no spec file yet).
2. **MediaPipe LLM Inference + Gemma 3n.** Google's alternative to WebLLM
   has better multimodal coverage (image+audio+text). Worth re-evaluating
   when WebLLM's prebuilt list still lacks audio at v1.0.
3. **Voice I/O for Indigenous languages** (Zapoteco / Mixteco / Maya /
   Náhuatl) — module 08 v2.5 — would benefit from a small speech model
   on-device. Whisper-tiny via transformers.js is the obvious choice but
   integration is out of scope for v1.0.
