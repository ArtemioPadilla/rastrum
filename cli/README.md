# `rastrum-import` — batch CLI for camera-trap memory cards

Walks a directory tree of images (an SD card dump from a camera trap),
extracts EXIF GPS + timestamp from each photo, uploads to R2, and
creates an observation in Rastrum via the `rst_*` API token.

Resumable: re-running on the same directory skips files already
uploaded (matched by absolute path in `import-log.json`).

## Install

```bash
cd cli
npm install
npm run build
```

Or run from source via tsx:

```bash
npm install
node --import tsx src/cli.ts --help   # exits 2 on missing args
```

## Usage

```bash
rastrum-import \
  --dir /Volumes/SD_CARD/DCIM \
  --baseUrl https://<proj>.supabase.co/functions/v1 \
  --token rst_yourpersonaltoken \
  --notes "Station SJ-CAM-01"
```

### Flags

| Flag | Description |
|---|---|
| `--dir <path>`         | (required) directory to walk recursively |
| `--baseUrl <url>`      | (required) Edge Function base. Or set `RASTRUM_BASE_URL`. |
| `--token rst_…`        | (required) personal API token. Or set `RASTRUM_TOKEN`. |
| `--log <path>`         | resumable log location. Default: `<dir>/import-log.json` |
| `--dry-run`            | walk + EXIF only, no uploads |
| `--skip-identify`      | upload + create obs but don't run AI identification |
| `--notes "<text>"`     | apply to every observation (e.g. station code) |
| `--verbose` / `-v`     | one log line per file (default: every 10) |

### Get a token

`https://rastrum.org/{en,es}/profile/tokens` — generate a token with
the `observe` scope. Tokens never appear again after creation.

### File types

- **Images** — `.jpg`, `.jpeg`, `.png`, `.heic`, `.webp`. EXIF GPS +
  `DateTimeOriginal` are read. Files with no GPS still upload, but
  the observation has no location and won't be auto-tagged to any
  project polygon (M29).
- **Videos** — `.mp4`, `.mov`, `.m4v` are detected but **skipped in
  v1**. They're recorded as `status: skipped` in the log so re-runs
  don't retry them. Video frame extraction is a v1.1 follow-up.

## Auto-tagging into projects (M29)

If you've created a project polygon (`/{en,es}/projects/new/`) before
running the import, observations whose EXIF GPS falls inside the
polygon are auto-tagged to that project by the
`assign_observation_to_project_trigger`. No flag needed — the trigger
runs server-side on every INSERT.

To re-tag historical imports against a fresh project polygon, run the
backfill UPDATE in `docs/runbooks/projects-anp.md`.

## Resumable behaviour

The first run of a 500-photo SD card writes `import-log.json` after
every 10 files. If the run is interrupted (Ctrl-C, network drop, power
loss), re-run the same command — files already at `status: uploaded`
are skipped, and the run resumes from where it left off.

To force a re-upload, delete the log or remove the relevant lines.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every file `FAIL upload-url: 401` | Token revoked or wrong scope (needs `observe`). |
| Every file `FAIL upload-url: 500` | R2 not configured on the deploy — check Edge Function secrets. |
| Files with EXIF GPS upload with `lat=null lng=null` | EXIF stripped by camera or third-party tool. CLI logs a warning per file. |
| `OK` but no project_id assigned | The polygon doesn't cover the EXIF coords (≤1 km tolerance), or the project visibility excludes the importing user. |

## Testing the CLI itself

```bash
npm run test
```

Tests use Node's built-in test runner (`node --test`) + tsx, no vitest
dependency. The walker, log, and arg-parser have unit coverage.
