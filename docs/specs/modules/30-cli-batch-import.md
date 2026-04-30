# M30 — CLI batch import for camera-trap memory cards

> **Status:** v1 in progress.
> **Owner:** Artemio.
> **Surfaces:** `cli/` directory (Node 20+ TypeScript), `POST /api/upload-url` Edge Function endpoint.
> **Depends on:** M29 (Projects) for polygon auto-tagging on import.

A Node CLI (`rastrum-import`) that walks a directory of camera-trap
photos, reads EXIF GPS + timestamp, uploads each photo to R2, and
creates an observation via the `rst_*` API token endpoint.

Built for the CONANP-Oaxaca / DRFSIPS / PROREST 2026 workflow:
researchers retrieve 500–2000 images per camera deployment and need
bulk ingestion without one-photo-at-a-time UI clicking.

## Architecture

```
[SD card dir] → walker.ts ──┐
                            ▼
            ┌──── exif.ts (lat/lng/observed_at)
            ▼
       cli.ts orchestrator
            │
            ├── POST /api/upload-url   (rst_ token)
            ├── PUT  <r2-presigned>    (raw bytes)
            ├── POST /api/observe       → server trigger auto-assigns project_id
            └── POST /api/identify     (optional)
            │
            ▼
       log.ts (import-log.json — resumable)
```

The auto-assignment to a project polygon happens **server-side** via
the M29 `assign_observation_to_project_trigger` — the CLI doesn't
need a `--project-slug` flag.

## Why a separate package

`cli/` has its own `package.json` so the user-facing PWA never
ingests Node-only deps (`exifr` runs on Buffer; the PWA uses the
same library on `File`). The CLI also runs offline (no Supabase JS
client), via a hand-rolled `ApiClient` against `/api/*`.

## API additions

`/functions/v1/api/upload-url` — new POST endpoint authenticated by
`rst_*` token (scope: `observe`). Returns a 5-minute presigned R2
PUT URL. Mirrors `/functions/v1/get-upload-url` (which requires a
Supabase JWT) for the token-based flow the CLI uses.

## File-type support

| Type | v1 | Notes |
|---|---|---|
| `.jpg`, `.jpeg`, `.png`, `.heic`, `.webp` | uploaded | EXIF GPS + DateTimeOriginal read |
| `.mp4`, `.mov`, `.m4v` | skipped, logged | Frame extraction pending — v1.1 follow-up |
| anything else | ignored | walker excludes them |

Videos are *recorded* in the log with `status: 'skipped'` so re-runs
don't re-walk them.

## Resumable

`import-log.json` (default location: `<dir>/import-log.json`) records
each file's outcome. Re-running the same command skips files already
at `status: 'uploaded'`. Saved every 10 files so a Ctrl-C loses at
most 9 in-flight entries.

## Out of v1 (tracked)

- Frame extraction for videos (needs ffmpeg or a JS demuxer; significant new dep)
- Per-file compression / resize before upload (would need `sharp` ~30 MB native; `compressIfLarge` from PWA is canvas-only)
- Web UI drag-and-drop ZIP upload (uses the same pipeline server-side)
- Concurrency / parallel uploads (v1 is sequential; SD-card I/O is the typical bottleneck so this is fine)
- HEIC → JPEG conversion (R2 stores any blob; the PWA's `<img>` falls back to a HEIC viewer hint when needed)

## Authentication / authorization

Tokens come from `https://rastrum.org/{en,es}/profile/tokens` with
the `observe` scope. The CLI sends `Authorization: Bearer rst_…`.
The Edge Function's `verifyToken('observe', supabase)` validates the
hash + scope before any R2 interaction.

## Testing

`cli/test/*.test.ts` — Node 20 built-in test runner via `--import
tsx`. Coverage: walker (recursion + dotfile/`__MACOSX` skip),
log (round-trip + summary), arg-parser. Network-touching code
(`api-client.ts`, `cli.ts orchestrator`) deliberately *not* unit
tested in v1 — exercised via manual end-to-end runs against a
staging Supabase project.
