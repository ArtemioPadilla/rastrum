# PostHog analytics

Operator reference for the PostHog integration mounted in `BaseLayout.astro`.

## Where it lives

| What | Where |
|---|---|
| SDK loader | `src/components/posthog.astro` (mounted in `BaseLayout.astro` `<head>`) |
| Env-var types | `src/env.d.ts` (`PUBLIC_POSTHOG_PROJECT_TOKEN`, `PUBLIC_POSTHOG_HOST`, `Window.posthog`) |
| Build-env wiring | `.github/workflows/deploy.yml` (the only workflow that should pass these secrets — CI/E2E/LHCI must NOT, or test runs pollute prod analytics) |
| Reverse proxy | `https://usage.rastrum.org` — forwards `/static/array.js` and `/e/` to PostHog cloud |
| `.env.example` | Lists both vars; copy to `.env.local` and fill in the project token |

## Init options (rastrum.org defaults)

```ts
posthog.init(apiKey, {
  api_host: 'https://usage.rastrum.org',  // managed reverse proxy
  ui_host: 'https://us.posthog.com',      // so deep-links resolve to PostHog cloud
  defaults: '2026-01-30',
  person_profiles: 'identified_only',     // no anonymous-user profiles by default
  capture_exceptions: true,               // hooks window.onerror + unhandledrejection
});
```

The snippet has a runtime `if (apiKey && apiHost)` guard, so missing env vars
silently disable PostHog rather than 404 a static script. Capture call-sites
all use optional chaining (`window.posthog?.capture(...)`), so they no-op when
the SDK never loaded.

**Exception autocapture** (`capture_exceptions: true`) hooks `window.onerror`,
`unhandledrejection`, and `console.error` — uncaught browser errors land in
PostHog → Errors automatically. For caught errors that you want logged anyway
(e.g. a fetch that failed but the UI recovered), call
`window.posthog?.captureException(err, { context: '…' })` manually.

## Captured events

| Event | Where it fires | Payload |
|---|---|---|
| `sign_in_initiated` | `SignInForm.astro` — Google, GitHub, passkey, email OTP request | `{ method }` |
| `sign_in_completed` | `SignInForm.astro` — `posthog.identify(userId)` also called | `{ method }` |
| `sign_in_failed` | `SignInForm.astro` — OTP verify, passkey, OAuth error | `{ method, error }` |
| `observation_saved` | `ObservationForm.astro` — successful save | `{ observation_id }` |
| `identification_suggested` | `SuggestIdModal.astro` — submit | `{ obs_id, scientific_name, confidence, promoted }` |
| `identification_promoted_to_research_grade` | `SuggestIdModal.astro` — when an ID tips the obs | `{ obs_id, scientific_name }` |
| `observation_reaction_toggled` | `ReactionStrip.astro` | `{ target, target_id, kind, action }` |
| `user_followed` / `user_unfollowed` | `FollowButton.astro` | `{ target_user_id, status? }` |
| `comment_posted` | `Comments.astro` | `{ observation_id }` |
| `observations_exported` | `ExportView.astro` — CSV + DwC-A | `{ format, row_count?, type, quality?, license? }` |
| `onboarding_completed` / `onboarding_dismissed` | `OnboardingTour.astro` | `{ steps_total, step_reached? }` |
| `profile_updated` | `ProfileEditForm.astro` | — |
| `pwa_install_prompted` / `pwa_installed` | `InstallPwaButton.astro` | `{ outcome }` |
| `project_created` | `ProjectNewView.astro` | `{ slug, visibility }` |
| `sponsorship_credential_added` | `SponsoringView.astro` | `{ kind }` |
| `content_reported` | `ReportDialog.astro` | `{ target, reason }` |

## Adding a new event

1. Add the call where the user-meaningful action succeeds (after the
   network call resolves, not on click). Use `window.posthog?.capture(...)`
   so missing-SDK silently no-ops.
2. Keep payload keys snake_case; values must be JSON-serialisable.
3. Append a row to the events table above so this runbook stays the
   single source of truth.

## Verifying a deploy

```bash
# Snippet baked into prod HTML with real values?
curl -sS https://rastrum.org/en/ | grep -o 'apiHost = "[^"]*"\|apiKey = "[^"]*"'

# Reverse proxy serving the SDK + ingest endpoint?
curl -sS -o /dev/null -w 'array.js HTTP %{http_code}\n' https://usage.rastrum.org/static/array.js
curl -sS -o /dev/null -w '/e/ HTTP %{http_code}\n' -X OPTIONS https://usage.rastrum.org/e/
```

End-to-end: open the PostHog activity feed, then sign in to rastrum.org —
a `sign_in_initiated` event should land within ~5 s.

## Rotating the project token

1. Set the new token in PostHog → Project settings → API keys.
2. `gh secret set PUBLIC_POSTHOG_PROJECT_TOKEN` (paste new value).
3. Update `.env.local` for local dev.
4. Trigger a deploy: any push to `main`, or `gh workflow run deploy.yml`.
5. Verify with the curl snippet above.

## Pre-built dashboards (operator bookmarks)

- Analytics basics: https://us.posthog.com/project/405068/dashboard/1531652
- Sign-in funnel (sign_in_initiated → sign_in_completed): https://us.posthog.com/project/405068/insights/FNa0HoJw
- Observation submissions over time: https://us.posthog.com/project/405068/insights/QiNf9BrC
- Community engagement (reactions, comments, follows): https://us.posthog.com/project/405068/insights/VaRuln53
- Onboarding completion vs dismissal: https://us.posthog.com/project/405068/insights/ly7uCU5q
- Identification quality funnel: https://us.posthog.com/project/405068/insights/uOLyyQ4n

## Why PostHog was silent in prod from wizard-setup until PR #764

The wizard ran in early May 2026 and wrote the snippet + `.env.local`,
but never wired the two `PUBLIC_POSTHOG_*` vars into
`.github/workflows/deploy.yml`'s build env, and the secrets were never
set on the repo either. So every prod build emitted `apiKey = undefined;
apiHost = undefined;` — the runtime guard short-circuited and PostHog
never loaded. Capture call-sites no-op'd against `window.posthog ===
undefined`. PR #764 added the build-env wiring, the secrets were set,
and the snippet was upgraded to the reverse-proxy-ready format with
`ui_host` + `person_profiles: 'identified_only'`.

## Future scope

- **Server-side ingest from Edge Functions** — see [#780](https://github.com/ArtemioPadilla/rastrum/issues/780).
- **DNT-respect + consent banner (LFPDPPP / LGPD)** — see [#781](https://github.com/ArtemioPadilla/rastrum/issues/781).
