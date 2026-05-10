# Leaked Password Protection (HIBP)

> Supabase Auth: how to enable Have I Been Pwned (HIBP) breach-detection
> so users cannot register or log in with passwords known to be compromised.

## What this does

When Leaked Password Protection is enabled, Supabase Auth checks every
password at sign-up and password-change time against the
[Have I Been Pwned](https://haveibeenpwned.com/Passwords) API using a
k-anonymity prefix query (the first 5 hex chars of the SHA-1 hash are
sent; the full hash never leaves the client). If the password appears in
the breach corpus, the request is rejected with a
`AuthApiError: Password should not be easily guessable` error
(HTTP 422).

## How to enable

### Via the Supabase Dashboard (recommended)

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and
   select the **rastrum** project.
2. Navigate to **Authentication → Settings**.
3. Scroll to the **Security** section.
4. Toggle **"Enable Leaked Password Protection"** to **on**.
5. Click **Save**.

The setting takes effect immediately — no deployment required.

### Via the Management API (CI/IaC)

```bash
curl -X PATCH \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth" \
  -d '{"hibp_enabled": true}'
```

Verify:

```bash
curl -s \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth" \
  | python3 -c "import json,sys; cfg=json.load(sys.stdin); print('hibp_enabled:', cfg.get('hibp_enabled'))"
```

Expected output: `hibp_enabled: True`.

## Verifying it works

Use the Supabase JS client (or curl) to attempt a sign-up with a
well-known compromised password such as `password123`:

```bash
curl -s -X POST \
  "${SUPABASE_URL}/auth/v1/signup" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test+hibp@example.com","password":"password123"}' \
  | python3 -m json.tool
```

Expected response (HTTP 422):

```json
{
  "code": 422,
  "error_code": "weak_password",
  "msg": "Password should not be easily guessable"
}
```

A strong, unique password (e.g. `xK9$mR2@pLq7!vN4`) should succeed
(HTTP 200).

## Application-side error handling

The Rastrum frontend catches this error in the auth utilities. Any
component using `supabase.auth.signUp()` or `supabase.auth.updateUser()`
should surface a user-friendly message such as:

> "This password has appeared in a data breach. Please choose a
> different password."

See `tests/unit/leaked-password-protection.test.ts` for the validated
error-handling behaviour.

## Privacy note

Only the first 5 hex characters of the SHA-1 hash of the password are
transmitted to the HIBP API — the actual password or full hash never
leaves Supabase's infrastructure. This is the standard k-anonymity
protocol specified by HIBP.

## Rollback

Toggle **"Enable Leaked Password Protection"** back to **off** in
Dashboard → Authentication → Settings → Security, or:

```bash
curl -X PATCH \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth" \
  -d '{"hibp_enabled": false}'
```

## See also

- Supabase docs: [Password security](https://supabase.com/docs/guides/auth/password-security)
- [Have I Been Pwned API](https://haveibeenpwned.com/API/v3#PwnedPasswords) — k-anonymity model
- `tests/unit/leaked-password-protection.test.ts` — unit test for the
  error-handling path
- `docs/runbooks/rotate-secret.md` — related credential hygiene runbook
