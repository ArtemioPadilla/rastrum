# Module 10 — Media Storage (Cloudflare R2 + CDN)

**Version target:** v0.1
**Status:** Code shipped — operator must provision R2 + DNS to activate.

**Code shipped (commit 1b7ba04 onwards):**
- `supabase/functions/get-upload-url/` — presigned PUT URL service with
  per-user prefix scoping + JWT validation. README documents the
  Cloudflare account / bucket / DNS / token / Transform-Rules setup.
- `src/lib/upload.ts` — client helper: `resizeImage()` (≤1200px JPEG q=0.85
  via OffscreenCanvas) + `uploadMedia()` (auto-routes to R2 or Supabase
  Storage based on `PUBLIC_R2_MEDIA_URL` presence).
- `src/lib/sync.ts` — observation sync resizes images then calls
  `uploadMedia()` instead of writing directly to Supabase Storage.

**Activation switch:** set `PUBLIC_R2_MEDIA_URL` in `.env.local` (and as a
GitHub secret for CI). With it absent, the build keeps using Supabase
Storage. With it present, every new upload goes to R2.

---

## Overview

All observation media (photos, audio, video, camera trap images) stored on
Cloudflare R2. Zero egress fees make R2 the correct choice for an image-heavy
biodiversity platform. Integrated with Cloudflare CDN automatically — no
additional configuration needed.

---

## Why R2 over S3 / S3+CloudFront

| | Cloudflare R2 | AWS S3 | S3 + CloudFront |
|--|--|--|--|
| Storage/GB/mo | $0.015 | $0.023 | $0.023 |
| **Egress** | **$0 forever** | $0.09/GB | ~$0.0085/GB |
| Class A ops (PUT) | $4.50/M | $5.00/M | $5.00/M |
| Class B ops (GET) | $0.36/M | $0.40/M | $0.0075/10K |
| Free tier storage | 10 GB/mo | 5 GB (12mo only) | — |
| Free tier ops | 1M + 10M/mo | 20K/mo | — |
| CDN included | ✅ automatic | ❌ extra | ✅ extra config |
| Complexity | Low | Medium | High |
| S3-compatible API | ✅ | ✅ | ✅ |

**Migration path:** R2 uses the S3-compatible API — migrating from S3 to R2
later requires changing 3 environment variables, nothing else.

**Exception:** If AWS Activate / NVIDIA Inception credits are secured, use S3
while credits last, then migrate to R2. The API is identical.

---

## Free Tier Limits

| Resource | Free | Cost after |
|----------|------|-----------|
| Storage | 10 GB/mo | $0.015/GB/mo |
| Class A (PUT/POST/DELETE) | 1M ops/mo | $4.50/million |
| Class B (GET/HEAD) | 10M ops/mo | $0.36/million |
| Egress | **∞ always free** | $0 always |

**Rastrum cost projections:**

| Scale | Storage | Monthly cost |
|-------|---------|-------------|
| Beta (500 users, 60 obs/user) | ~60 GB | ~$0.75 |
| 1K MAU | ~120 GB | ~$1.65 |
| 10K MAU | ~300 GB | ~$4.35 |
| Eugenio's camera trap batch (4 cams × 7GB) | ~28 GB | ~$0.27 |

---

## Bucket Structure

```
rastrum-media/                        ← main bucket
├── observations/
│   └── {observation_id}/
│       ├── primary.jpg               ← resized 1200px (display)
│       ├── thumb.jpg                 ← 400px thumbnail
│       ├── original.jpg              ← original (private, credentialed only)
│       └── audio.m4a                 ← audio observations
│
├── camera-traps/
│   └── {deployment_id}/
│       ├── raw/                      ← original files from SD card
│       │   ├── IMG_0001.JPG
│       │   └── VID_0001.MP4
│       └── processed/
│           ├── IMG_0001_thumb.jpg    ← MegaDetector crop
│           └── IMG_0001_meta.json    ← detection results
│
└── avatars/
    └── {user_id}/
        └── avatar.jpg
```

---

## Client-Side Upload (Presigned URLs)

Never upload directly from browser to R2 with credentials.
Use presigned URLs generated server-side:

```typescript
// Supabase Edge Function: functions/get-upload-url/index.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${Deno.env.get('CF_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  },
});

export async function getUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300  // 5 minutes
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: Deno.env.get('R2_BUCKET_NAME')!,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn });
}
```

