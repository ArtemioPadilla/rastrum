# Edge Function serving-layer recovery

> Incident class first hit **2026-05-16**: the create-observation flow's
> *Identify* step failed with `Failed to send a request to the Edge
> Function`. Root cause was **not** in the app — it was a Supabase
> platform-side serving-layer drop, masked by a deploy workflow that
> reported success without serving anything.

## Symptom

- A browser call to an Edge Function fails with `FunctionsFetchError:
  Failed to send a request to the Edge Function` (the browser reports it
  as "Failed to fetch" / a CORS error because the **OPTIONS preflight
  itself returns 404**, and a CORS preflight must be 2xx).
- `curl` to the function (with the `apikey` header) returns:
  `HTTP 404` + body `{"code":"NOT_FOUND","message":"Requested function
  was not found"}` + header `sb-error-code: NOT_FOUND`, served by
  `x-served-by: supabase-edge-runtime`.
- The Supabase **control plane disagrees with the data plane**: the
  Management API (`GET /v1/projects/{ref}/functions`) lists the function
  as `status=ACTIVE`, the project is `ACTIVE_HEALTHY`, and DB / REST /
  Auth / Storage / Realtime are all healthy. Only the Functions runtime
  is 404ing.

## Root cause

A Supabase platform event dropped a subset of functions from the Edge
**serving layer** while leaving them registered `ACTIVE` in the control
plane. The reason this is sticky:

> `supabase functions deploy` **content-hash dedups**. When a function's
> bundle is unchanged it prints `No change found in Function: <fn>` and
> **skips the upload**, then *still* prints `Deployed Functions on
> project <ref>: <fn>` and exits 0. The deploy workflow goes green.

So the natural remediation (redeploy / restart the project) is a **silent
no-op** for any function whose source has not changed — the bundle is
never re-uploaded, so the serving layer never re-registers it. The only
functions that recover on their own are the ones that happened to get a
real code change (their bundle hash changed → genuine re-upload).

Project pause/resume and restart do **not** re-push bundles either.

## Recovery

Force a real re-upload by busting each affected function's bundle hash:

1. Enumerate which functions the runtime is not serving (no secret
   needed — OPTIONS preflight is auth-exempt):

   ```bash
   for d in supabase/functions/*/; do
     fn=$(basename "$d"); [ "${fn#_}" != "$fn" ] && continue
     code=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
       "https://<PROJECT_REF>.supabase.co/functions/v1/$fn" \
       -H "Origin: https://rastrum.org" \
       -H "Access-Control-Request-Method: POST" \
       -H "Access-Control-Request-Headers: authorization,apikey,content-type")
     [ "$code" = "404" ] && echo "DOWN  $fn" || echo "ok    $fn ($code)"
   done
   ```

2. Append a behavior-neutral bundle-hash buster to each affected
   function's `index.ts` (a top-level side-effecting global assignment —
   survives any bundler, changes the eszip, never affects behavior):

   ```ts
   ;(globalThis as Record<string, unknown>).__rastrumRedeploy = "<date>-serving-layer-recovery";
   ```

3. Commit + push to `main`. `deploy-functions.yml` fires on
   `supabase/functions/**`; because the workflow file or `_shared` may be
   touched it deploys all, and the changed bundles are genuinely
   re-uploaded.

4. The **`Verify runtime serves every deployed function`** step in
   `deploy-functions.yml` (added in the same incident) re-checks every
   deployed function's OPTIONS endpoint and **fails the workflow loudly**
   if any is still 404 — so a silent no-op can never ship green again.

5. Once the runtime serves everything, the markers are cruft. They are
   safe to remove in a follow-up PR (removal is itself a real bundle
   change, so it re-deploys cleanly).

## Escalation

Per Supabase's own troubleshooting doc
(`troubleshooting/edge-function-404-error-response`), a function that is
ACTIVE but 404 at the runtime after a redeploy is a **suspected internal
platform bug** — open a Supabase support ticket with: project ref, the
`sb-request-id` from a failing `curl -i`, the Management API output
showing `status=ACTIVE`, and the timestamp the serving layer dropped.

## Prevention

- **Post-deploy runtime gate** (`deploy-functions.yml`) — described
  above; this is the durable guard. "Workflow green" now means "the
  runtime actually serves it", not "the CLI exited 0".
- The same anti-pattern bit `db-apply.yml` historically (PR #42 silent
  skip) → fixed with the `db-validate` gate. Functions now have the
  symmetric guard.
- A continuous external heartbeat (Cloudflare Worker cron / uptime
  monitor) on `OPTIONS /functions/v1/identify` is the only thing that
  catches a serving-layer drop that happens *after* a successful deploy
  (this incident broke ~1.5 h post-deploy). Tracked as a follow-up.
