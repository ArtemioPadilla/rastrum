# Audio player unification — design

> Status: design (approved 2026-05-03)
> Owner: @artemiopadilla
> Implementation plan: TBD (next step: invoke `writing-plans`)

## Problem

Three independent audio renderers exist today, each with different
features and bugs:

1. **`AudioPlayer.astro`** — full wavesurfer + spectrogram + radial,
   used only on `/share/obs/`. The radial visualizer (the most
   distinctive part) is hidden behind a "Visualize" toggle.
2. **`pages/share/obs/index.astro`** — manually duplicated copy of
   `AudioPlayer.astro`'s HTML so the JS-built DOM (post-fetch) gets
   the same player. Drift risk: any fix to `AudioPlayer.astro` must
   be hand-mirrored here.
3. **`lib/audio-thumb.ts`** — minimal canvas-based mini player used
   in PublicProfile, MyObservations grid, ExploreRecent, ExploreMap
   popups, ConsoleMediaView, and `entity-browser.ts`. No scrub, no
   volume, no spectrogram, no time display.
4. Plus three sites still using vanilla `<audio controls>`:
   `ValidationQueueView`, `ChatView`, `ObservationForm` (preview).

Net effect: the player feels half-baked everywhere except the detail
page, and even there the coolest visualization is hidden.

## Goal

One mountable audio player module (`lib/audio-player.ts`) with four
size variants. All ten render sites converge on it. The radial
visualizer is promoted to the centerpiece of the detail-page player.

## Architecture

### Module: `src/lib/audio-player.ts`

```ts
export type AudioPlayerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AudioPlayerOptions {
  size: AudioPlayerSize;
  obsId?: string;          // for spectrogram + BirdNET overlay event wiring
  mimeType?: string;       // default 'audio/mpeg'
  lang: 'en' | 'es';
  autoExpand?: boolean;    // lg only — start with spectrogram open
  label?: string;          // optional bottom caption (xs/sm)
}

export function mountAudioPlayer(
  container: HTMLElement,
  audioUrl: string,
  opts: AudioPlayerOptions,
): () => void; // cleanup
```

The function builds the DOM (no Astro template needed), wires events,
and returns a cleanup. Callers do not need to provide markup —
`mountAudioPlayer` owns the entire visual contract per size.

### Renderer split

`mountAudioPlayer` decides internally which engine to use:

- **`size === 'xs'`** → keeps the existing canvas-only renderer from
  `audio-thumb.ts` (~3 KB). No wavesurfer. Just play/pause + static
  waveform peaks + thin progress overlay.
- **`size === 'sm' | 'md' | 'lg'`** → lazy-imports wavesurfer + the
  spectrogram plugin (~80 KB gzip total, dynamic import). Justified
  because these surfaces are 1–3 instances per page max.

### Wrapper alignment

- `AudioPlayer.astro` is rewritten to: render an empty
  `<div data-audio-mount>` with config in dataset, and call
  `mountAudioPlayer` from a single client `<script>`. No more
  hand-rolled HTML.
- `pages/share/obs/index.astro`'s `buildAudioPlayerHTML` function is
  deleted. The dynamic-fetch path calls `mountAudioPlayer` on a
  freshly-created `<div>`.
- `lib/audio-thumb.ts` becomes a thin re-export of
  `mountAudioPlayer({ size: 'xs' })` (or 'sm') for one release, then
  is deleted in a follow-up. Existing callers' import paths stay
  green during the migration.

### Migration map

| Site | Today | Becomes |
|---|---|---|
| `share/obs/` (detail) | duplicated wavesurfer HTML | `mountAudioPlayer(size:'lg', autoExpand)` |
| `PublicProfileView` (grid) | `mountAudioThumb(compact:false)` | `mountAudioPlayer(size:'md')` |
| `ExploreRecentView` (feed) | `mountAudioThumb(compact:false)` | `mountAudioPlayer(size:'md')` |
| `ExploreMap` (popup) | `mountAudioThumb({label})` | `mountAudioPlayer(size:'sm', label)` |
| `MyObservationsView` (grid) | `mountAudioThumb(compact:true)` | `mountAudioPlayer(size:'xs')` |
| `ConsoleMediaView` | `mountAudioThumb(compact:true)` | `mountAudioPlayer(size:'xs')` |
| `entity-browser.ts` | `mountAudioThumb(compact:true)` | `mountAudioPlayer(size:'xs')` |
| `ValidationQueueView` | `<audio controls>` 72×24 | `mountAudioPlayer(size:'xs')` |
| `ChatView` (attachments) | `<audio controls>` block | `mountAudioPlayer(size:'sm')` |
| `ObservationForm` (preview) | `<audio controls>` inline | `mountAudioPlayer(size:'sm')` |

