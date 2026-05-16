# Audit-fixes implementation — design

**Date:** 2026-05-15
**Scope:** Implement the 14 production-audit findings filed as issues #1070–#1083, using git worktrees and subagents.
**Source:** End-to-end production audit of rastrum.org (2026-05-15, signed-in admin session).

---

## Goal

Land fixes (or honest diagnoses) for the 14 audit issues without violating this
repo's documented CI-coupling lesson, the schema/RLS "ask first" gate, or the
isolation of the two active in-flight worktrees.

## Constraints (load-bearing)

- **CI coupling**: every PR runs `db-validate` + `ci` + `e2e` + `lhci`. Per
  CLAUDE.md (2026-05-11) and the `feedback_bundle_ci_coupled_fixes` memory,
  CI-coupled fixes go into one PR with atomic commits — **not** one PR per
  issue (circular-deadlock anti-pattern).
- **Schema/RLS gate**: CLAUDE.md "ask first" for anything touching RLS / GRANT
  / non-additive schema. #1071 is gated.
- **Active worktrees**: `.worktrees/fix-1025-places` (`fix/1025-places-design`,
  schema-only) and `.worktrees/fix-1026-lint-test` — do not touch.
- **Worktree hygiene**: never `git add -A`/`git add .` in a worktree
  (symlinked `node_modules` trap); stage explicit files. Never `--no-verify`.
- **Repo conventions**: TDD where applicable, EN/ES parity for UI strings,
  idempotent schema, read code before changing, follow existing patterns,
  verification-before-completion (real command output, no unevidenced success
  claims).

## Issue triage

| Bucket | Issues |
|---|---|
| Frontend (no schema) | #1070, #1073, #1074, #1075, #1077, #1080, #1081 |
| Trivial copy/i18n/docs | #1078, #1079, #1083 |
| Schema/RLS — ask-first | #1071 |
| Edge Function | #1082 |
| Investigation-first spikes | #1072, #1076 |

## Topology — 5 thematic groups (base `main`, ff-only first)

### G1 — `fix/audit-frontend` (worktree `.worktrees/audit-frontend`)
Issues: #1070, #1073, #1074, #1075, #1077, #1080, #1081.
One subagent per issue. Parallel where file-disjoint; serialized where the
Explore area overlaps (#1070 `ExplorePlacesView.astro` vs #1077 Explore index).
One atomic commit per issue → **one PR**.

### G2 — `fix/audit-copy`
Issues: #1078, #1079, #1083. One subagent, three atomic commits → one small
PR. EN/ES parity enforced for #1078/#1079; #1083 is a CLAUDE.md doc edit.

### G3 — #1071 schema/RLS (no branch yet)
One **read-only diagnostic subagent**: trace the `admin` Edge Function
`role.grant` path + GRANTs on `public.users` + commit `d122b29`, produce the
minimal idempotent schema diff. **Hard stop** — user approves the specific
schema diff before any branch/apply/PR. Branch `fix/1071-role-grant` only
after approval.

### G4 — `fix/1082-report-resolve` (Edge Function)
Issue: #1082. One subagent fixes the `report.resolve` handler so a missing
target is a handled outcome, plus a test. **Does not deploy** (Edge Function
deploys are deliberate / `workflow_dispatch`). One small PR.

### G5 — spikes #1072, #1076
One diagnostic subagent each. #1072 (home 503 on HEAD count) and #1076 (gotrue
lock + `user_roles` fan-out, previously attempted in #1064/#1065). If a clean
code fix exists → implement on its own branch (fold into G1 if purely
frontend). If infra/Supabase or too subtle → post honest root-cause analysis
to the issue; no forced patch, no false "fixed" claim.

## Execution order

1. `git pull --ff-only` on `main`.
2. **Phase A (parallel, read-only):** diagnostic spikes #1071, #1072, #1076.
3. **Phase B (parallel with A):** G1 per-issue subagents, G2, G4.
4. **Checkpoint #1071:** present diagnosis + minimal idempotent schema diff →
   wait for user approval → implement.
5. **Checkpoint spikes:** report #1072/#1076 root cause → fix vs. analysis.
6. Integration per group: `npm run typecheck && npm run test && npm run build`
   green → open PR (3–5 thematic PRs, not 14). User merges.

## Stop-and-wait checkpoints

- **#1071** — before any GRANT/RLS schema change is applied or PR'd.
- **Spikes #1072/#1076** — root cause reported before fix-vs-analysis decision.
- PR review before merge — user performs merges.

## Per-subagent contract

- Read the relevant code before editing; follow existing patterns.
- TDD where it fits; tests sparingly per `docs/qa-policy.md`.
- Run `npm run typecheck && npm run test && npm run build`; paste real output.
- Stage explicit files only. Commit message:
  `fix(scope): summary (#NNNN)` ending with
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Do not deploy Edge Functions. Do not touch protected worktrees. Do not
  `--no-verify`.
- If blocked or root cause is infra, report honestly — do not fake a fix.

## Out of scope

- Merging PRs (user does this).
- Deploying Edge Functions or applying schema to prod.
- Re-architecting beyond the minimal fix for each issue.
