# Accepted Advisor Findings — Rationale & Suppression

> **Context.** After PRs #828 + #829 land, the Supabase Database Advisor
> will still surface several entries that we've **explicitly chosen to accept**.
> This runbook documents each one so the next operator review of the advisor
> doesn't chase findings that are already known and intentional.

---

## How to mark findings accepted in the Supabase Dashboard

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Navigate to **Database → Advisors → Security** (or **Performance**,
   depending on the finding category).
3. Click the finding entry to expand it.
4. Click **"Ignore"** (or **"Suppress"**) and paste the rationale text from
   the table below as the reason.
5. The entry moves to the "Ignored" tab and no longer inflates the visible count.

> **Note:** There is currently no stable Management API endpoint to
> programmatically suppress individual advisor findings. The API exposes
> `GET /v1/projects/{ref}/advisors/lint` (read-only). Suppression is a
> dashboard-only action. The `db-advisor-smoke.yml` CI workflow uses the API
> to fail on unfamiliar ERROR-level findings; ignored findings are excluded
> from that check automatically.

---

## Accepted Findings

### 1. RLS Disabled in Public — `public.spatial_ref_sys`

| Field | Value |
|---|---|
| **Finding type** | `rls_disabled_in_public` |
| **Table** | `public.spatial_ref_sys` |
| **Severity** | Warning |
| **Accepted since** | PR #828 (2026-05-08) |

**Rationale:** `spatial_ref_sys` is a PostGIS system table installed and
owned by the PostGIS extension. It contains SRID/projection metadata (the
same 5000+ rows on every PostGIS install — none of it is user data or
sensitive). We attempted to enable RLS on it in PR #828 (see the
`DO $$ BEGIN ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN insufficient_privilege …` block at the end of
`supabase-schema.sql`), but the hosted Supabase apply role cannot `ALTER` a
table owned by a higher-privilege extension role. The `DO` block swallows
`insufficient_privilege` so the apply doesn't fail.

**Impact:** None. The data is non-sensitive public SRID metadata. Anonymous
users cannot obtain any private information from this table even without RLS.

**Management API check:**

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 -c "
import json,sys
data=json.load(sys.stdin)
findings=data if isinstance(data,list) else data.get('data',[])
rls=[f for f in findings if 'spatial_ref_sys' in json.dumps(f)]
print(f'spatial_ref_sys findings: {len(rls)}')
[print(f'  {json.dumps(f)[:150]}') for f in rls]
"
```

---

### 2. Extension in Public — `public.postgis`

| Field | Value |
|---|---|
| **Finding type** | `extension_in_public` |
| **Extension** | `postgis` |
| **Severity** | Warning |
| **Accepted since** | PR #828 (2026-05-08) |

**Rationale:** Moving PostGIS out of the `public` schema post-install is an
industry-known anti-pattern. Every `geometry` and `geography` column across
the entire schema was created with PostGIS types in `public`; every spatial
operator, index opclass (`gist_geometry_ops_nd`, etc.), and function
(`ST_AsGeoJSON`, `ST_Within`, etc.) resolves from `public`. Relocating the
extension would require rewriting every column definition, every spatial
index, and every function body that references those types.

`pg_trgm` *was* moved (PR #828 — it has no column-level dependencies in the
rastrum schema), confirming we will relocate extensions when it's low-risk.
PostGIS is the opposite case.

**Management API check:**

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 -c "
import json,sys
data=json.load(sys.stdin)
findings=data if isinstance(data,list) else data.get('data',[])
postgis=[f for f in findings if 'postgis' in json.dumps(f).lower() and 'extension' in json.dumps(f).lower()]
print(f'postgis extension findings: {len(postgis)} (expected: 1, accepted)')
"
```

---

### 3. Extension in Public — `public.pg_net`

| Field | Value |
|---|---|
| **Finding type** | `extension_in_public` |
| **Extension** | `pg_net` |
| **Severity** | Warning |
| **Accepted since** | PR #828 (2026-05-08) |

**Rationale:** `pg_net`'s functions (`net.http_post`, `net.http_get`, etc.)
live in a self-managed `net` schema **regardless of where the extension is
installed**. The advisor warning reflects where the extension record is
registered in `pg_extension`, not where the callable functions live.
Moving the extension registration would not change the `net.*` function
locations — all existing `net.http_post(…)` calls in the schema would keep
working unchanged. The warning is therefore purely cosmetic.

