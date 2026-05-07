# On-device vision fallback (Phi + Gemma dual runtime)

> Why Rastrum ships **two** on-device VLM runtimes and how they're meant to coexist.

## TL;DR

- **Phi-3.5-vision** — runs via [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm); MLC's TVM-compiled WebGPU kernels. ~4 GB on disk, ~4 GB VRAM, MIT.
- **Gemma 4 E2B** — runs via [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) v4 + ONNX Runtime Web. ~500 MB on disk, ~1.3 GB VRAM, Apache 2.0.

Both are **optional, opt-in, and disabled by default.** Both surface as separate identifier plugins (`webllm_phi35_vision` and `onnx_gemma4_vision`) and both are gated by their own `localStorage` opt-in flag in `isAvailable()`.

The product intent is **resilience, not redundancy**: the two runtimes take completely different WebGPU code paths, so when one crashes on a given GPU/driver/browser combo (and they do — see [Why two?](#why-two)) the other often still works.

## Why two?

Phi-3.5-vision via MLC has a documented crash class on Apple Silicon Metal and Chromium 147+ (`Binding size 1 isn't a multiple of 4` WebGPU validation errors). The runner in `src/lib/identify-runners.ts` (`makePhiRunner`) sets a session-broken flag and demotes Phi for the rest of the session after a crash; users in CLAUDE.md's "Known pitfalls" section have hit this enough that the toggle defaults off.

Transformers.js + ONNX has its **own** WebGPU crash class — JSEP failures, missing-cache-param errors, M3-Pro init failures (transformers.js#1469, #1424, #1518). Different failure modes, but real.

The bet: **the intersection of "Phi-crashes-here" and "Gemma-crashes-here" is small**. Users who hit one runtime's failure can flip to the other and keep working without uninstalling anything.

## How to enable each

Both surfaces live in **Profile → Edit → On-device AI**. Each card has:

1. A **download button** (one-time, ~4 GB for Phi / ~500 MB for Gemma).
2. An **opt-in checkbox** (`Use Phi/Gemma in the identification cascade`).
3. A **delete button** to free disk space.

Storage keys:
- `localStorage['rastrum.prefs.usePhiVision'] === 'true'` — gates Phi
- `localStorage['rastrum.prefs.useGemmaVision'] === 'true'` — gates Gemma

The opt-in lives in **`isAvailable()`** of each plugin (single source of truth). Cascade callers (`runCascade`, the chat picker, the obs `runParallelIdentify`) all respect it without extra wiring.

## Where they show up

| Surface | Behavior |
|---|---|
| `/observe` capability banner | Two separate ✅/❌ rows: "Phi Vision (local)" and "Gemma 4 (local)". Each green when the model is cached AND the opt-in is set. |
| `/observe` ID pipeline | Both runners conditionally added to `runners` map in parallel; whichever returns a confident answer first wins via `runParallelIdentify`. |
| `/observe` form | Same — `ObservationForm.astro` adds both runners conditionally. |
| `/chat` model picker (PR #644) | Explicit chips for Phi and Gemma. Selecting either forces only that model to run. |
| `/chat` "Compare all" | Fans out to every photo-capable plugin — if both are opted in and cached, both appear in the comparison cards. |

## Failure modes + what to do

### Phi crashes mid-session (`Binding size isn't a multiple of 4`)

Symptoms: cascade returns no result; console shows `WebGPU validation error`; `__rastrumPhiBroken = true` set on `window`.

Recovery in this session: Phi's runner self-skips for the rest of the page's lifetime. No action needed.

Recovery for next session: refresh the page. If it crashes again on the next photo, **toggle Phi off + Gemma on** in Profile → Edit and try again.

### Gemma crashes (`JSEP`, `Can't create a session`, ORT errors)

Symptoms: similar — cascade returns no result; console shows ORT-flavored errors; `__rastrumGemmaBroken = true` set.

Recovery: same pattern — runner self-skips, refresh, switch to Phi if Gemma keeps failing.

### Both crash on the same hardware

This is the small intersection. Most realistic cause: device truly under-spec'd (≤4 GB RAM). Both runners' `gemmaSupported()` / `localAISupported()` should already block this at the gate.

If they don't (real reports welcome — open an issue), fall back to:
- **Cloud Claude** (BYO key or sponsored)
- **PlantNet** for plants
- **EfficientNet-Lite0** as the zero-cost on-device classifier (~2.8 MB)

The cascade still produces a result via these — just not from a local VLM.

### Both work fine, you only want one

Pick one and don't enable the other. Each ~adds disk + cache + has its own quirks. Default story: enable Phi (it's the older, better-tested path); add Gemma only if you hit Phi crashes.

## Maintenance notes

- **Don't wire either runtime into the obs sync flow** — sync uses `runParallelIdentify`'s race-to-winner semantics; both runners are already in the runners map there. No further plumbing needed.
- **Cache lives in different places.** Phi uses MLC's OPFS-backed names (`webllm/model`, `webllm/wasm`, `webllm/config`). Gemma uses the standard Cache API (`transformers-cache`). The "Clear all on-device AI data" button in Profile → Edit nukes Phi's caches; clearing Gemma's is a separate button on the Gemma card.
- **Bundle**: `@huggingface/transformers` is a 5.7 MB chunk that's lazy-imported only — never lands in the initial PWA install. `@mlc-ai/web-llm` is the same.
- **`onnxruntime-node` warning at install time.** Transformers.js v4 lists it as a non-optional dep. We don't use it (browser only), but it's in `node_modules`. Upstream issue; acceptable for now.

## Related

- Phi original spec: `docs/specs/modules/11-in-browser-ai.md`
- Phi opt-in toggle: PR #637
- Chat model picker (where users explicitly pick one): PR #644
- Gemma plugin: PR #645 / [`src/lib/identifiers/gemma-vision.ts`](../../src/lib/identifiers/gemma-vision.ts)
- Gemma runtime: [`src/lib/onnx-vision.ts`](../../src/lib/onnx-vision.ts)
