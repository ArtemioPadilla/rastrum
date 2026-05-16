# QA policy — CI time + flake budget

> Operational policy for the CI gate on Rastrum. Parent issue:
> [#1031](https://github.com/ArtemioPadilla/rastrum/issues/1031) Tier 1e.
> For the per-suite mechanics, see CLAUDE.md "Audit / E2E". For the
> 2026-05-15 manual production walkthrough — the bugs it found, the
> journey→fix→regression-spec traceability, and the documented chat /
> "Ask Rastrum" AI-round-trip coverage gap — see
> [`journey-audit-2026-05-15.md`](journey-audit-2026-05-15.md).

This doc is the single source of truth for:

- How fast PR CI must be.
- Which layers may retry, and how many times.
- How to quarantine a flake without blocking merges.
- Which checks are required vs informational on `main`.
- When an override is acceptable, and what to file after one.
- The bar a new check must clear before becoming required.

---

## 1. CI time budgets

| Percentile | Budget | Why |
|---|---|---|
| p50        | **5 min** end-to-end PR green | Solo developer; > 5 min between push and "safe to merge" measurably degrades batch size and review cadence. |
| p95        | **8 min** end-to-end PR green | A handful of slow runs (cold caches, vitest restart, validate gate spinning up Postgres) are tolerable. Beyond 8 min becomes a context-switch tax. |
| Outlier    | **15 min hard fail-fast**     | Any single job over 15 min is presumed hung — cancel and investigate. |

Measure periodically (monthly is fine for a solo repo):

```bash
gh run list --workflow=ci.yml --limit 100 \
  --json conclusion,startedAt,updatedAt \
  | jq -r '.[] | select(.conclusion=="success")
            | (((.updatedAt|fromdate) - (.startedAt|fromdate)) / 60)'
```

If the rolling p50 drifts above 5 min for > 1 week, treat it as a P1 and
either parallelise the slowest job, drop a slow check to informational, or
shard.

---

## 2. Retry policy

Different layers, different rules. The shorter the feedback loop and the
more deterministic the input, the lower the retry budget.

| Layer | Tool | Retries | Notes |
|---|---|---|---|
| Unit            | Vitest                | **0** | Any flake → fix or quarantine in the same PR. Never re-run-until-green. |
| Edge Function contract | Deno test       | **0** | Deterministic by construction (no network, fixed clock via `vi.useFakeTimers()` equivalent). A flake means a real bug. |
| E2E             | Playwright            | **2** allowed for cross-browser / cross-device | Permitted because the Playwright runner already retries the failing test alone, not the whole spec file, so the cost is bounded. Set per-project in `playwright.config.ts`. |
| E2E (single browser, smoke) | Playwright | **0** | The PR smoke run on chromium-only must be deterministic. Retries hide ordering bugs. |
| Lighthouse CI   | LHCI                  | LHCI's own median-of-3   | Built into the tool. Budgets are p95-tolerant. |

Retrying via "Re-run failed jobs" in the GitHub UI is **not** a substitute
for fixing a flake. If you re-run a required check more than once on the
same SHA, file an issue tagged `flake` before merging.

---

## 3. Flake quarantine convention

Quarantine — don't ignore. Move the test out of the required path so PRs
unblock, but keep it visible.

### Naming

| Layer | Suffix | Excluded by |
|---|---|---|
| Playwright | `*.flaky.spec.ts` | `testMatch` exclude in `playwright.config.ts` |
| Vitest     | `*.flaky.test.ts` | `exclude` in `vitest.config.ts` |
| Deno EF    | `*.flaky.test.ts` | runner glob in `verify` job |

Both runners already glob with `*.spec.ts` / `*.test.ts`; adding `.flaky.`
in the middle changes the file's group but keeps it discoverable. The CI
required-check job excludes the flaky bucket; an informational job runs it
on a schedule (not blocking).

### Lifetime

Quarantined tests must be **fixed or deleted within 7 days**. Two outcomes,
no third:

1. **Fix** the underlying determinism issue (clock, network, ordering,
   leaked state) and rename back to `.spec.ts` / `.test.ts`.
2. **Delete** the test if the cost of fixing exceeds the value. Note the
   deletion in the PR body; do not silently drop coverage.

### Visibility (follow-up, not yet implemented)

A nightly CI step should `find . -name '*.flaky.*' -mtime +7` and emit a
GitHub warning annotation listing any file older than 7 days. Tracked as a
v1.1 follow-up — not blocking this policy.

---

## 4. Required vs informational checks

Snapshot as of 2026-05-13 (`main` branch protection):

### Required (must be green to merge)

| Check | Workflow | Gates |
|---|---|---|
| `audit`   | `pr-audit.yml`           | Karma audit (module 23) — schema invariants, link rot, etc. |
| `test`    | `ci.yml` → `test` job    | Vitest unit suite. |
| `validate`| `db-validate.yml`        | Idempotent SQL apply twice against Postgres 17 + PostGIS 3.4. |
| `verify`  | `ci.yml` → `verify` job  | Typecheck, build, search-index drift, `define:vars` check, bundle-size baseline. Deno EF contract tests join once Tier 1a lands. |
| `CodeQL`                       | GitHub default | Security scan parent. |
| `Analyze (javascript-typescript)` | GitHub default | CodeQL sub-job. |
| `GitGuardian Security Checks`  | GitGuardian app | Secret scanning. |

### Informational (run on every PR, not required)

| Check | Why not required |
|---|---|
| `e2e` (Playwright)       | Currently flake-prone on PR runs; retries masked but not eliminated. Promote to required once 30 consecutive PR runs are green without retry. |
| `lhci`                   | p95 latency on a preview deploy is noisy; budgets are advisory. |
| `nightly-smoke`          | Runs against production, not the PR SHA. |
| `vision-providers-smoke` | Depends on third-party APIs; flake budget is the providers', not ours. |
| `db-advisor-smoke`       | Supabase advisor output is a moving target; useful signal, wrong shape for a gate. |

---

## 5. Override policy

`enforce_admins: false` is intentional on `main`. The repo owner can merge
through a red required check in a real emergency (production down, security
fix that needs to ship before the gate stabilises, etc.).

When this happens:

1. File a follow-up issue tagged `ci-override` within 24 hours.
2. The issue title is `ci-override: <PR #> — <one-line why>`.
3. Body includes: which check was red, why the override was safe, what
   follow-up is needed (rerun, fix-forward, revert).

Overriding for convenience — "the flake will probably pass on rerun" — is
not an emergency. Re-run the job instead, and if that fails, quarantine.

---

## 6. When to add a new required check

Every required check is a tax on every PR. New gates must clear all four:

- [ ] **Deterministic.** False-flake rate < 1% measured over ≥ 30 runs.
- [ ] **Fast.** < 5 min p95 wall time on a cold cache. If it can't fit in
      the time budget, it can't be required.
- [ ] **High signal.** Has caught at least one real bug in the
      informational period, or guards an invariant that has historically
      regressed.
- [ ] **Owned.** Someone is on the hook for keeping it green. For a solo
      repo, "the owner" is fine; for cron-driven checks (nightly-smoke,
      advisor), the runbook names the owner.

If a check is slow OR flaky, run it as informational with an alert on
failure (issue auto-open, email, Slack — pick one). Do not gate PRs on it.

The Deno EF contract suite is on track to clear all four once Tier 1a
finishes wiring it into the `verify` job.

---

## 7. References

- [#1031](https://github.com/ArtemioPadilla/rastrum/issues/1031) — parent
  issue (Tier 1 testing-infra cleanup).
- CLAUDE.md "Audit / E2E" — current state of Playwright + Lighthouse CI.
- `docs/runbooks/ci-smoke-checks.md` — what to do when a smoke job goes red.
- `.github/workflows/ci.yml`, `db-validate.yml`, `pr-audit.yml` — the
  workflows behind the required checks.
- [`journey-catalog.md`](journey-catalog.md) — CI-enforced, provably-
  complete route + journey catalog (the list sweeps run against;
  `tests/unit/journey-catalog-complete.test.ts` keeps it from rotting).

---

## 8. Chat / "Ask Rastrum" AI answer path — coverage decision

Tracked from the 2026-05-15 journey audit
([`journey-audit-2026-05-15.md`](journey-audit-2026-05-15.md) §4) and
issue #1106.

**Correction to the original framing.** #1106 was filed assuming the
chat answer path needs a BYO key / sponsorship / platform-pool slot and
therefore "costs model spend / is untestable without spend." That is
**wrong**. Production verification (2026-05-16) confirmed Rastrum
**Chat / "Ask Rastrum" runs entirely on-device** (WebLLM — Gemma 4 E2B
~500 MB, or Llama 3.2 1B ~880 MB; *"tus mensajes nunca salen del
navegador"*). There is **no operator cost and no API key** for the chat
path. The paid path is the *separate* "Ask my AI" identify cascade
(server EF + BYO/pool/sponsorship, M32), which the photo-ID journey
already exercises.

**What is verified in production (no cost):**
- The `AskRastrumButton` deep-link `/{lang}/chat/?attach=<kind>:<id>`
  resolves to the chat page (no 404 / no crash) — the
  `journey-chat-find-species-and-observe.spec.ts` contract holds live.
- The model gate is honest UX: explicit on-device model picker, privacy
  note, and a "Profile → AI settings" link. No silent failure when no
  model is downloaded yet.

**Why the e2e spec mocks the model.** `mockChatModelCached` exists
because the real WebLLM model is **~500 MB + WebGPU** — impractical to
download/run in CI — **not** because of cost. This is the same class of
constraint as `phi-vision.ts` (mocked at the module boundary; see
CLAUDE.md "Known pitfalls").

**Decision (defer-with-rationale).** We do **not** add a real-model chat
e2e variant. Justification: the only uncovered behaviour is on-device
WebLLM inference producing a grounded answer with the attached entity —
a one-time **manual on-device smoke**, not a regression-prone surface
and not CI-feasible (model size + WebGPU). The mocked journey spec
guards the shell + deep-link + attach contract on every PR; the
remaining gap is a release-time manual check, owned by the operator,
documented here. If a future change makes on-device chat brittle, revisit
by adding a `@manual`-tagged Playwright spec a human runs locally with a
pre-downloaded model — never a required CI gate.