## Size variants — feature matrix

| Feature | xs (~64×64) | sm (~220–280 wide) | md (~440 wide card) | lg (hero detail) |
|---|---|---|---|---|
| Static waveform peaks | ✓ | ✓ | ✓ | ✓ |
| Play/pause | ✓ (centered) | ✓ (left) | ✓ (left) | embedded in radial |
| Time display | — | ✓ `0:12 / 0:34` | ✓ | ✓ |
| Click-to-seek on waveform | — | ✓ | ✓ | ✓ |
| Volume control | — | popover | inline slider | inline slider |
| Spectrogram | — | — | ✓ on first play (placeholder until then) | ✓ on mount (autoExpand) |
| Click-to-seek on spectrogram | — | — | ✓ | ✓ |
| Synced playhead across both visualizations | — | — | ✓ | ✓ |
| Frequency zoom selector | — | — | — | ✓ |
| Export PNG | — | — | — | ✓ |
| BirdNET overlay + legend | — | — | ✓ if data available | ✓ |
| Radial visualizer | — | — | — | ✓ **always visible (centerpiece)** |
| Engine | canvas | wavesurfer | wavesurfer + spectrogram | wavesurfer + spectrogram + radial |

### Resolved decisions

- **Volume (option C):** inline slider in `md`/`lg`; popover (icon
  expands to a small floating slider on click) in `sm`. Reason:
  popups have no horizontal room for a permanent slider.
- **Spectrogram in md (option B):** placeholder bars (desaturated
  inferno gradient) are drawn immediately so the user knows a
  spectrogram exists; actual decode + render happens on first
  play. Reason: a feed of 20+ cards must not pre-decode 20 audio
  files.
- **Radial in lg (option A):** centerpiece, always visible. The
  play button is a circular control inside the radial's inner
  ring (~64px diameter). When no BirdNET segments exist, the
  radial paints in `DEFAULT_COLOR_RGB` (emerald) so it still
  feels alive — it does not pretend to have detections it
  doesn't have.

## Layout — `lg` (detail page)

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│              ╱─────────╲                               │
│           ╱   ▒▒▒▒▒▒▒    ╲          ← radial          │
│          │   ▒  ▶  ▒▒    │           (220×220)        │
│           ╲   ▒▒▒▒▒▒    ╱            play in center   │
│              ╲────────╱               species label    │
│                                       under play       │
├────────────────────────────────────────────────────────┤
│ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ← waveform   │
│ 0:12 / 0:34       🔊━━━●━━━━━     [⚙ rango ▾] [PNG ↓] │
├────────────────────────────────────────────────────────┤
│ 12 kHz          Frecuencia                       0 Hz │
│ ████████████████ spectrogram ████████████████████████ │
│ ─── BirdNET bands overlay (if any) ──────────────────  │
│                                                Tiempo │
│ Detected species legend ───                            │
└────────────────────────────────────────────────────────┘
```

Mobile (`<md`): same vertical stack; radial shrinks to ~160×160.

## Layout — `md` (feed card)

```
┌──────────────────────────────────────────┐
│ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ← wave  │
│                                           │
│ ░░░░ spectrogram placeholder ░░░░         │
│ ░░ (decoded after first play)  ░░         │
├──────────────────────────────────────────┤
│ ▶  0:12 / 0:34    🔊━━━●━━━              │
└──────────────────────────────────────────┘
```

## Layout — `sm` (map popup, chat attachment)

```
┌────────────────────────────────────┐
│ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  ← wave │
├────────────────────────────────────┤
│ ▶  0:12 / 0:34          🔊         │
└────────────────────────────────────┘
        (🔊 click → vertical popover slider)
