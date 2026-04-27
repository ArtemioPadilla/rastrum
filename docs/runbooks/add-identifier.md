# Runbook — Adding a new identifier plugin

> A walkthrough for adding a new model or service to the cascade. Uses
> BirdNET-Lite as the worked example because it's the most recently
> shipped on-device plugin that needs (a) a downloadable model and
> (b) custom preprocessing — the two things every new plugin tends to
> hit.

The contract lives in [`docs/specs/modules/13-identifier-registry.md`](../specs/modules/13-identifier-registry.md)
and the TypeScript surface in [`src/lib/identifiers/types.ts`](../../src/lib/identifiers/types.ts).
This runbook is the **how**, not the **what** — read those two first.

---

## TL;DR — the three commits

A typical plugin lands as three small PRs (or one well-organised PR):

1. **Pure helpers** (preprocessing, prompt building, label mapping) +
   their unit tests. No browser, no model.
2. **The plugin file** + registration in `bootstrapIdentifiers()`. With
   tests where they don't need the model.
3. **Operator step**: bundle the model on R2, set the URL secret, run
   `bundle-models.yml`, deploy. Documented in the PR body.

If your plugin doesn't need a downloaded model and doesn't need a BYO
key (rare), step 3 collapses to "deploy the static site".

---

## 1. File layout

```
src/lib/identifiers/
├── <name>.ts                Plugin implementation. Exports `<name>Identifier`.
├── <name>-helpers.ts        Pure helpers (preprocessing, postprocessing). Tested.
├── <name>-helpers.test.ts   Vitest coverage of the pure helpers.
├── <name>-cache.ts          (optional) IndexedDB cache for downloaded weights.
└── <name>-cache.test.ts     (optional) Cache helper tests.
```

The BirdNET layout matches this exactly:

```
src/lib/identifiers/
├── birdnet.ts                                         # plugin (~400 lines)
├── birdnet-audio.ts / birdnet-audio.test.ts           # mel-spectrogram preprocessing
├── birdnet-cache.ts / birdnet-cache.test.ts           # OPFS-backed weight cache
└── birdnet.test.ts is intentionally absent — model inference
                    isn't unit-testable; we test what is.
```

The split matters. Inference is too slow + GPU-flaky to land in CI.
Preprocessing isn't — it's deterministic floating-point math you can
seed.

---

## 2. The plugin contract

A plugin is one object that satisfies `Identifier`. Required surface:

```ts
import type { Identifier } from './types';

export const myPluginIdentifier: Identifier = {
  id: 'my_plugin',                         // stable, used by force_provider
  name: 'My Plugin',                       // shown in UI
  runtime: 'client',                       // 'client' | 'server'
  license: 'free',                         // see LicenseKind enum
  capabilities: {
    media: ['photo'],                      // or ['audio'], or both
    taxa: ['Plantae'],                     // or omit for any taxon
  },
  keySpecs: [],                            // [] if no BYO key needed
  setupSteps: [],                          // [] if no operator setup needed
  async isAvailable() { /* ... */ return { ready: true }; },
  async identify(input) { /* ... */ return idResult; },
  async testConnection() { /* ... */ return { ok: true }; },
};
```

Every field has a doc-comment in `types.ts`. Worth reading once start
to finish before you start typing — it's only ~150 lines.

The `id` is a hard contract: it appears in
`identifications.source`, in `force_provider`, in i18n labels for the
profile/edit "Configure" disclosure, in `pluginIdToObservationSource()`.
Renaming it later is painful. Pick something stable on day one.

---

## 3. Register it

```ts
// src/lib/identifiers/index.ts
import { myPluginIdentifier } from './my-plugin';

export function bootstrapIdentifiers() {
  if (booted) return registry;
  registry.register(plantNetIdentifier);
  registry.register(claudeIdentifier);
  // …
  registry.register(myPluginIdentifier);   // ← here
  booted = true;
  return registry;
}
```

The registry has runtime collision detection on `id`. Duplicates throw.
That's by design — silently overriding a built-in is a foot-gun.

---

## 4. If your plugin needs hosted weights

This is where most of the operational work lives. BirdNET's ONNX file
is ~50 MB; SpeciesNet is ~5 GB. Either way you do **not** ship them in
the static bundle — you serve from R2 and let the user download once.

### 4a. Add a step to `.github/workflows/bundle-models.yml`

```yaml
- name: Stage <name> bundle
  if: inputs.asset == '<name>' || inputs.asset == 'all'
  run: |
    mkdir -p _staging/<name> && cd _staging/<name>
    curl -fL --retry 3 -o weights.onnx \
      "https://upstream.example/path/to/weights.onnx"
    # sha256 verify if upstream publishes one
    file weights.onnx | grep -qiE 'data|onnx|protobuf' \
      || { echo "weights.onnx looks wrong"; exit 1; }
    for f in weights.onnx labels.txt; do
      aws s3 cp "$f" "s3://$R2_BUCKET/models/<name>/$f" \
        --endpoint-url "$R2_ENDPOINT" --content-type application/octet-stream
    done
```

