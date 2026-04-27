# Onboarding events runbook

The onboarding tour (`src/components/OnboardingTour.astro`) emits two
public DOM events. Both are stable and may be relied on by operator code
(analytics, second "replay tour" buttons elsewhere in the app, etc.).

## `rastrum:replay-onboarding`

**Direction:** consumer → tour. Dispatched by any UI that wants to
re-open the modal — even after it has been completed and the
`localStorage.rastrum.onboardingV2` flag is `'true'`.

```ts
window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
```

The handler:

1. Clears `localStorage.rastrum.onboardingV2` and
   `sessionStorage.rastrum.onboardingV2.step`.
2. Calls the internal `show()` which captures the previously-focused
   element, locks `<html>` + `<body>` overflow, builds the identifier
   cards from current cache state, renders step 0, and moves focus
   into the dialog.
3. Onclose, focus is restored to the element that was active before the
   replay event fired — usually the trigger button.

The repo wires this from `ProfileEditForm.astro`'s "Replay tour"
button. Add it anywhere a user might want to revisit the flow:

```astro
<button id="my-replay-btn" type="button">Replay tour</button>
<script>
  document.getElementById('my-replay-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
  });
</script>
```

## `rastrum:onboarding-event`

**Direction:** tour → consumer. Fired at every meaningful state change
inside the modal. Operators wiring an analytics provider (Plausible,
PostHog, GA, internal beacon) attach a listener at boot.

`detail` shape:

```ts
{
  type: 'opened' | 'resumed' | 'step_change' | 'skip_to_summary'
      | 'key_saved' | 'key_verify_failed' | 'download_started'
      | 'dismissed_before_done' | 'completed';
  step: number;       // current step at fire time (0..3)
  // Per-type extras:
  from?: number;      // step_change: previous step
  to?: number;        // step_change: new step
  reason?: 'auth' | 'network' | 'shape' | 'other'; // key_verify_failed
  id?: string;        // download_started: model id
}
```

Sample listener (no analytics provider, just `console.log`):

```ts
window.addEventListener('rastrum:onboarding-event', (e) => {
  const detail = (e as CustomEvent).detail;
  console.log('[onboarding]', detail.type, detail);
});
```

Practical use:

| Question | Watch for |
|---|---|
| What % of new users finish the flow? | `completed` ÷ `opened` |
| Where do they drop off? | `dismissed_before_done` grouped by `step` |
| Are people stuck on the API key step? | `key_verify_failed` reasons |
| Is the heavy-download warning scaring users away? | `download_started` ÷ users on step 1 |
| Is replay actually used, or is it dead UI? | `resumed` count |

The component itself does not call any analytics provider. Wire whatever
backend you want in a single place — recommended is a small inline
script in `BaseLayout.astro` so the listener is attached before the tour
opens (the modal opens ~600 ms after auth resolution, which is plenty
of time).

## Companion helper: `validateAnthropicKey`

`src/lib/anthropic-key.ts` exports a live key probe used by the
onboarding's "Save" button on the Claude Haiku card. The signature:

```ts
import { validateAnthropicKey } from '../lib/anthropic-key';

const r = await validateAnthropicKey('sk-ant-…');
// r.valid === true                             → key works
// r.valid === false && r.reason === 'shape'    → didn't match ^sk-ant-[\w-]{20,}$
// r.valid === false && r.reason === 'auth'     → 401 / 403 from Anthropic
// r.valid === false && r.reason === 'network'  → fetch threw / offline
// r.valid === false && r.reason === 'other'    → non-200, non-auth (rate-limited, etc.)
```

It posts a `max_tokens: 1` request to `/v1/messages` with
`anthropic-dangerous-direct-browser-access: true`, which costs essentially
nothing per call. Re-use it for any second BYO-key UI you build (e.g.
the per-plugin BYO API keys settings panel in Profile → Edit).

## See also

- `src/components/OnboardingTour.astro` — implementation
- `src/lib/anthropic-key.ts` + `.test.ts` — live verify helper + tests
- `tests/e2e/onboarding.spec.ts` — Playwright spec for the public surface
- [`docs/runbooks/ci-smoke-checks.md`](ci-smoke-checks.md) — sibling runbook for the CI smoke wiring
