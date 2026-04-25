# Module 13 — Identifier Registry (Plugin Platform)

**Version target:** v0.5
**Status:** spec + scaffold shipped. Plugins for PlantNet, Claude Haiku,
Phi-3.5-vision are wired through it; BirdNET-Lite and EfficientNet-Lite0
are stubbed pending model weights.

---

## Why a registry

Rastrum integrates many AI services for species ID:
PlantNet (free quota), Claude Haiku (paid / BYO), Phi-3.5-vision (free
on-device generalist), BirdNET-Lite (NC-licensed audio), Cornell SpeciesNet,
MegaDetector for camera traps, plus future regional ONNX models.

Hard-coding their cascade order in `sync.ts` and again in the Edge Function
duplicates logic and forces a rewrite every time a new identifier is added.
A registry decouples the ID engines from the routing decision: each engine
declares **what it can do** (capabilities) and **whether it's ready right
now** (availability), and a generic cascade engine picks the right one
per observation.

---

## Plugin contract — `src/lib/identifiers/types.ts`

Every identifier implements:

```typescript
interface Identifier {
  id: string;                          // stable, used as identifications.source
  name: string;
  description: string;
  capabilities: IdentifierCapabilities;
  isAvailable(): Promise<IdentifierAvailability>;
  identify(input: IdentifyInput): Promise<IDResult>;
}
```

### Capability descriptor

```typescript
interface IdentifierCapabilities {
  media: ('photo' | 'audio' | 'video')[];
  taxa: ('Plantae' | 'Animalia' | 'Animalia.Aves' | 'Fungi' | '*')[];
  runtime: 'client' | 'server';
  license: 'free' | 'free-nc' | 'free-quota' | 'byo-key' | 'paid';
  confidence_ceiling?: number;     // hard cap (e.g. 0.35 for Phi-3.5-vision)
  cost_per_id_usd?: number;
}
```

Capabilities feed two separate decisions:

1. **The cascade engine** (`src/lib/identifiers/cascade.ts`) filters the
   registered plugins by `media` + `taxa` + `runtime`, sorts by license
   cost (free → paid), and walks them in order until one returns a result
   above `ACCEPT_THRESHOLD = 0.7`.
2. **The UI** (`profile/edit` → AI settings → Available identifiers)
   surfaces the same metadata to the user: license, runtime, media types,
   confidence cap. The user sees what's running and why.

### Availability

```typescript
type IdentifierAvailability =
  | { ready: true }
  | { ready: false; reason: 'needs_key' | 'needs_download' | 'unsupported'
                          | 'model_not_bundled' | 'disabled'; message?: string };
```

Plugins return their own readiness, so the cascade gracefully skips
identifiers that aren't usable in the current context (no GPU, no key,
weights not bundled). The UI shows the same reason text as a chip.

---

## Cascade policy

```
candidates = registry.findFor({ media, taxa })
  .filter(p => !excluded.includes(p.id))
  .sort(license_cost asc, confidence_ceiling desc)

for plugin in candidates:
  if !(await plugin.isAvailable()).ready: skip
  result = await plugin.identify(input, prior_candidates)
  cap = plugin.capabilities.confidence_ceiling
  if cap and result.confidence > cap: result.confidence = cap
  best = max_by_confidence(best, result)
  if result.confidence >= ACCEPT_THRESHOLD: stop
```

`prior_candidates` is forwarded to each subsequent plugin so chains like
"PlantNet returned `Quercus rugosa` at 0.65, ask Claude to confirm or
correct" work without special-casing.

---

## Built-in plugins

| Plugin | Runtime | Media | Taxa | License | Notes |
|---|---|---|---|---|---|
| `plantnet`             | server | photo  | Plantae | free-quota | 500/day free |
| `claude_haiku`         | server | photo  | * | byo-key/paid | BYO key supported |
| `webllm_phi35_vision`  | client | photo  | * | free | confidence cap 0.35 |
| `birdnet_lite`         | client | audio  | Animalia.Aves | free-nc | weights not yet bundled |
| `onnx_efficientnet_lite0` | client | photo | * | free | weights not yet bundled |

---

## Adding a new identifier

1. Write `src/lib/identifiers/<your-plugin>.ts` exporting an `Identifier`.
2. Add its import + register call to `src/lib/identifiers/index.ts`.
3. (If server-side) extend the Edge Function's `force_provider` switch
   with the corresponding `call<YourProvider>()` function.
4. Add the licensing implications to `docs/specs/modules/07-licensing.md`
   if it's anything other than fully open / free.
5. Document the spec in `docs/specs/modules/NN-<name>.md` and add it to
   `modules/00-index.md`.

The registry has runtime collision detection on `id`, so duplicate
registrations fail loudly during boot.

---

## Server-side mirror

The `identify` Edge Function (`supabase/functions/identify/index.ts`)
keeps its own minimal switch over `force_provider` so the **client**
cascade engine can call exactly one server-side identifier per request.
This means the server doesn't need to mirror the full TypeScript registry
— it just needs a switch that maps `force_provider` → which provider
function to call.

When a server-only identifier is added later (e.g. SpeciesNet for camera
traps in v1.0), the Edge Function gains one more case in the switch and
the client gets one more registered plugin that calls the function with
the appropriate `force_provider`.

---

## Why this is also a community story

The plugin contract is intentionally narrow (one interface, one register
call) so third-party developers — community contributors, partner
institutions — can ship their own identifier without touching Rastrum's
core code. The use cases this opens:

- A regional herbarium publishes a fine-tuned model for their endemic
  taxa and ships an `Identifier` plugin that wraps it. Users opt in via
  the AI settings panel; the cascade engine picks it for observations
  in that herbarium's bioregion.
- A government agency runs a private model behind their VPN; the agency
  ships a plugin that calls their endpoint with a paired API key. The
  user supplies the key in their profile (BYO pattern), Rastrum routes
  to it for observations within the agency's mandate.
- A research project builds a Scout-style RAG model and ships the
  client lib as a plugin alongside their published paper. Adoption is
  one button click in the user's profile.

Every plugin lands in the same UI (`profile/edit → AI settings →
Available identifiers`) with the same metadata shape, so users see a
consistent picture of what's running and what each thing costs them.