```

## Layout — `xs` (grid thumb, table cell)

```
┌──────┐
│      │
│  ▶   │  ← static waveform background, play button
│      │     centered. Click anywhere = play/pause.
└──────┘
```

## Component boundaries

`mountAudioPlayer` internally splits into:

1. **`renderShell(container, size, lang)`** — builds DOM, wires
   resize observer, attaches volume + spectrogram toggle controls.
2. **`createWaveformEngine(size, audioUrl, host)`** — returns
   `{ play, pause, seek, getCurrentTime, getDuration, on }` —
   thin abstraction with two impls: `canvasEngine` (xs) and
   `wavesurferEngine` (sm/md/lg).
3. **`mountSpectrogram(host, engine, opts)`** — only invoked for
   md/lg. Placeholder draws immediately; real spectrogram registers
   on first play (md) or on mount (lg).
4. **`mountRadial(host, container, engine)`** — lg only. Embeds
   play button in inner ring. Reuses existing
   `initRadialVisualizer` logic verbatim (BirdNET segments via
   `__birdnetSegments` container attachment).
5. **`mountVolumeControl(host, engine, size)`** — inline (md/lg)
   or popover (sm). Persists last value to `localStorage` key
   `rastrum.audio.volume`.

Each piece is independently testable with a mock engine.

## State sharing across instances

A page may have multiple players (chat thread, feed scroll). Rules:

- **Pause others on play:** `mountAudioPlayer` registers each
  instance in a module-level `Set<AudioPlayerHandle>`. On `play`,
  pause all others. Mirrors how Apple Podcasts / Twitter
  audio behave.
- **Volume is global:** the slider writes to
  `localStorage['rastrum.audio.volume']` and emits a custom event
  `rastrum:audio-volume-change`. All instances listen and apply.

## BirdNET integration

Unchanged from today: the `rastrum:audio-birdnet-ready` custom
event still carries `{ obsId, segments, durationSec }`. `md` and
`lg` players listen and:

- Render colored bands on top of the spectrogram (existing logic).
- Update the radial's color in real time when the playhead is
  inside a segment (existing logic, only active in `lg`).
- Show the species legend below the spectrogram (existing logic).

`sm` and `xs` ignore the event — they have no spectrogram or
radial to color.

## Accessibility

- All buttons keep their existing `aria-label` (localized).
- Volume slider: `<input type="range">` with `aria-label="Volume"`,
  arrow keys step ±5%.
- Spectrogram: `role="img"` with `aria-label="Spectrogram showing
  frequencies from 0 to N kHz"`.
- Radial: `aria-hidden="true"` (decorative). Play button inside
  retains label.
- Keyboard: Space toggles play (when player has focus), arrow
  keys seek ±5s when waveform has focus.

## Testing

- Unit tests for `lib/audio-player.ts`:
  - mount/unmount cycle leaves no listeners
  - cleanup stops audio playback
  - "pause others on play" rule fires across instances
  - volume persists across mounts
- Existing `AudioPlayer.astro` test fixtures get migrated to
  drive `mountAudioPlayer` directly.
- E2E (Playwright): one new spec covers detail-page playback with
  spectrogram + radial visible from first paint.

## Bundle impact

- `lib/audio-player.ts` size base: ~5 KB (DOM builder + canvas
  engine, no wavesurfer).
- Wavesurfer + spectrogram plugin only enter the chunk graph for
  the routes that actually call `mountAudioPlayer({ size:
  'sm'|'md'|'lg' })`. Astro chunks per-route, so MyObservations
  (xs only) stays slim.
- Net change vs. today: PublicProfile + ExploreRecent gain ~80 KB
  (they previously did not load wavesurfer). Acceptable — these
  pages already render images and maps that dwarf 80 KB. Detail
  page is unchanged (already loaded wavesurfer).

## Out of scope (defer)

- **Waveform peaks pre-computed server-side**: would let xs
  thumbs skip the audio-decode step entirely. Useful if grid
  scrolling becomes janky with many audio observations. Defer
  until measured.
- **Persistent playhead across navigation**: a "now playing" mini
  bar that survives route changes. Different design problem;
  not part of this unification.
- **Waveform color = species color**: tinting the static waveform
  with the dominant BirdNET species color. Cute but adds another
  piece of state. Defer.
- **Loop / playback rate controls**: no demand surfaced.

## Files touched (preview, full list in plan)

- **New:** `src/lib/audio-player.ts`,
  `src/lib/audio-player.test.ts`.
- **Rewritten:** `src/components/AudioPlayer.astro` (becomes thin
  wrapper), `src/pages/share/obs/index.astro` (deletes
  `buildAudioPlayerHTML`).
- **Migrated callers:** `PublicProfileView`, `MyObservationsView`,
  `ExploreRecentView`, `ExploreMap`, `ConsoleMediaView`,
  `ValidationQueueView`, `ChatView`, `ObservationForm`,
  `lib/entity-browser.ts`.
- **Deleted (after migration release):** `src/lib/audio-thumb.ts`.

## Commit / PR plan

Split into 3 PRs to keep review tractable:

1. **PR 1**: introduce `lib/audio-player.ts` with all four size
   variants + tests. `AudioPlayer.astro` and `audio-thumb.ts`
   stay as-is (no callers migrated).
2. **PR 2**: rewrite `AudioPlayer.astro` and `share/obs/index.astro`
   to call `mountAudioPlayer({ size: 'lg' })`. Radial becomes
   centerpiece. Detail-page UX ships.
3. **PR 3**: migrate remaining callers (PublicProfile, ExploreRecent,
   ExploreMap, MyObs, ConsoleMedia, entity-browser, Validation,
   Chat, ObservationForm) to `mountAudioPlayer`. Delete
   `audio-thumb.ts`.
