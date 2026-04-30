# CLI batch import (M30) — runbook

> **Spec:** [`docs/specs/modules/30-cli-batch-import.md`](../specs/modules/30-cli-batch-import.md).
> **Code:** [`cli/`](../../cli/) — Node 20+ TypeScript package.
> **Edge Function endpoint:** `POST /functions/v1/api/upload-url` (added by PR #134).

## Install on the operator machine

```bash
cd cli
npm install
npm run build
# Optional: link globally so `rastrum-import` is on PATH
npm link
```

The CLI is **not published to npm** in v1 — install from the repo
checkout. Bundle size is small (~1 MB including `exifr`); no
optimisation work is planned for v1.

## Generate an API token

`https://rastrum.org/{en,es}/profile/tokens` → **New token** with
the `observe` scope. The plaintext is shown once at creation; copy
it into the operator's `~/.rastrum/env` or pass via
`RASTRUM_TOKEN` env var.

```bash
export RASTRUM_BASE_URL=https://reppvlqejgoqvitturxp.supabase.co/functions/v1
export RASTRUM_TOKEN=rst_…
```

## Pre-import checklist

1. **Project polygon registered (optional but recommended)** —
   create a project at `/{en,es}/projects/new/` covering the
   sampling area. Observations whose EXIF GPS falls inside auto-tag
   to the project via the M29 trigger.
2. **Camera-trap photos with EXIF GPS + DateTimeOriginal** — the CLI
   reads both. Photos without GPS still upload but stay
   project-untagged.
3. **Sufficient pool / sponsorship credits** — each `--skip-identify`
   call consumes the BYO/sponsor key once for `identify`. For 500+
   photos, prefer `--skip-identify` and identify selectively from
   the UI later.

## Run

```bash
rastrum-import \
  --dir /Volumes/SD_CARD/DCIM \
  --baseUrl "$RASTRUM_BASE_URL" \
  --token   "$RASTRUM_TOKEN" \
  --notes   "Station SJ-CAM-01 — first deployment 2025-04-01..2025-04-15"
```

Default log location: `<dir>/import-log.json`. Override with
`--log /var/log/rastrum/import.json`.

## Resumability

Re-running the same command skips files already at
`status: 'uploaded'` in the log. Saved every 10 files so a Ctrl-C
loses at most 9 in-flight entries.

To force a re-upload of a single file: edit the log, remove that
file's entry, re-run.

To force a full re-upload: delete `import-log.json`. This will
duplicate observations on the server.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `FAIL upload-url: 401` | Token revoked or wrong scope | Generate a new token with `observe` scope |
| `FAIL upload-url: 500` | R2 not configured on deploy | Verify `CF_ACCOUNT_ID` / `R2_BUCKET_NAME` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_PUBLIC_URL` Edge Function secrets |
| Files with EXIF GPS upload as `lat=null lng=null` | EXIF stripped by camera or third-party tool | Run `exiftool -GPSLatitude -GPSLongitude photo.jpg` to confirm; if blank, the photo lost its metadata before reaching the CLI |
| `OK` but no `project_id` assigned | Polygon doesn't cover the EXIF coords (≤1 km tolerance), or project visibility excludes the importing user | Verify polygon via `make db-psql` + `SELECT id FROM projects WHERE ST_Covers(polygon, ST_SetSRID(ST_MakePoint(<lng>,<lat>), 4326))` |
| Spinner "Identifying…" hangs on a photo | Identify EF timed out | Re-run with `--skip-identify`; identify selectively from the UI |

## Backfill `project_id` on already-imported observations

The auto-tag trigger only fires on INSERT/UPDATE OF location. To
re-tag historical imports against a freshly-created polygon:

```sql
UPDATE public.observations o
   SET project_id = p.id
  FROM public.projects p
 WHERE o.project_id IS NULL
   AND o.location  IS NOT NULL
   AND ST_Covers(p.polygon, o.location);
```

(Same SQL as the M29 runbook. Idempotent.)

## v1.1 follow-ups

- Frame extraction for `.mp4`/`.mov` (currently `status: 'skipped'`)
- `--station-key <key>` flag to populate `observations.camera_station_id` for M31
- Web UI drag-and-drop ZIP upload using the same pipeline server-side
- Concurrent uploads (sequential in v1)
- HEIC → JPEG conversion (R2 stores any blob; PWA viewer falls back gracefully)