**Management API check:**

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 -c "
import json,sys
data=json.load(sys.stdin)
findings=data if isinstance(data,list) else data.get('data',[])
pgnet=[f for f in findings if 'pg_net' in json.dumps(f) or 'pgnet' in json.dumps(f).lower()]
print(f'pg_net findings: {len(pgnet)} (expected: 1, accepted)')
"
```

---

### 4. Materialized View in API Schema

| Field | Value |
|---|---|
| **Finding type** | `materialized_view_in_api` |
| **Views** | `karma_leaderboard_30d`, `mv_taxon_obs_counts`, `species_taxonomy_counts`, `mv_platform_stats` |
| **Severity** | Warning |
| **Accepted since** | PR #828 (2026-05-08) |

**Rationale:** All four materialized views expose **aggregate, public-by-design
data**. They are intentionally in the API schema so PostgREST can query them.

- `karma_leaderboard_30d` — filters `hide_from_leaderboards = false` (verified
  at line 7804 of `supabase-schema.sql`). Users who opt out are excluded.
- `mv_taxon_obs_counts` — aggregate species observation counts. No user PII.
- `species_taxonomy_counts` — aggregate taxonomy rollup. No user PII.
- `mv_platform_stats` — platform-wide aggregate stats (total obs, users, etc.).
  No user PII.

None of these views expose row-level user data — they are all pre-aggregated
summaries. The advisor warning is a blanket "materialized views can't have RLS"
notice; in this case the data doesn't need RLS because it contains no
private rows.

**Management API check:**

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 -c "
import json,sys
data=json.load(sys.stdin)
findings=data if isinstance(data,list) else data.get('data',[])
mv_views=['karma_leaderboard_30d','mv_taxon_obs_counts','species_taxonomy_counts','mv_platform_stats']
for v in mv_views:
    hits=[f for f in findings if v in json.dumps(f)]
    print(f'{v}: {len(hits)} finding(s) (accepted)')
"
```

---

### 5. Signed-In Users Can Execute SECURITY DEFINER Function (~80 entries)

| Field | Value |
|---|---|
| **Finding type** | `auth_users_able_to_execute_security_definer_function` (or similar) |
| **Count** | ~80 functions |
| **Severity** | Warning |
| **Accepted since** | PR #828 (2026-05-08) |

**Rationale:** The blanket `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
TO authenticated` at line ~563 gives every signed-in user `EXECUTE` on every
SECURITY DEFINER function in `public`. This is the design trade-off documented
in issue #834.

Every one of these ~80 functions does its own **internal authorization**:
- Functions that require admin/moderator check `has_role(auth.uid(), 'admin')`
  or `has_role(auth.uid(), 'moderator')` at the start of the function body.
- Functions that operate on user-owned data check `auth.uid() = owner_id`.
- The blanket grant does not bypass these per-function checks — it only allows
  the function to be **called**, not to succeed without authorization.

The alternative (per-function explicit grants) was evaluated in issue #834 and
its audit runbook (`docs/runbooks/per-function-grant-audit.md`). The only
actionable case found was `prune_old_notifications`, which was restricted to
`service_role` in #834. All remaining ~80 functions are either:
- Appropriately public RPCs that `authenticated` users legitimately call, OR
- Trigger functions (`RETURNS trigger`) which Postgres blocks from direct
  `supabase.rpc()` calls regardless of grants.

`infra/lint-schema-security.sql` Check 2 enforces that none of these are
`PUBLIC`-callable (the more dangerous exposure). The advisor warning for
`authenticated` access is accepted.

**Management API check:**

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 -c "
import json,sys
data=json.load(sys.stdin)
findings=data if isinstance(data,list) else data.get('data',[])
authed_definer=[
    f for f in findings
    if any(kw in json.dumps(f).lower()
           for kw in ['auth_users_able_to_execute','signed-in','signed_in'])
]
print(f'Signed-in-can-execute-definer findings: {len(authed_definer)} (accepted)')
"
```

---

## Summary Verification

Run this to confirm all accepted findings are present (not cleared by accident)
and no new unexpected findings have appeared:

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

EXPECTED_ACCEPTED_KEYWORDS = [
    'spatial_ref_sys',   # RLS disabled — PostGIS table
    'postgis',           # Extension in public
    'pg_net',            # Extension in public
    'karma_leaderboard_30d',   # Materialized view in API
    'mv_taxon_obs_counts',     # Materialized view in API
    'species_taxonomy_counts', # Materialized view in API
    'mv_platform_stats',       # Materialized view in API
]

raw = json.dumps(findings)
print("Accepted findings presence check:")
for kw in EXPECTED_ACCEPTED_KEYWORDS:
    present = kw.lower() in raw.lower()
    status = "present (expected)" if present else "NOT FOUND (was it cleared?)"
    print(f"  {kw}: {status}")

# Check for new critical/error findings
critical = [
    f for f in findings
    if (f.get('level') or f.get('severity') or '').upper() in ('ERROR', 'CRITICAL')
]
print(f"\nCritical/Error findings: {len(critical)}")
if critical:
    print("UNEXPECTED — investigate:")
    for f in critical:
        print(f"  {json.dumps(f)[:150]}")
else:
    print("PASS: 0 critical findings ✓")

total = len(findings)
print(f"\nTotal advisor findings: {total}")
PYEOF
```

---

## Refs

- PR #828 — Security Advisor remediation (17 view flips + REVOKE + search_path)
- PR #829 — Hotfix: search_path loop on PostGIS-owned functions
- Issue #832 — This runbook (mark accepted findings)
- Issue #834 — Per-function grant audit (`docs/runbooks/per-function-grant-audit.md`)
- Smoke test: `docs/runbooks/security-smoke-test.md`
- CI advisor check: `.github/workflows/db-advisor-smoke.yml`
