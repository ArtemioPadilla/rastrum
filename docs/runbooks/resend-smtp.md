# Resend SMTP runbook

> Switch from Supabase's built-in SMTP (3 emails/hour cap on the free
> tier) to Resend (3 000 emails/month free, 100/day soft cap). Required
> before any sustained user growth — magic-link sign-ins start failing
> silently after the third in an hour, with no UI signal.

## When to do this

- The first time a friend reports "I never got the magic link" within
  an hour of two prior sign-ins by other users on the same project.
- Always before a public soft-launch.

## Prerequisites

- A domain you control (`rastrum.org` is set up via Cloudflare).
- Cloudflare DNS access to add 3 records (SPF, DKIM, return-path).
- Supabase project access to swap the SMTP credentials.

## 1. Create a Resend account

1. https://resend.com/signup → free tier ("Sandbox" works for dev).
2. Verify your sender email.
3. Create a sending domain: Settings → Domains → Add Domain → `rastrum.org`.

## 2. Add the DNS records

Resend will surface 3 TXT/MX records. In Cloudflare DNS for `rastrum.org`:

| Type | Name | Value | TTL |
|---|---|---|---|
| MX  | `send.rastrum.org` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | Auto |
| TXT | `send.rastrum.org` | `v=spf1 include:amazonses.com ~all` | Auto |
| TXT | `resend._domainkey.rastrum.org` | `<long key from Resend dashboard>` | Auto |

Wait 5–15 minutes, hit "Verify" in Resend. Should flip to green.

## 3. Generate an API key

Resend → API Keys → Create → "Sending access" only → name it
`rastrum-supabase-smtp`. Copy the key (starts with `re_`).

## 4. Wire it into Supabase

Dashboard → your project → Authentication → Settings → SMTP Settings:

- Enable Custom SMTP
- Sender email: `noreply@rastrum.org`
- Sender name: `Rastrum`
- Host: `smtp.resend.com`
- Port: `465` (SMTPS — use `587` only if 465 is blocked)
- Username: `resend`
- Password: the `re_…` key from step 3
- Min interval: `0` (Resend handles rate limiting upstream)

Save. Test by sending a magic link to a fresh address.

## 5. Verify

- Send a magic-link to a personal email. Should arrive within seconds
  with `From: Rastrum <noreply@rastrum.org>`.
- Send 5 magic-links in 30 seconds. Previously this hit the 3/hour cap
  and the 4th+ silently failed; now they should all arrive.
- Resend dashboard → Emails → check delivery status.

## Cost

Free tier: 3 000 emails/mo. We expect well under 100 magic-links/day
during the v1.0 family + friends launch (~3 000/mo cap covers ≈100/day
which is generous for any realistic v1 flow). Upgrade to Pro ($20/mo)
only if the volume warrants it.

## Rollback

To revert: Supabase → Auth → SMTP Settings → toggle Custom SMTP off.
Built-in SMTP resumes immediately. The Resend domain stays valid for
later — no need to delete it.