**Client upload flow:**
```typescript
// lib/upload.ts
async function uploadObservationPhoto(
  observationId: string,
  file: File,
  isPrimary = false
): Promise<string> {
  const key = `observations/${observationId}/${isPrimary ? 'primary' : crypto.randomUUID()}.jpg`;

  // 1. Get presigned URL from Edge Function
  const { url } = await supabase.functions.invoke('get-upload-url', {
    body: { key, contentType: file.type },
  });

  // 2. Resize client-side before upload (saves storage + bandwidth)
  const resized = await resizeImage(file, { maxWidth: 1200, quality: 0.85 });

  // 3. PUT directly to R2
  await fetch(url, {
    method: 'PUT',
    body: resized,
    headers: { 'Content-Type': file.type },
  });

  // 4. Return public CDN URL
  return `https://media.rastrum.org/${key}`;
}
```

---

## Client-Side Image Resizing

Before upload — saves storage and bandwidth:

```typescript
async function resizeImage(
  file: File,
  options: { maxWidth: number; quality: number }
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, options.maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.convertToBlob({ type: 'image/jpeg', quality: options.quality });
}

// Size targets:
// Display: maxWidth 1200px, quality 0.85 → ~200-400KB
// Thumbnail: maxWidth 400px, quality 0.80 → ~30-60KB
// Original: keep as-is → stored but private (credentialed only)
```

---

## Offline Upload Queue

Media files stored as Blobs in Dexie until connectivity:

```typescript
// Already defined in Module 03 (offline.md) — MediaBlob table
// Additional upload manager:

export async function uploadPendingMedia(): Promise<void> {
  const pending = await db.mediaBlobs
    .where('uploaded').equals(0)  // false
    .toArray();

  for (const item of pending) {
    try {
      const key = `observations/${item.observation_id}/${item.id}.jpg`;
      const uploadUrl = await getPresignedUrl(key, 'image/jpeg');

      await fetch(uploadUrl, {
        method: 'PUT',
        body: item.blob,
        headers: { 'Content-Type': 'image/jpeg' },
      });

      await db.mediaBlobs.update(item.id, {
        uploaded: true,
        upload_url: `https://media.rastrum.org/${key}`,
      });
    } catch (e) {
      console.error(`Failed to upload ${item.id}:`, e);
    }
  }
}
```

---

## Camera Trap Bulk Upload

For large batches (7GB+ per deployment):

```typescript
// Chunked upload with progress reporting
async function uploadCameraTrapBatch(
  deploymentId: string,
  files: FileList,
  onProgress: (pct: number) => void
): Promise<void> {
  const total = files.length;
  let completed = 0;

  // Process in batches of 10 parallel uploads
  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = Array.from(files).slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (file) => {
      const key = `camera-traps/${deploymentId}/raw/${file.name}`;
      const url = await getPresignedUrl(key, file.type);
      await fetch(url, { method: 'PUT', body: file });

      // Queue for MegaDetector processing
      await supabase.from('camera_trap_processing_queue').insert({
        deployment_id: deploymentId,
        filename: file.name,
        r2_key: key,
        status: 'queued',
      });

      completed++;
      onProgress(Math.round((completed / total) * 100));
    }));
  }
}
```

---

## Cloudflare R2 Custom Domain Setup

1. Create R2 bucket: `rastrum-media`
2. Add custom domain in Cloudflare dashboard: `media.rastrum.org`
3. Cloudflare CDN automatically serves from R2 — zero config
4. Enable Cloudflare Transform Rules for automatic WebP conversion:
   ```
   When: Request URI path matches *.jpg OR *.png
   Then: Serve as WebP (if browser supports)
   ```

**Result:** Images served as WebP at edge, ~30-40% smaller than JPEG.

---

## Environment Variables

```env
# .env.local
CF_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_BUCKET_NAME=rastrum-media
R2_PUBLIC_URL=https://media.rastrum.org
```

---

## Security

- **Never** expose R2 credentials to the browser
- All uploads via presigned URLs (5 min expiry)
- Bucket is **private** — public access only via Cloudflare CDN custom domain
- Original full-resolution photos: private key prefix, credentialed researcher access only
- Face blur applied client-side before upload (v1.0) — LGPDPPSO biometric data compliance
