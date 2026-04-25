# Module 12 — BirdNET Audio ID

**Version target:** v0.5
**Status:** plugin stub registered; weights not yet bundled.
**License:** code MIT, model **CC BY-NC-SA 4.0** (Cornell Lab).
**Plugin id:** `birdnet_lite`

---

## Why BirdNET-Lite specifically

[BirdNET-Analyzer](https://github.com/birdnet-team/BirdNET-Analyzer) is
the canonical bird-call ID model from the K. Lisa Yang Center for
Conservation Bioacoustics at Cornell. Its TFLite-compiled "Lite" variant
is the smallest publicly distributed checkpoint (~50 MB) that carries
the same model weights and license as the full BirdNET. Designed for
edge deployment.

We ship **BirdNET-Lite specifically** rather than the full BirdNET
because it runs in the browser via TF.js or onnxruntime-web, which
matches Rastrum's offline-first architecture (module 03) without
requiring a Python container.

---

## License — what we can and cannot do

| Component | License | Implication |
|---|---|---|
| BirdNET-Analyzer code (Python) | MIT | Free to fork, redistribute, commercialise |
| Model weights | **CC BY-NC-SA 4.0** | Free for non-commercial use only; attribution required; derivative works must use the same license |

**Concrete consequences for Rastrum:**

| Use case | Allowed under CC BY-NC-SA? |
|---|---|
| Volunteer citizen science (free for users) | ✅ Yes |
| GBIF/CONABIO data publishing | ✅ Yes (recipients are non-commercial) |
| Credentialed researcher tier (free for researchers) | ✅ Yes |
| **Paid B2G dashboard for CONANP / state agencies (v2.0)** | ❌ **No — needs paid Cornell license** |
| Selling BirdNET-derived species lists to enterprise | ❌ No |
| Training a Rastrum-specific model on BirdNET inferences | ⚠️ Derivative; must also be CC BY-NC-SA |

The v2.0 B2G dashboard is the single hard blocker — every other use case
is fine under the existing license. Track the Cornell commercial license
as a governance task with a "before v2.0 ships" deadline. Module 07
(licensing) will gain a row for it.

---

## Required attribution

In the UI, anywhere a BirdNET result appears:

> **Audio identification:** BirdNET (Cornell Lab of Ornithology). Free
> for non-commercial use. [Source](https://github.com/birdnet-team/BirdNET-Analyzer)

In Darwin Core export, set `identifiedBy = "BirdNET (Cornell Lab)"` and
include a citation in the dataset's EML metadata.

---

## Integration plan (when we ship the weights)

1. **Get the weights.** Cornell distributes the TFLite model in the
   `BirdNET-Analyzer/checkpoints/` directory of the repo. We re-host on
   our R2 bucket (module 10) at `birdnet-lite/v2.4.tflite` so users
   don't hit Cornell's GitHub bandwidth on every install.
2. **Convert to ONNX (or use TFLite directly).** Two options:
   - TFLite via `@tensorflow/tfjs-tflite`: native browser support, ~50 MB
     bundle. Spectrogram preprocessing in JS via Meyda.
   - Convert to ONNX with `tflite2onnx`, run via `onnxruntime-web`.
     Slightly larger but unifies with the planned ONNX-based offline
     vision classifier (module on v0.3 roadmap).
3. **Wire the existing plugin.** `src/lib/identifiers/birdnet.ts`
   becomes a real implementation. `isAvailable()` checks the model is
   cached; `identify()` accepts a 3-second audio chunk, computes the
   mel-spectrogram, runs the model, returns top-N candidates per
   3-second window.
4. **Audio capture in the observation form.** Add a "Record audio"
   button next to the existing "Use camera" / "Choose file" buttons.
   `mediaRecorder.start()` for ≤30 seconds, save as WebM/Opus to Dexie
   blobs, sync engine routes through R2 just like photos do.
5. **UI surfacing.** The `identifications` table already has audio
   media support via `media_type = 'audio'` in `media_files`. The
   profile page's activity feed and the species page render audio
   inline with a `<audio controls>` plus the BirdNET window/score
   detail.

---

## Cascade behaviour

The cascade engine (module 13) routes audio observations to BirdNET-Lite
automatically because:

- It's the only plugin currently registered with `media: ['audio']`.
- Its `taxa: ['Animalia.Aves']` means audio observations with
  `user_hint: 'bird'` get a perfect match.

If/when we add other audio plugins (BirdVox-DCASE for nocturnal flight
calls, AnuraSet for frogs), they'd each register with their own taxa and
the cascade picks the most-specific match.

---

## Cost model

Free per-call (runs on-device). One-time:

- Model download: ~50 MB (R2 egress is free).
- Storage on user's device: ~50 MB cached in OPFS, persisted via
  `navigator.storage.persist()`.

vs. Cornell's hosted API (no public general-purpose endpoint exists
today, so this isn't really a comparison) or running BirdNET-Analyzer
Python on Fly.io (~$5/mo, no offline benefit).

---

## Open questions

1. **Privacy of the audio.** Bird calls are not sensitive species data,
   but **incidental human voice in the recording is**. Module 02 should
   gain a "audio sensitivity check" that scans the first second of each
   audio file for human-speech bands and warns the user before sync.
2. **Spectrogram preprocessing on mobile.** Meyda + Web Audio API in
   the worker thread is the standard pattern; verify mobile Safari
   doesn't choke on long audio in a worker.
3. **Sample rate.** BirdNET expects 48 kHz mono. Phone microphones
   record at 48 kHz natively but stereo — we'll need to downmix.
