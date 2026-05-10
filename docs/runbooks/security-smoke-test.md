# Production Smoke Test: Security Advisor Remediation (#828 + #829)

> **Context.** PR #828 shipped 17 view flips to `security_invoker`, a
> `REVOKE EXECUTE FROM PUBLIC` loop on all user-defined SECURITY DEFINER
> functions, a `pg_trgm` extension move to the `extensions` schema, and a
> bulk `SET search_path` on every `pl*` function. PR #829 hotfixed a
> false-positive in the `search_path` loop that tripped on PostGIS-owned
> functions during the post-merge `db-apply`.
>
> This runbook is the checklist to run **once both PRs have merged and
> `db-apply` has succeeded** to confirm everything is working in production.

---

## Prerequisites

```bash
# Env vars needed throughout this runbook
export SUPABASE_ACCESS_TOKEN="<your personal access token>"
export SUPABASE_PROJECT_REF="<project ref slug, e.g. abcxyzabcxyz>"
export SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
export SUPABASE_ANON_KEY="<project anon key>"
export SUPABASE_SERVICE_ROLE_KEY="<project service role key>"
```

You need:
- A **known public username** (a user who hasn't set `hide_profile = true`)
- A **known public observation UUID** (any confirmed observation)
- A test user account (signed in) for authenticated checks
- A **moderator account** for privileged checks
- An **admin account** for admin checks

---

## 1. Anonymous (signed-out) sanity

These routes must work without any auth token. Failures here indicate a
`security_invoker` view is incorrectly blocking anon reads, or a PostGIS
view lost its extension dependency context.

### 1.1 Public profile page

```bash
curl -si "https://rastrum.org/profile/u/<known-public-username>" | head -5
# Expect: HTTP/2 200
```

In browser (unauthenticated): `/profile/u/<username>` → pokedex, karma,
top species, badges all render with data. No empty panels.

### 1.2 Share observation page

```bash
curl -si "https://rastrum.org/share/obs/?id=<known-public-obs-uuid>" | head -5
# Expect: HTTP/2 200
```

In browser: photos load, identifications panel shows the ID history.

### 1.3 Explore recent

```bash
curl -si "https://rastrum.org/explore/recent" | head -5
# Expect: HTTP/2 200
```

In browser: observation list populates (not empty / loading forever).

### 1.4 Explore map (PostGIS GIN/GIST path)

In browser (unauthenticated): `/explore/map` → pins and clusters render.
This exercises `places_map_geojson()` and the PostGIS geometry functions
through `security_invoker` views.

```bash
# Spot-check the RPC directly
curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/places_map_geojson" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"p_limit": 5}' | python3 -m json.tool | head -20
# Expect: JSON array with geometry objects, no error
```

### 1.5 Community leaderboard

```bash
curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/karma_leaderboard_window" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"p_limit": 5, "p_offset": 0}' | python3 -m json.tool | head -30
# Expect: JSON array of leaderboard rows
# Verify: none of the returned users have hide_from_leaderboards = true
```

In browser: `/community/observers` → leaderboard loads.

---

## 2. Authenticated sanity

Sign in as a regular test user before running these checks.

### 2.1 Own profile page

In browser (signed in): `/profile/me/` → own pokedex, activity feed, streak
all load. Check the activity feed isn't empty if the user has made observations.

### 2.2 Nearby observers (PostGIS path)

```bash
# Replace with valid JWT for a signed-in user
export USER_JWT="<user access token from supabase.auth.getSession()>"

curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/community_observers_nearby_at" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"p_lat": 19.43, "p_lng": -99.13, "p_radius_km": 50, "p_limit": 5}' \
  | python3 -m json.tool | head -20
# Expect: JSON array (may be empty if no users near those coords)
# Must NOT return a 403 or 500
```

In browser: `/community/observers/?nearby=1` with location access allowed →
observer list renders.

### 2.3 Inbox notifications

In browser (signed in): `/inbox` → notification list loads (may be empty).
No 500 errors in the browser console.

### 2.4 Submit a test observation

```bash
curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/observations" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "observer_id": "<your-user-uuid>",
    "latitude": 19.43,
    "longitude": -99.13,
    "observed_at": "now()",
    "notes": "smoke-test obs #828 verify"
  }' | python3 -m json.tool | head -20
# Expect: 201 Created with the new observation row
```

In browser: newly submitted observation appears in `/profile/me/`.

---

## 3. Privileged sanity

### 3.1 Moderator: validation queue

Sign in as a moderator. Navigate to `/console/validate`.

```bash
export MOD_JWT="<moderator access token>"

curl -s \
  "${SUPABASE_URL}/rest/v1/validation_queue?limit=5" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${MOD_JWT}" \
  | python3 -m json.tool | head -30
# Expect: JSON array of rows (or empty array if queue is clear)
# Must NOT return a 403 or RLS error
```

### 3.2 Admin: health digest recompute

Sign in as an admin. Navigate to `/console/health`.

```bash
export ADMIN_JWT="<admin access token>"

curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/compute_admin_health_digest" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool | head -20
# Expect: JSON result with health digest data
# Must NOT return 403 (would mean the service_role grant broke)
```

> **Note:** `compute_admin_health_digest` is `service_role`-only. The admin
> console calls it via an Edge Function that uses the service role key.
> A direct call with `ADMIN_JWT` (authenticated role) will return 403 — that
> is the expected and correct behavior. Test this via the UI, not curl.

---

## 4. Advisor verification

### 4.1 Fetch current findings via Management API

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Accept: application/json" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

by_level = {}
for f in findings:
    level = (f.get('level') or f.get('severity') or 'unknown').upper()
    by_level.setdefault(level, []).append(f)

print(f"Total findings: {len(findings)}")
for level, items in sorted(by_level.items()):
    print(f"\n{level} ({len(items)}):")
    for item in items[:10]:
        name = item.get('name') or item.get('title') or item.get('type') or 'unknown'
        desc = item.get('description') or item.get('message') or ''
        table = item.get('metadata', {}).get('table', '') or item.get('table', '')
        loc = f' [{table}]' if table else ''
        print(f"  - {name}{loc}: {desc[:80]}")
    if len(items) > 10:
        print(f"  ... and {len(items)-10} more")
PYEOF
```

### 4.2 Confirm PR #828 findings cleared

Check the following 17 "Security Definer View" entries are **no longer present**
(or have moved to accepted/ignored):

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

EXPECTED_CLEARED = [
    'community_observers',
    'community_observers_with_centroid',
    'featured_species_current',
    'moderator_trust_scores',
    'profile_activity_feed',
    'profile_badges_visible',
    'profile_calendar_buckets',
    'profile_karma',
    'profile_observation_pins',
    'profile_pokedex',
    'profile_stats_counts',
    'profile_taxonomic_donut',
    'profile_top_species',
    'profile_validation_reputation',
    'taxa_thumbnails',
    'user_expertise_regional',
    'validation_queue',
]

# Look for security_definer_view / security-definer-view findings
definer_view_findings = [
    f for f in findings
    if 'definer' in (f.get('name') or f.get('title') or '').lower()
    or 'definer' in (f.get('type') or '').lower()
]

still_present = []
for view_name in EXPECTED_CLEARED:
    for f in definer_view_findings:
        desc = json.dumps(f)
        if view_name in desc:
            still_present.append(view_name)
            break

if still_present:
    print(f"FAIL: {len(still_present)} security-definer-view findings still present:")
    for v in still_present:
        print(f"  - {v}")
    sys.exit(1)
else:
    print(f"PASS: None of the 17 expected-cleared views appear in current findings.")
    print(f"      Total definer-view findings: {len(definer_view_findings)}")
PYEOF
```

### 4.3 Confirm PUBLIC-callable SECURITY DEFINER findings cleared

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

# "Public Can Execute SECURITY DEFINER Function" — should be cleared
public_definer = [
    f for f in findings
    if 'public' in (f.get('name') or f.get('title') or '').lower()
    and 'definer' in (f.get('name') or f.get('title') or '').lower()
]
print(f"'Public Can Execute SECURITY DEFINER Function' findings: {len(public_definer)}")
if public_definer:
    print("Still present (should be 0 after #828):")
    for f in public_definer[:5]:
        print(f"  - {json.dumps(f)[:120]}")
else:
    print("PASS: none found ✓")
PYEOF
```

### 4.4 Confirm "Function Search Path Mutable" cleared

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

search_path_findings = [
    f for f in findings
    if 'search_path' in (f.get('name') or f.get('title') or '').lower()
    or 'mutable' in (f.get('name') or f.get('title') or '').lower()
]
print(f"'Function Search Path Mutable' findings: {len(search_path_findings)}")
if search_path_findings:
    print("Still present (should be 0 after #828):")
    for f in search_path_findings[:5]:
        print(f"  - {json.dumps(f)[:120]}")
else:
    print("PASS: none found ✓")
PYEOF
```

### 4.5 Confirm "Extension in Public — pg_trgm" cleared

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

ext_in_public = [
    f for f in findings
    if 'extension' in (f.get('name') or f.get('title') or '').lower()
    and 'public' in json.dumps(f).lower()
]
print(f"'Extension in Public' findings: {len(ext_in_public)}")
for f in ext_in_public:
    name = f.get('name') or f.get('title') or 'unknown'
    desc = f.get('description') or f.get('message') or ''
    print(f"  - {name}: {desc[:100]}")
# Expect: postgis and pg_net remain (accepted), pg_trgm should be gone
pg_trgm_present = any('trgm' in json.dumps(f).lower() for f in ext_in_public)
if pg_trgm_present:
    print("FAIL: pg_trgm still showing as Extension in Public")
    sys.exit(1)
else:
    print("PASS: pg_trgm not in Extension-in-Public findings ✓")
    print("NOTE: postgis and pg_net findings are expected (accepted per #832 runbook)")
PYEOF
```

### 4.6 Confirm advisor "Critical" count = 0

After #828 + #829, the Supabase Dashboard should show:
- **Critical: 0** (all 17 + ~50 + search_path findings cleared)
- **Warning:** only the accepted findings documented in
  `docs/runbooks/accepted-advisor-findings.md`

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/lint" \
  | python3 - << 'PYEOF'
import json, sys

data = json.load(sys.stdin)
findings = data if isinstance(data, list) else data.get('data', [])

critical = [
    f for f in findings
    if (f.get('level') or f.get('severity') or '').upper() in ('ERROR', 'CRITICAL')
]
warn = [
    f for f in findings
    if (f.get('level') or f.get('severity') or '').upper() in ('WARN', 'WARNING')
]
info = [f for f in findings if f not in critical and f not in warn]

print(f"Critical/Error: {len(critical)}")
print(f"Warning:        {len(warn)}")
print(f"Info:           {len(info)}")
print(f"Total:          {len(findings)}")

if critical:
    print("\nFAIL: Critical findings that need resolution:")
    for f in critical:
        print(f"  - {json.dumps(f)[:150]}")
    sys.exit(1)
else:
    print("\nPASS: 0 critical/error findings ✓")
PYEOF
```

---

## 5. Expected Advisor State After #828 + #829

| Category | Before #828 | After #828 + #829 | Status |
|---|---|---|---|
| Security Definer Views | 17 critical | 0 | ✓ cleared |
| Public-callable SECURITY DEFINER | ~50 warn | 0 | ✓ cleared |
| Function Search Path Mutable | ~150 warn | 0 | ✓ cleared |
| Extension in Public (pg_trgm) | 1 warn | 0 | ✓ cleared |
| Extension in Public (postgis) | 1 warn | 1 warn | accepted (#832) |
| Extension in Public (pg_net) | 1 warn | 1 warn | accepted (#832) |
| RLS Disabled (spatial_ref_sys) | 1 warn | 1 warn | accepted (#832) |
| Materialized View in API | 4 warn | 4 warn | accepted (#832) |
| Signed-In Can Execute DEFINER | ~80 warn | ~80 warn | accepted (#832) |

---

## 6. Rollback plan

If any of the 17 views stop returning data for anonymous users after the
`security_invoker` flip, the root cause is almost certainly a missing
RLS policy on an underlying table — not the view itself.

```bash
# Check which tables the broken view reads from:
psql "$DATABASE_URL" -c "\d+ public.<view_name>"

# Check if the underlying table has RLS enabled:
psql "$DATABASE_URL" -c "
  SELECT relname, relrowsecurity
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN (<tables from view definition>);
"

# If a table lacks RLS and it's breaking anon reads, add a permissive policy:
# CREATE POLICY <view_name>_anon_read ON public.<table>
#   FOR SELECT USING (true);   -- only if data is genuinely public
```

For immediate rollback while investigating:
```sql
-- Revert a specific view to security_definer (emergency only)
ALTER VIEW public.<view_name> SET (security_invoker = false);
```

---

## 7. Refs

- PR #828: Security Advisor remediation (17 view flips + REVOKE + search_path)
- PR #829: Hotfix — search_path loop on PostGIS-owned functions
- Accepted findings: `docs/runbooks/accepted-advisor-findings.md`
- Storage security follow-up: issue #830
- Leaked password protection: issue #831
