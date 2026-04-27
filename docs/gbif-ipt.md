# GBIF IPT publishing

Operator notes for publishing Rastrum observations to the Global Biodiversity
Information Facility via the Integrated Publishing Toolkit (IPT).

This document covers two responsibilities the Rastrum codebase deliberately
does **not** automate:

1. Running an IPT instance.
2. Minting and rotating DOIs.

Both require human-in-the-loop steps that GBIF intentionally gates behind
the IPT admin UI. Rastrum produces the Darwin Core Archive (DwC-A) ZIP; an
IPT operator uploads it and clicks "Publish".

---

## What this code provides

| Piece | Path | Role |
|---|---|---|
| Edge Function | [`supabase/functions/export-dwca/index.ts`](../supabase/functions/export-dwca/index.ts) | Produces the DwC-A ZIP on demand |
| Pure builders | [`src/lib/dwca.ts`](../src/lib/dwca.ts) | meta.xml / eml.xml / occurrence.txt generators |
| Tests | [`src/lib/dwca.test.ts`](../src/lib/dwca.test.ts) | XML schema + obscuration enforcement |
| UI | [`src/components/ExportView.astro`](../src/components/ExportView.astro) | Per-user "Download DwC-A ZIP" form |
| CLI | [`scripts/publish-to-ipt.sh`](../scripts/publish-to-ipt.sh) | Service-role pull + optional SCP upload |

