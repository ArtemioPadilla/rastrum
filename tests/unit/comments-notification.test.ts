/**
 * #873 — Comments notification trigger unit tests
 *
 * The actual trigger is PL/pgSQL and runs server-side (Supabase).
 * These tests verify:
 *   1. The notification payload shape is correct for a top-level comment.
 *   2. The notification payload shape is correct for a threaded reply.
 *   3. The owner-is-commenter guard: no self-notification is produced.
 *   4. The parent-author == obs-owner dedup guard: parent author is not
 *      notified a second time when they are also the observation owner.
 *
 * We simulate the trigger logic in TypeScript so it can run in Vitest
 * without a real Postgres connection.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror of the PL/pgSQL trigger logic in TypeScript (pure function, no I/O)
// ---------------------------------------------------------------------------

interface NewComment {
  id: string;
  observation_id: string;
  author_id: string;
  parent_id: string | null;
}

interface Notification {
  user_id: string;
  kind: 'comment';
  payload: Record<string, unknown>;
}

/**
 * Pure TypeScript replica of `public.notify_on_comment()`.
 * Returns the array of notification rows that the trigger would INSERT.
 */
function simulateNotifyOnComment(
  NEW: NewComment,
  obsOwner: string | null,
  parentAuthor: string | null,
): Notification[] {
  const notifications: Notification[] = [];

  // Notify obs owner (unless they are the commenter)
  if (obsOwner !== null && obsOwner !== NEW.author_id) {
    notifications.push({
      user_id: obsOwner,
      kind: 'comment',
      payload: {
        comment_id: NEW.id,
        observation_id: NEW.observation_id,
        commenter_id: NEW.author_id,
      },
    });
  }

  // Notify parent comment author on reply (dedup: skip if same as obs owner)
  if (NEW.parent_id !== null && parentAuthor !== null) {
    if (parentAuthor !== NEW.author_id && parentAuthor !== obsOwner) {
      notifications.push({
        user_id: parentAuthor,
        kind: 'comment',
        payload: {
          comment_id: NEW.id,
          observation_id: NEW.observation_id,
          commenter_id: NEW.author_id,
          is_reply: true,
        },
      });
    }
  }

  return notifications;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notify_on_comment trigger logic (#873)', () => {
  const OBS_OWNER   = 'owner-uuid-0001';
  const COMMENTER   = 'commenter-uuid-0002';
  const THIRD_PARTY = 'parent-author-uuid-0003';
  const OBS_ID      = 'obs-uuid-aaa';
  const COMMENT_ID  = 'comment-uuid-bbb';
  const PARENT_ID   = 'parent-uuid-ccc';

  // ── 1. Top-level comment: owner notified ──────────────────────────────────
  it('notifies the observation owner when a stranger leaves a top-level comment', () => {
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: COMMENTER, parent_id: null },
      OBS_OWNER,
      null,
    );

    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toEqual({
      user_id: OBS_OWNER,
      kind: 'comment',
      payload: {
        comment_id: COMMENT_ID,
        observation_id: OBS_ID,
        commenter_id: COMMENTER,
      },
    });
    // is_reply should NOT be present for a top-level comment
    expect(notifs[0].payload).not.toHaveProperty('is_reply');
  });

  // ── 2. Reply: both owner and parent author notified ───────────────────────
  it('notifies the observation owner AND the parent comment author on a threaded reply', () => {
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: COMMENTER, parent_id: PARENT_ID },
      OBS_OWNER,
      THIRD_PARTY, // parent author is a third party
    );

    expect(notifs).toHaveLength(2);

    const ownerNotif = notifs.find(n => n.user_id === OBS_OWNER);
    expect(ownerNotif).toBeDefined();
    expect(ownerNotif!.payload).not.toHaveProperty('is_reply');

    const parentNotif = notifs.find(n => n.user_id === THIRD_PARTY);
    expect(parentNotif).toBeDefined();
    expect(parentNotif!.payload).toMatchObject({
      comment_id: COMMENT_ID,
      observation_id: OBS_ID,
      commenter_id: COMMENTER,
      is_reply: true,
    });
  });

  // ── 3. Owner is the commenter: no self-notification ───────────────────────
  it('does NOT notify the observation owner when the owner is the commenter', () => {
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: OBS_OWNER, parent_id: null },
      OBS_OWNER,
      null,
    );

    expect(notifs).toHaveLength(0);
  });

  // ── 4. Owner replies to their own observation thread ──────────────────────
  it('does NOT notify the owner twice when they reply to a third-party comment on their own obs', () => {
    // Owner (OBS_OWNER) replies to THIRD_PARTY's comment — THIRD_PARTY is parent author
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: OBS_OWNER, parent_id: PARENT_ID },
      OBS_OWNER,
      THIRD_PARTY,
    );

    // Owner-is-commenter guard fires: no owner notification
    // THIRD_PARTY is NOT the commenter, so they get notified
    expect(notifs).toHaveLength(1);
    expect(notifs[0].user_id).toBe(THIRD_PARTY);
    expect(notifs[0].payload.is_reply).toBe(true);
  });

  // ── 5. Parent author IS the obs owner: dedup guard ────────────────────────
  it('notifies the obs owner only once when the obs owner wrote the parent comment', () => {
    // OBS_OWNER wrote the parent comment, COMMENTER replies
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: COMMENTER, parent_id: PARENT_ID },
      OBS_OWNER,
      OBS_OWNER, // parent author == obs owner → dedup should suppress the second notification
    );

    // Only one notification (for OBS_OWNER as the obs owner, not as parent author)
    expect(notifs).toHaveLength(1);
    expect(notifs[0].user_id).toBe(OBS_OWNER);
    expect(notifs[0].payload).not.toHaveProperty('is_reply');
  });

  // ── 6. Notification payload shape is complete ─────────────────────────────
  it('notification payload always includes comment_id, observation_id, commenter_id', () => {
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: COMMENTER, parent_id: null },
      OBS_OWNER,
      null,
    );

    const payload = notifs[0].payload;
    expect(payload).toHaveProperty('comment_id', COMMENT_ID);
    expect(payload).toHaveProperty('observation_id', OBS_ID);
    expect(payload).toHaveProperty('commenter_id', COMMENTER);
  });

  // ── 7. Null obs owner (orphaned observation): no crash ────────────────────
  it('produces no notifications when the observation has no owner (null observer_id)', () => {
    const notifs = simulateNotifyOnComment(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: COMMENTER, parent_id: null },
      null, // no owner
      null,
    );

    expect(notifs).toHaveLength(0);
  });
});
