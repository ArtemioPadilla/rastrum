# Storage Security: Restricting Anonymous LIST on the media bucket

> How the `media` bucket's RLS policies prevent unauthenticated bulk
> listing while keeping individual object reads public (required for
> CDN and direct image URLs).

## Background

Supabase Storage uses PostgreSQL RLS policies on `storage.objects`.
The `media` bucket is **public** (individual object reads don't require
auth, enabling CDN caching and direct `<img src>` usage), but
**anonymous LIST** — iterating all objects in the bucket — must be
restricted to authenticated users.

Without this restriction, any unauthenticated caller can enumerate every
uploaded photo in the bucket by calling the Storage API's list endpoint,
which is a privacy and data-harvesting risk.

**Key distinction:**

| Operation | Required auth | Why |
|-----------|--------------|-----|
| `GET /storage/v1/object/public/media/<path>` | None | Public CDN reads |
| `GET /storage/v1/object/media/<path>` (authenticated) | Optional | Signed URL path |
| `POST /storage/v1/object/list/media` (LIST) | **Authenticated** | Prevents bulk enumeration |

## The policy (already applied via supabase-schema.sql)

```sql
-- Restrict anonymous listing of media bucket.
-- Authenticated users can list objects; anonymous callers cannot.
-- Individual object reads remain public via the bucket's public=true flag.
DROP POLICY IF EXISTS "media_authenticated_list" ON storage.objects;
CREATE POLICY "media_authenticated_list" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] != '.keep'
  );
```

The `media_public_read` policy (bucket-wide `FOR SELECT USING (bucket_id = 'media')`)
handles unauthenticated *direct object reads*. The `media_authenticated_list`
policy narrows the `SELECT` right for the `authenticated` role so only
authenticated sessions can enumerate objects.

> **Note on Supabase Storage internals:** The Storage API's `/list` endpoint
> performs a `SELECT` with a prefix filter on `storage.objects`. RLS applies
> to that query, so denying `SELECT` to `anon` on `storage.objects` blocks
> listing without affecting the public read path (which uses a different
> code path that bypasses the list query).

## Verifying the policy in the Dashboard

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) →
   **Storage** → **Policies**.
2. Find the `storage.objects` table.
3. Confirm `media_authenticated_list` appears under **SELECT** policies.
4. Confirm it has role `authenticated` (not `anon` or `public`).

Alternatively, via SQL:

```sql
SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
ORDER BY policyname;
```

Expected: a row for `media_authenticated_list` with `roles = {authenticated}`,
`cmd = SELECT`.

## Verifying the restriction works

### Attempt an anonymous list (should be denied)

```bash
# No Authorization header → anon role
curl -s -X POST \
  "${SUPABASE_URL}/storage/v1/object/list/media" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "limit": 10}' \
  | python3 -m json.tool
```

Expected: an empty array `[]` or a `403`/`401` response — the bucket
cannot be enumerated anonymously.

### Confirm public individual reads still work

```bash
# Direct object read — no auth needed
curl -I "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/public/media/observations/<some-object-path>"
```

Expected: `HTTP/2 200` with `Content-Type: image/jpeg` (or similar).

### Authenticated list (should succeed)

```bash
# With a valid JWT from a signed-in user
curl -s -X POST \
  "${SUPABASE_URL}/storage/v1/object/list/media" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "observations/", "limit": 10}' \
  | python3 -m json.tool
```

Expected: array of object metadata entries for the authenticated user's
accessible objects.

## Schema location

The policies are defined in
`docs/specs/infra/supabase-schema.sql` under the
`STORAGE BUCKET + POLICIES` section. The full policy block:

```sql
-- STORAGE BUCKET + POLICIES
INSERT INTO storage.buckets (id, name, public, ...)
VALUES ('media', 'media', true, ...)
ON CONFLICT (id) DO NOTHING;

-- Upload: authenticated users only
CREATE POLICY "media_insert_authenticated" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media');

-- Update: authenticated users only
CREATE POLICY "media_update_authenticated" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'media');

-- Public read (individual objects — required for CDN)
CREATE POLICY "media_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');

-- Authenticated-only LIST (#830)
CREATE POLICY "media_authenticated_list" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] != '.keep');
```

## Rollback

If the policy causes unexpected issues (e.g. a legitimate anonymous
listing use-case is discovered), revert by removing the restrictive
policy:

```sql
DROP POLICY IF EXISTS "media_authenticated_list" ON storage.objects;
```

The broader `media_public_read` policy remains and individual object
reads continue to work. File a new issue to design a scoped alternative.

## See also

- `docs/specs/infra/supabase-schema.sql` — canonical policy definitions
- `docs/runbooks/leaked-password-protection.md` — related auth security runbook
- [Supabase Storage RLS docs](https://supabase.com/docs/guides/storage/security/access-control)
- Issue #830 — original tracking issue
