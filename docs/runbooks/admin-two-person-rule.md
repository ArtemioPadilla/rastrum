# Two-person rule for irreversible admin actions

PR13 introduces an opt-in approval flow for the four highest-risk
console actions. v1 ships the workflow; v2 may flip the policy from
opt-in to required for the irreversible set.

## Scope

The four actions in `_shared/irreversible.ts`:

| Action | Why it's "irreversible" |
|---|---|
| `role.revoke` | A revoke is reversible by re-granting, but the audit cost of mistaken revokes (lost mod coverage during a flag flood) is high. |
| `user.ban` | The user's session is destroyed and they receive a notification; even a quick unban leaves a permanent paper trail. |
| `observation.hide` | The observation disappears from public surfaces immediately; until unhidden, downstream syncs (GBIF, watchlist alerts) treat it as missing. |
| `badge.revoke` | Badges are a public reputation signal; revocation is visible. |

## Lifecycle

1. **Propose** — Admin A files a proposal:
   `POST /admin { action: 'proposal.create', payload: { targetOp, targetType, targetId, payload, reason } }`.
   The row lands in `admin_action_proposals` with `status='pending'` and
   `expires_at = now() + 24 hours`.
2. **Approve** — Admin B (≠ A) approves:
   `POST /admin { action: 'proposal.approve', payload: { proposalId, notes? } }`.
   The handler looks up the underlying handler from the dispatcher's
   `HANDLERS` map (lazy import), runs it with the proposer's payload,
   writes the underlying audit row with the approver as `actor_id`,
   then marks the proposal `status='executed'` and stores the audit-row
   id in `executed_audit_id`.
3. **Reject** — Either admin (still ≠ proposer for a meaningful audit
   trail) calls `proposal.reject` with a required reason; proposal goes
   to `status='rejected'`.

## Self-approval guard

The handler explicitly throws when `proposer_id === actor.id` with
the error code `self_approval_forbidden`. This is enforced in three
places:

1. The Edge handler (defense-in-depth).
2. The console UI grays out the Approve/Reject buttons on the
   proposer's own rows and shows a helper string.
3. (Future v2) An RLS-level check on the proposal table.

## Expiry

A `expire-stale-proposals-hourly` cron at `:25` past every hour calls
`expire_stale_proposals()`. The function flips
`status='pending' AND expires_at <= now()` rows to `status='expired'`.

Manual fire:

```sql
SELECT public.expire_stale_proposals();
```

## Audit trail

Every state change in the proposal lifecycle writes its own audit row:

| Op | Written when |
|---|---|
| `proposal_create` | A new proposal is filed (actor = proposer). |
| `proposal_approve` | The approver is the actor; the proposal goes to `executed`. The wrapped action also writes its own audit row, identified by `executed_audit_id`. |
| `proposal_reject` | The rejecter is the actor; proposal goes to `rejected`. |

There is **no audit row for `expired`** — the cron's update is silent
because the proposal was never executed.

## Direct call path (gated by feature flag, PR14)

The proposal flow is opt-in by default — admins can still call
`user.ban` directly without filing a proposal first. The "Require
approval (two-person rule)" checkbox in every irreversible
slide-over (Users, Observations, Bans, Badges) makes filing a
proposal a one-click choice rather than a separate workflow.

### v1.1 enforcement gate

A feature flag `enforce_two_person_irreversible` (in
`app_feature_flags`, default OFF) tightens this from "opt-in" to
"required" for the four irreversible ops. When the flag is ON the
admin Edge Function dispatcher rejects any direct call to
`role.revoke`, `user.ban`, `observation.hide`, or `badge.revoke`
with HTTP 403 and the error code
`direct_irreversible_call_forbidden`.

`proposal.approve` calls the inner handler directly (not via the
dispatcher), so the gate doesn't fire on the second leg of an
approved proposal. As defense-in-depth against future refactors,
`proposal.approve` also stamps an internal-only `_via_proposal: true`
field on the inner payload — if a future change ever round-trips
through the dispatcher, the gate would still let it through.

### Rollout sequence (recommended)

1. **Operator trains on the Proposals tab.** Use the
   "Require approval" slide-over toggle on a small set of actions
   for at least a week. Confirm both admins are reachable and the
   queue doesn't pile up.
2. **Toggle the flag ON via Console → Feature flags.** The flag
   key is `enforce_two_person_irreversible`. The change is
   audited (op = `feature_flag.toggle`).
3. **Verify the gate.** From the console, attempt a `user.ban`
   directly (without the toggle); the dispatcher should respond 403.
4. **Document the policy change** in the operator handbook so a
   second admin is always available within the proposal's 24-hour
   expiry window.

To roll back, toggle the flag OFF — the change takes effect on the
next dispatcher request (no deploy required).

## Forensics

To find every proposal that's ever been approved by a specific admin:

```sql
SELECT id, op, target_type, target_id, proposer_id, executed_at
  FROM public.admin_action_proposals
 WHERE approver_id = '<uuid>'
   AND status = 'executed'
ORDER BY executed_at DESC;
```

To find the underlying audit row for an executed proposal:

```sql
SELECT a.*
  FROM public.admin_audit a
  JOIN public.admin_action_proposals p ON p.executed_audit_id = a.id
 WHERE p.id = '<uuid>';
```
