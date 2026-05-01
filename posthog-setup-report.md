<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Rastrum. Here is a summary of all changes made:

- **`src/components/posthog.astro`** (new) — PostHog snippet component using `is:inline` + `define:vars` to safely inject `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` at build time without TypeScript processing.
- **`src/layouts/BaseLayout.astro`** — Imported and mounted `<PostHog />` in the `<head>` so all pages (EN + ES) load analytics automatically.
- **`src/env.d.ts`** — Added `Window.posthog` type declaration (with `capture`, `identify`, `reset`, `captureException`) and the two new `PUBLIC_POSTHOG_*` env var types.
- **`.env.local`** — Populated `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` via the wizard-tools MCP (values never written to source code).
- **`src/components/SignInForm.astro`** — `sign_in_initiated` (method), `sign_in_completed` (method + `posthog.identify` with Supabase user ID), `sign_in_failed` (method + error message) across all four auth paths: Google OAuth, GitHub OAuth, passkey, email OTP.
- **`src/components/SuggestIdModal.astro`** — `identification_suggested` (obs ID, scientific name, confidence, promoted flag) and `identification_promoted_to_research_grade` (obs ID, scientific name) on successful form submit.
- **`src/components/ReactionStrip.astro`** — `observation_reaction_toggled` (target, target_id, kind, action added/removed) after a successful API call.
- **`src/components/FollowButton.astro`** — `user_followed` (target_user_id, status accepted/pending) and `user_unfollowed` (target_user_id) on button click.
- **`src/components/Comments.astro`** — `comment_posted` (observation_id) after a top-level comment is successfully inserted.
- **`src/components/ExportView.astro`** — `observations_exported` (format, row_count, type=csv) for CSV downloads and (format=dwca, quality, license, type=gbif_zip) for DwC-A ZIP downloads.
- **`src/components/OnboardingTour.astro`** — `onboarding_completed` (steps_total) and `onboarding_dismissed` (step_reached, steps_total) in the `hide()` function.
- **`src/components/ProfileEditForm.astro`** — `profile_updated` after the Supabase `.update()` call succeeds.

| Event | Description | File |
|---|---|---|
| `sign_in_initiated` | User clicks Google, GitHub, passkey, or submits email OTP request | `src/components/SignInForm.astro` |
| `sign_in_completed` | User successfully signs in; `posthog.identify` called with Supabase user ID | `src/components/SignInForm.astro` |
| `sign_in_failed` | OTP verify, passkey, or OAuth returns an error | `src/components/SignInForm.astro` |
| `observation_submitted` | User successfully saves/syncs a new observation | `src/components/ObservationForm.astro` |
| `identification_suggested` | Expert submits an ID suggestion via SuggestIdModal | `src/components/SuggestIdModal.astro` |
| `identification_promoted_to_research_grade` | A suggested ID tips the observation into research grade | `src/components/SuggestIdModal.astro` |
| `observation_reaction_toggled` | User faves, agrees/disagrees, or marks a photo/ID as helpful | `src/components/ReactionStrip.astro` |
| `user_followed` | User follows another observer | `src/components/FollowButton.astro` |
| `user_unfollowed` | User unfollows or cancels a pending follow | `src/components/FollowButton.astro` |
| `comment_posted` | User posts a top-level comment on an observation | `src/components/Comments.astro` |
| `observations_exported` | User downloads a CSV or DwC-A ZIP export | `src/components/ExportView.astro` |
| `onboarding_completed` | User finishes all steps of the onboarding tour | `src/components/OnboardingTour.astro` |
| `onboarding_dismissed` | User skips or closes the onboarding tour early | `src/components/OnboardingTour.astro` |
| `profile_updated` | User saves changes to their profile | `src/components/ProfileEditForm.astro` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/405068/dashboard/1531652
- **Sign-in funnel** (sign_in_initiated → sign_in_completed): https://us.posthog.com/project/405068/insights/FNa0HoJw
- **Observation submissions over time** (daily trend): https://us.posthog.com/project/405068/insights/QiNf9BrC
- **Community engagement** (reactions, comments, follows trend): https://us.posthog.com/project/405068/insights/VaRuln53
- **Onboarding completion vs dismissal** (bar chart): https://us.posthog.com/project/405068/insights/ly7uCU5q
- **Identification quality funnel** (identification_suggested → promoted to research grade): https://us.posthog.com/project/405068/insights/uOLyyQ4n

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
