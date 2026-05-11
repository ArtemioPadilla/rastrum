# Supabase Support Ticket — spatial_ref_sys RLS False Positive (#839)

**Status:** Ticket submitted to Supabase support 2026-05-11  
**Project:** rastrum-dev (northamerica-south1)

## Problem

The Database Security Advisor flags `public.spatial_ref_sys` as "RLS Disabled in Public — critical."  
This is a **false positive** — `spatial_ref_sys` is a PostGIS extension-owned table that customers cannot ALTER.

### Reproduction
```sql
-- All of these fail:
ALTER TABLE spatial_ref_sys ENABLE ROW LEVEL SECURITY;
-- ERROR 42501: must be owner of table spatial_ref_sys

-- REVOKE succeeds but is a no-op (Supabase grants SELECT directly to anon/authenticated)
REVOKE SELECT ON spatial_ref_sys FROM PUBLIC;
```

## Fix requested from Supabase

Update the Advisor predicate to exempt extension-owned tables:
```sql
AND NOT EXISTS (
  SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
)
```

## Current workaround

- Marked as Ignored in Dashboard with rationale
- Listed in `docs/runbooks/accepted-advisor-findings.md`
- Our CI `db-advisor-smoke.yml` workflow skips this finding via name filter

## Ticket reference

Submit at: https://supabase.com/dashboard/support/new  
Category: Database / Security Advisor  
Copy-paste: See `/tmp/supabase-ticket-839.md` on the gateway