Add the `<name>` value to the workflow's `inputs.asset.options` list.

### 4b. Document the upstream source + license

In your plugin file's header comment:

```ts
/**
 * BirdNET-Lite ONNX (Cornell Lab of Ornithology, BirdNET project).
 * Upstream: https://github.com/kahst/BirdNET-Analyzer
 * License: CC BY-NC-SA 4.0 — non-commercial use only.
 *
 * Weights are mirrored on R2 at PUBLIC_BIRDNET_URL because the upstream
 * serves them via Releases (rate-limited from the browser) and there's
 * no CORS header on the GitHub raw URL.
 */
```

The license matters because the cascade engine sorts by `LicenseKind`.
A `free-nc` plugin runs **after** `free` ones so we don't pull
non-commercial models into a B2G pipeline accidentally.

### 4c. Wire the URL into the build

Add `PUBLIC_<NAME>_URL` to `src/env.d.ts`:

```ts
interface ImportMetaEnv {
  // …
  readonly PUBLIC_BIRDNET_URL: string;
}
```

Set the secret:

```bash
gh secret set PUBLIC_BIRDNET_URL
# value: https://media.rastrum.org/models/birdnet
```

### 4d. Run the bundler, then deploy

```bash
gh workflow run bundle-models.yml -f asset=<name>
gh run watch
# … wait for green …
gh workflow run deploy.yml --ref main
gh run watch
```

The static site picks up the new env var at build time. The plugin's
`isAvailable()` should return `{ready: false, reason: 'model_not_cached'}`
until the user downloads, then `{ready: true}`.

---

## 5. If your plugin needs a BYO key

Add a `KeySpec` to the plugin's `keySpecs[]`:

```ts
keySpecs: [{
  name: 'my_provider',
  label: 'My Provider API key',
  placeholder: 'mp_…',
  hint: 'Free tier: 200 calls/day. Get a key at example.com/account.',
  pattern: /^mp_[a-zA-Z0-9]{32}$/,
}],
```

The profile/edit page automatically renders an input + Save / Test /
Clear buttons for each KeySpec. The `byo-keys.ts` central store handles
persistence to `localStorage[rastrum.byoKeys]` and the
guided-setup wizard reads `setupSteps[]` to build the numbered "how to
get one" list.

The plugin reads its key inside `identify()`:

```ts
async identify(input) {
  const key = input.byo_keys?.my_provider;
  if (!key) throw new Error('my_provider key required');
  // …
}
```

Per-call BYO keys are never persisted server-side; the Edge Function
forwards them as `client_keys.my_provider` and treats them as ephemeral.

---

## 6. Testing

The contract is "test the pure parts; don't test the model":

- ✅ **Pure preprocessing**: image resize, mel-spectrogram, normalisation,
  prompt formatting, label mapping. These are unit-testable, fast,
  deterministic.
- ✅ **Cache helpers**: OPFS / IndexedDB get/set/delete with mocks.
- ✅ **Plugin metadata**: `id` stability, `keySpecs` shape, capability
  filters.
- ❌ **Inference**: skip. Too slow, too GPU-flaky, not deterministic
  enough to assert on confidence.
- ❌ **Network calls** to the upstream API: skip. Use Playwright with a
  recorded fixture if you really need browser-end coverage.

Run the suite:

```bash
npm test                              # vitest run, ~3 s
npm run typecheck                     # tsc --noEmit
```

Add the helper tests to your PR. They double as the spec.

---

## 7. Deploy checklist

```bash
# Pre-PR:
npm run typecheck
npm test
npm run build

# After merge:
gh workflow run bundle-models.yml -f asset=<name>          # if hosting weights
gh secret set PUBLIC_<NAME>_URL                            # if hosting weights
gh workflow run deploy.yml --ref main                       # ship static site
gh workflow run deploy-functions.yml -f function=identify   # only if you also extended the
                                                            # Edge Function force_provider switch
```

Verify the live cascade behaves:

1. Open `/observe`, sign in, attach a media file your plugin should
   handle.
2. The cascade should pick your plugin (or skip it gracefully if
   `isAvailable()` returns `{ready: false}`).
3. The resulting `identifications.source` row in Postgres should equal
   your plugin's `id`.

---

## 8. Update the docs

- Add a row to [`docs/specs/modules/00-index.md`](../specs/modules/00-index.md)
  if your plugin warrants its own spec (most do).
- Cross-link from [`13-identifier-registry.md`](../specs/modules/13-identifier-registry.md)'s
  "registered plugins" list.
- If the plugin appears in BYO-key UI, add the i18n strings to
  `src/i18n/{en,es}.json` under `profile.byo_keys.<name>`.

That's it. The plugin platform is intentionally boring on purpose —
adding a new identifier is supposed to be a 1-day job, not a refactor.
