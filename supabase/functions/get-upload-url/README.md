# get-upload-url Edge Function

Issues 5-minute presigned PUT URLs for the Cloudflare R2 media bucket.
Implements module 10 (`docs/specs/modules/10-media-storage.md`).

## One-time Cloudflare setup

1. Sign up for Cloudflare and **create an R2 bucket** named `rastrum-media`.
2. Bucket → **Settings** → **Public access** → **Enable** for the custom domain
   `media.rastrum.app`. Cloudflare auto-creates the DNS record (CNAME to the
   R2 endpoint) and serves images via its CDN with no extra config.
3. R2 dashboard → **Manage API tokens** → **Create API token** with
   "Object Read & Write" on the bucket. Copy:
   - **Access Key ID**
   - **Secret Access Key**
4. **Account home → right sidebar → Account ID** (32-char hex). Copy.
5. (Optional) Cloudflare dashboard → **Rules** → **Transform Rules** →
   add a rule: when path matches `*.jpg` or `*.png`, **serve as WebP** when
   the client supports it. ~30–40% smaller for free.

## Set the function secrets

```bash
supabase secrets set \
  CF_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxx \
  R2_ACCESS_KEY_ID=xxxxxxxxxxxx \
  R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  R2_BUCKET_NAME=rastrum-media \
  R2_PUBLIC_URL=https://media.rastrum.app
```

## Set the build-time public env var

In `.env.local` (and as a GitHub secret for CI):

```
PUBLIC_R2_MEDIA_URL=https://media.rastrum.app
```

The presence of this var flips `src/lib/upload.ts` from Supabase Storage
to R2. Without it, uploads still work — they go to the Supabase Storage
fallback so the app stays functional throughout the migration.

## Deploy

```bash
supabase functions deploy get-upload-url
```

## Migrating existing observations from Supabase Storage to R2

If you've already uploaded any media via the Supabase Storage path:

```sql
-- 1. Pull a list of existing media URLs
COPY (
  SELECT id, url
  FROM media_files
  WHERE url LIKE '%supabase.co/storage/v1/%'
) TO STDOUT WITH CSV HEADER;
```

Then run a one-shot script (out of scope for this repo) that copies each
object from Supabase Storage to R2 and updates `media_files.url`. Until
that migration runs, mixed-storage state is fine — old URLs keep working
because Supabase Storage still serves them.