The Edge Function accepts both **user JWT** (per-observer export — typically
all that observer's research-grade rows) and **service-role bearer**
(full-corpus export for operators / cron). Sensitive-species coordinates
are obscured per the same rules the public RLS policy enforces in the
database; the only override is the `credentialed_researcher` flag on the
user record.

---

## What is GBIF IPT?

The [Integrated Publishing Toolkit](https://www.gbif.org/ipt) is a
self-hosted Java web application that:

- Versions Darwin Core Archive datasets
- Mints DataCite DOIs (when an organisation account is approved by GBIF)
- Publishes RSS feeds that the GBIF Network polls on a schedule
- Provides search/browse over the published occurrence records

GBIF does not host IPT instances for publishers. Each publisher (university,
NGO, citizen-science platform) runs their own. Common deployment patterns:

- **Hosted by a partner institution.** A nearby herbarium / museum already
  runs IPT and adds Rastrum as one of their managed resources.
- **Self-hosted on a small VM.** ~2 GB RAM, Tomcat 9, Java 11.
- **Hosted by GBIF nodes.** Some national nodes (CONABIO in Mexico,
  SiB Colombia, etc.) offer IPT-as-a-service for smaller publishers.

Pick whichever path the publishing organisation already has a relationship
with — **don't** stand up a fresh IPT just for Rastrum unless you have a
DevOps person who can keep it patched.

---

## End-to-end publishing flow

1. **One-time:** Apply for a GBIF publisher account at
   <https://www.gbif.org/become-a-publisher>. Review takes ~2 weeks.
2. **One-time:** Get the publisher org added as the owner of an IPT
   resource on whichever IPT instance is hosting Rastrum data.
3. **Recurring (manual or via the script below):**
   1. Generate a fresh DwC-A ZIP from the Rastrum Edge Function.
   2. Upload it to the IPT host's "source data" directory.
   3. In the IPT admin UI, mark the new file as the active source.
   4. Click **Publish** — IPT validates, versions, and mints a new DOI
      (if DataCite credentials are configured on the IPT instance).
   5. Wait ~24h for GBIF to index the new version.

Each `Publish` click in IPT is a versioned, citeable event. **Don't**
publish more than once a month unless the changeset is significant —
researchers cite specific DOI versions and excessive churn fragments
citation graphs.

---

## Calling the Edge Function

The function lives at:

```
GET https://<project-ref>.supabase.co/functions/v1/export-dwca
```

### Auth

Either:

- `Authorization: Bearer <user JWT>` — exports the caller's own observations.
- `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — exports the full
  corpus. Use this from the IPT host or from a trusted CI runner.

### Query params

| Param | Default | Meaning |
|---|---|---|
| `since` | (none) | ISO date — `eventDate ≥ since` |
| `until` | (none) | ISO date — `eventDate ≤ until` |
| `bbox`  | (none) | `west,south,east,north` decimal degrees, WGS84 |
| `quality` | `research_grade` | `research_grade` or `all` |
| `license` | `CC0-1.0` | Dataset-level license stamped into `eml.xml` |
| `include_multimedia` | `0` | Set to `1` to emit `multimedia.txt` |

### Response

Binary ZIP body. Useful response headers:

- `Content-Disposition: attachment; filename="rastrum-dwca-YYYY-MM-DD.zip"`
- `X-Rastrum-Records: N`
- `X-Rastrum-Multimedia: N`

### Sensitive species

Per-observation `obscure_level` is read from the database and applied
inside the function. Coordinates published to the DwC-A archive are
**always** the obscured grid centroid for non-credentialed callers. The
`obs_credentialed_read` RLS policy is mirrored in TypeScript so the
behaviour is identical whether the consumer reads via PostgREST or via
this function.

When `obscure_level` is non-`none`, the row carries:

- `informationWithheld = "Precise location withheld: sensitive species (<level>)"`
- `dataGeneralizations = "Coordinates rounded (<level>)"`
- `coordinateUncertaintyInMeters` ≥ the obscuration cell size.

This matches GBIF's recommended pattern for obscured occurrences and is
indexed by GBIF as a soft signal of data sensitivity.

---

## Using the helper script

```bash
export SUPABASE_URL=https://reppvlqejgoqvitturxp.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Pull the latest research-grade snapshot to disk
./scripts/publish-to-ipt.sh \
  --since 2025-01-01 \
  --quality research_grade \
  --license CC0-1.0 \
  --output ./out/rastrum-dwca-2026-04.zip
```

To upload to a remote IPT host in the same step, add the SCP env vars:

```bash
IPT_HOST=ipt.partner.example IPT_USER=ipt-deploy \
  IPT_DROP_DIR=/var/lib/ipt/sources \
  ./scripts/publish-to-ipt.sh --since 2025-01-01
```

Even with SCP enabled, the IPT operator still has to log in and click
**Publish** — IPT does not offer an unattended publish mode and we don't
emulate one.

---

## License implications

The Edge Function defaults to `CC0-1.0` for the dataset-level license
(matching GBIF's strong recommendation for biodiversity data). Per-record
license metadata is preserved in the `license` and `rightsHolder` columns,
so observers who chose `CC BY 4.0` or `CC BY-NC 4.0` retain that stamp
on their own rows.

GBIF's data-use rules require that **the dataset license is no more
restrictive than the most-restrictive per-record license**. Practically
this means:

- If the publisher organisation is comfortable releasing all rows under
  CC0, set `--license CC0-1.0` (the default).
- If observer license preferences are mixed, set the dataset license to
  `CC-BY-4.0` (the most permissive license that still credits observers).
- Avoid `CC-BY-NC-4.0` at the dataset level — it disqualifies the
  dataset from many GBIF-derived analyses and most journal data deposits.

The PWA's per-observer license setting (`users.observer_license`) is the
authoritative source for per-row license; the dataset license in
`eml.xml` is the umbrella that GBIF aggregators read.

---

## Data flow diagram

```
Observer (PWA)
    │
    └─> observations (Supabase / PostGIS, RLS-protected)
            │
            ├── obs_owner               (observer reads own precise coords)
            ├── obs_public_read         (everyone reads obscured coords)
            └── obs_credentialed_read   (verified researchers read precise)

              │
              ├──> CSV export (existing)         /profile/export
              │
              └──> DwC-A export (this module)    /functions/v1/export-dwca
                        │
                        ▼
                  rastrum-dwca-YYYY-MM-DD.zip
                        │
                        ▼
                  scripts/publish-to-ipt.sh   (operator runs)
                        │
                        ▼
                  IPT host (operator-managed, e.g. ipt.partner.example)
                        │
                        ▼
                  GBIF.org (indexed via IPT RSS, ~24h latency)
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| IPT validation fails on `meta.xml` | Tab vs comma mismatch | The function emits TSV; do not edit `occurrence.txt` to comma-separated |
| `eml.xml` missing required fields | EML 2.1.1 expects `creator`, `contact`, `title`, `pubDate` | All four are emitted unconditionally; if it still fails, check the schema reference URL hasn't moved |
| Published archive empty | `quality=research_grade` and no rows are research-grade yet | Toggle `quality=all` for the first publish to seed the dataset; switch back once researcher validation kicks in |
| GBIF flags "license too restrictive" | Dataset-level license is CC BY-NC but rows have CC0 | Match the dataset license to the **most permissive** per-row license |
| Records appear with imprecise coords for known-good rows | Observer is not flagged `credentialed_researcher` and self-export is being run via service-role | Run the export under the user's JWT, or set the credentialed flag |

---

## Deploy / redeploy the Edge Function

Edge Function deploys go through CI (the local `supabase` CLI 2.90.0
has a regression on this project's config — see `AGENTS.md`):

```bash
gh workflow run deploy-functions.yml -f function=export-dwca
gh run watch
```

The function name `export-dwca` is one of the choices declared in
[`.github/workflows/deploy-functions.yml`](../.github/workflows/deploy-functions.yml).
Pass `function=all` to redeploy every function in one run.

---

## Future work

The roadmap item [`gbif-publisher`](./progress.json) tracks deeper
integration: monthly cron, DOI tracking in a `dataset_versions` table,
automatic POST to the IPT REST API once GBIF stabilises that surface. For
now, manual operator action keeps publishing intentional and auditable.
