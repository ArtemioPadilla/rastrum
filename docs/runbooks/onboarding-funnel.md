# Onboarding Funnel — Rastrum

Tracks user progression through the first 30 days to identify drop-off cliffs
and guide retention interventions. Implemented in #878.

---

## Funnel Milestones

| # | Event | Fires when | Code location |
|---|---|---|---|
| 1 | `onboarding:signed_up` | User completes auth callback for the first time | `src/pages/auth/callback.astro` — `redirectToHome()`, only if `users.created_at` is within 5 min of now |
| 2 | `onboarding:first_observation` | First observation successfully synced to server | `src/lib/sync.ts` — after upsert, when `observation_count` was 0 before this sync |
| 3 | `onboarding:first_id_accepted` | User's first identification is accepted (status='accepted') | `supabase/functions/onboarding-events/index.ts` — daily cron walks new accepted IDs |
| 4 | `onboarding:first_follow` | User follows another observer for the first time | `src/lib/social.ts` — `followUser()`, when this is the user's first follow |
| 5 | `onboarding:first_comment` | User posts their first comment | `src/components/Comments.astro` — on successful POST, if `comments_count` was 0 |
| 6 | `onboarding:7d_return` | Any pageview ≥ 7 days after signup | `supabase/functions/onboarding-events/index.ts` — daily cron |
| 7 | `onboarding:30d_return` | Any pageview ≥ 30 days after signup | `supabase/functions/onboarding-events/index.ts` — daily cron |

### Required event properties (all events)

```json
{
  "days_since_signup": 0,
  "cohort_week": "2026-W19",
  "$set": { "onboarded_at": "2026-05-09T..." }
}
```

- `days_since_signup` — integer, computed from `users.created_at`
- `cohort_week` — ISO week string (YYYY-Www) for downstream segmentation
- `$set.onboarded_at` — ISO timestamp, set once on `signed_up`, unchanged on subsequent events

---

## PostHog Funnel Definition

**Funnel name:** Onboarding — First 30 Days  
**Dashboard:** Onboarding  
**Window:** 30 days from first event (step 1)  
**Steps:**

1. `onboarding:signed_up`
2. `onboarding:first_observation`
3. `onboarding:first_id_accepted`
4. `onboarding:first_follow`
5. `onboarding:7d_return`
6. `onboarding:30d_return`

**Filters:** None (all users)  
**Breakdown:** `cohort_week` (to compare cohort performance over time)

To recreate:
1. PostHog → Insights → New Funnel
2. Add steps in order above
3. Set conversion window: 30 days
4. Add breakdown: `cohort_week`
5. Pin to "Onboarding" dashboard

---

## Existing instrumentation (pre-#878)

Audited via `grep -rn "posthog?.capture" src/`:

| Event | Location | Notes |
|---|---|---|
| `onboarding_completed` | OnboardingTour.astro | Fires on tour finish, not on signup |
| `onboarding_dismissed` | OnboardingTour.astro | Fires on tour dismiss |
| `observation_saved` | ObservationForm.astro | Fires on every obs save — not scoped to first |
| `pwa_install_prompted` | InstallPwaButton.astro | Install funnel only |
| `identification_suggested` | SuggestIdModal.astro | |
| `observations_exported` | ExportView.astro | |

Gap: none of the 7 onboarding milestone events existed before this PR.

---

## Gap-fill instrumentation (added in #878)

- `onboarding:signed_up` → `src/pages/auth/callback.astro`
- `onboarding:first_observation` → `src/lib/sync.ts`
- `onboarding:first_follow` → `src/lib/social.ts`
- `onboarding:first_id_accepted`, `onboarding:7d_return`, `onboarding:30d_return` → `supabase/functions/onboarding-events/` (daily cron, not yet created — v1.5 follow-up)

---

## Intervention follow-up issues

After running the funnel against the existing user base, open issues for the top 3 drop-offs:

- #TBD — guided first-observation walkthrough (cliff: signed_up → first_observation)
- #TBD — kairos push at day 3 if no first observation (cliff: signed_up → 7d_return)
- #TBD — faster first-ID: skip-queue for new users (cliff: first_observation → first_id_accepted)
