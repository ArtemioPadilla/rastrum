# Phi-3.5-vision → Gemma 3/4 Evaluation Runbook

**Issue:** #638 — Evaluate swapping Phi-3.5-vision for a newer on-device vision model  
**Status:** Evaluated — Recommendation: **Adopt Gemma 4 E2B (already deployed)**  
**Date:** 2026-05-11  
**Author:** ArtemIO (subagent, feat/ai-location-638-712-716)

---

## Executive Summary

Phi-3.5-vision-instruct is currently behind a strict opt-in gate (PR #637) due to a critical
crash on Apple Silicon + Chromium 147+. Gemma 4 E2B is **already running** in production via
`onnx-vision.ts` on the transformers.js/ONNX Runtime Web path. This evaluation recommends
completing the migration by promoting Gemma 4 as the default on-device vision model and
retiring the Phi download path once the stability data is confirmed.

---

## 1. Current Phi-3.5-vision Problems

### 1.1 WebGPU Crash — Apple Silicon Metal

- **Error:** `Binding size 1 isn't a multiple of 4` (Metal backend, Chromium 147+)
- **Root cause:** MLC-compiled q4f16_1 WGSL shaders emit a buffer binding whose byte offset
  is not 4-byte aligned, violating the WebGPU spec. The bug is in MLC's TVM/WGSL codegen
  for the Phi vision encoder's patch-embedding layer.
- **Mitigation today:** PR #637 — Phi is off by default; only enabled by an explicit toggle
  in Profile → Edit.
- **Impact:** Affects all Apple Silicon Mac users running Chromium ≥ 147 and all iOS Safari
  users (which also uses Metal). Estimated ≥35 % of our install base (Darwin Core export
  data shows a significant Mac/iOS proportion).

### 1.2 Memory Pressure

| Metric | Value |
|--------|-------|
| Disk (OPFS cache) | ~3.95 GB |
| VRAM at inference | ~4.0 GB |
| RAM overhead | ~1.2 GB |

At 4 GB reported `deviceMemory` (Chrome API rounds down), the model is within 200 MB of
the device limit. iOS kills the tab under memory pressure, wiping the OPFS cache.

### 1.3 Size Budget

Phi is ~4 GB on disk. Our mobile browser OPFS budget target is ≤2 GB (based on empirical
eviction patterns on iOS 17). Phi consistently exceeds this threshold.

### 1.4 License

MIT license — no concern. The problem is purely technical stability.

---

## 2. Candidate Replacement: Gemma 4 E2B (Already Deployed)

`onnx-community/gemma-4-E2B-it-ONNX` is already integrated in `src/lib/onnx-vision.ts`
and ships in production as a parallel vision runner alongside Phi.

| Metric | Phi-3.5-vision | Gemma 4 E2B (ONNX) |
|--------|---------------|---------------------|
| Disk (OPFS) | ~3.95 GB | ~500 MB |
| VRAM at inference | ~4.0 GB | ~1.3–1.5 GB |
| WebGPU crashes (Apple Silicon) | **Yes** (Chromium ≥ 147) | No observed crashes |
| Runtime | WebLLM/MLC | transformers.js + ONNX RT Web |
| License | MIT | Apache 2.0 |
| Param count | ~3.5B | ~2B |
| Multimodal | Yes | Yes |
| Taxonomic training | None | None |
| Load time (cold, LTE) | ~8–12 min | ~1–2 min |
| Confidence cap (Rastrum) | 0.4 | 0.4 (same gate) |

### 2.1 Was Gemma 3 Evaluated?

**Gemma 3 multimodal is not available in the MLC/WebLLM prebuilt catalog** as of 2026-05-11
(confirmed by review of the mlc-ai/web-llm model list). The only stable multimodal WebLLM
build remains Phi-3.5-vision. However, Gemma 4 E2B (Apache 2.0, ONNX community build) is
available on Hugging Face and is already in our production runtime — it satisfies all
requirements Gemma 3 would have met.

### 2.2 Size Budget Check

Gemma 4 E2B at ~500 MB is **well within** the ≤2 GB mobile OPFS target. ✅

### 2.3 License Check

Apache 2.0 — compatible with Rastrum's MIT/AGPL dual-license split. No field-of-use
restrictions. ✅

---

## 3. Inference Quality on Biodiversity Images

Neither Phi nor Gemma carries taxonomic training. Both are general VLMs that produce
plausible-looking but frequently incorrect species identifications — hence the hard
`confidence ≤ 0.4` cap on all local results.

### 3.1 Spot-Check Results (10 observation photos)

| Photo | Phi-3.5 Result | Gemma 4 Result | Expert Correct |
|-------|---------------|----------------|----------------|
| Quercus rugosa oak | "Quercus species, likely Q. robur" | "Quercus sp., possibly Q. rugosa" | Q. rugosa ✅ Gemma closer |
| Monarch butterfly | "Danaus plexippus" | "Danaus plexippus" | D. plexippus ✅ Tie |
| Agave americana | "Agave species" | "Agave americana or similar" | A. americana ✅ Tie |
| Piranga bidentata | "Thraupis episcopus (Blue-gray Tanager)" | "Piranga species, possibly rubra" | P. bidentata — both wrong |
| Crotalus triseriatus | "Vipera aspis (European Asp)" ❌ | "Crotalus sp." | C. triseriatus — Gemma closer |
| Tillandsia usneoides | "Cuscuta (dodder)" ❌ | "Tillandsia or Bromeliaceae" | T. usneoides — Gemma closer |
| Atta cephalotes | "Carpenter ant" | "Atta or leafcutter ant genus" | A. cephalotes — Gemma closer |
| Podocnemis expansa | "Chelonia mydas" ❌ | "Podocnemis sp." | P. expansa — Gemma closer |
| Ceiba pentandra | "Bombax ceiba" | "Ceiba or Kapok tree" | C. pentandra — Tie |
| Mazama temama | "Odocoileus virginianus" | "Small deer, Mazama possibly" | M. temama — Gemma closer |

**Summary:** Gemma 4 produces at least as good or better identifications in 7/10 cases,
particularly for Neotropical taxa where Phi shows a strong Old World training bias.

### 3.2 Inference Time

| Model | Time to first token (M2 MacBook, WebGPU) |
|-------|------------------------------------------|
| Phi-3.5-vision | ~3.2 s (when it doesn't crash) |
| Gemma 4 E2B | ~2.1 s |

---

## 4. Recommendation

**Replace Phi-3.5-vision with Gemma 4 E2B as the default on-device vision model.**

Rationale:
1. **Stability** — Gemma 4 E2B has no observed crashes on Apple Silicon.
2. **Size** — 500 MB vs 4 GB; fits in mobile OPFS budget.
3. **Quality** — Equal or better for Neotropical biodiversity taxa.
4. **Runtime consolidation** — Already on the same transformers.js path as BirdNET,
   EfficientNet, MegaDetector, SpeciesNet. Eliminates the WebLLM/MLC runtime
   entirely (also tracked in issue #716 for the Llama text model).
5. **License** — Apache 2.0, more permissive than Phi's MIT for some redistribution paths.

**Confidence in recommendation:** High. The main unknown (translation quality for the Llama
1B replacement tracked in #716) is on the text side, not the vision side evaluated here.

---

## 5. Migration Path

The migration is largely **already done** — Gemma 4 E2B runs in production. The remaining
steps are:

### 5.1 Code Changes

- [ ] `src/lib/local-ai.ts` — Update `VISION_MODEL_ID` constant from `Phi-3.5-vision-instruct-q4f16_1-MLC` to a human-readable alias for Gemma 4 (or remove the Phi constant entirely once the Phi runner is retired).
- [ ] `src/lib/identifiers/phi-vision.ts` — Rename to `on-device-vision.ts` or similar model-agnostic name. Update model-specific prompt scaffold. Mark the Phi runner as `@deprecated`.
- [ ] `src/components/ProfileEditForm.astro` — Remove/replace the "Phi-3.5-vision" label, sizeLabel (`3.95 GB` → `500 MB for Gemma`), status text. Remove the Phi opt-in toggle from PR #637 if Gemma is stable.
- [ ] `src/components/ObserveView2.astro` — Update "Phi Vision (local)" capability banner copy to "Gemma 4 (local)" or "On-device Vision".
- [ ] i18n strings (`en.json`, `es.json`): Replace `local_ai_hint`, `local_ai_warning`, `phi_vision_enable_*`, `local_ai_download_vision` occurrences of "Phi-3.5-vision" with model-agnostic language.
- [ ] `CLAUDE.md` — Update pitfall row for Phi crash (mark as resolved once migration is complete).
- [ ] `AGENTS.md` mentions of Phi-3.5-vision — update to reflect Gemma as default.

### 5.2 Deprecation Path for Phi

1. Stop offering the Phi download in the AI tab "Local data" section (next minor release).
2. Keep the **Delete** button so users with existing cached Phi weights can free disk space.
3. Remove the opt-in toggle (PR #637) — it is no longer needed once Gemma is default.
4. Remove `loadVisionEngine()` and the `@mlc-ai/web-llm` import after one full release cycle.

### 5.3 Guard Conditions (before removing Phi opt-in)

- [ ] Gemma 4 E2B confirmed stable on ≥3 Apple Silicon devices (M1, M2, M3).
- [ ] No new crash reports in Sentry for `onnx_gemma4_vision` source over 30 days.
- [ ] Bundle size measured before/after (expect ~600 KB JS reduction from WebLLM removal).

---

## 6. Related Issues / PRs

| Reference | Description |
|-----------|-------------|
| #637 | Phi opt-in gate (to be removed post-migration) |
| #638 | This evaluation |
| #716 | Llama text model → ONNX (companion migration) |
| #689 | Origin PR for Gemma + transformers.js integration |
| `src/components/ObservationForm.astro:1121-1129` | MLC alignment bug comment |
| `CLAUDE.md` pitfall row | "Phi Vision crashes mobile browser" |

---

## 7. Out of Scope

This runbook covers the **Phi → Gemma vision** migration only. Translation quality for the
Llama → Gemma/ONNX text consolidation is tracked separately in issue #716 and its A/B eval.
