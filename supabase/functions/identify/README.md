# identify Edge Function

PlantNet → Claude Haiku 4.5 cascade for species identification.
Implements docs/specs/modules/01-photo-id.md.

## Deploy

```bash
# One-time: link the local repo to the Supabase project
supabase link --project-ref reppvlqejgoqvitturxp

# Set secrets (not committed anywhere)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set PLANTNET_API_KEY=2b10...

# Deploy
supabase functions deploy identify
```

## Invoke

From the client, after an observation syncs and a media URL exists:

```ts
const { data, error } = await supabase.functions.invoke('identify', {
  body: {
    observation_id: obsId,
    image_url: 'https://<project>.supabase.co/storage/v1/object/public/media/observations/<id>/<blobId>',
    user_hint: 'plant',  // optional
    location: { lat, lng },
  },
});
```

The function writes the result to `public.identifications` as the primary ID
(triggering `sync_primary_identification` to materialise denormalised fields on
the observation row).

## Cost model

See module 01 § Cost Model. Haiku 4.5 vision ~$0.00282/image at list price;
PlantNet free tier 500 req/day/key.
