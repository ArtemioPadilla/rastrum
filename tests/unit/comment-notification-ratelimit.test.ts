/**
 * #970 — Rate-limit dedup for comment notifications
 *
 * The `notify_on_comment()` trigger now checks whether a 'comment'
 * notification for the same observation was already sent to the same
 * recipient within the last 30 minutes. If one exists it skips the INSERT.
 *
 * These tests verify the rate-limit logic in isolation using a pure
 * TypeScript replica of the updated PL/pgSQL function (no real Postgres
 * connection required).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewComment {
  id: string;
  observation_id: string;
  author_id: string;
  parent_id: string | null;
}

interface ExistingNotification {
  user_id: string;
  kind: 'comment';
  observation_id: string;
  created_at: Date;
}

interface Notification {
  user_id: string;
  kind: 'comment';
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure TypeScript replica of the updated notify_on_comment() (#970)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

function hasRecentNotification(
  existing: ExistingNotification[],
  userId: string,
  observationId: string,
  now: Date,
): boolean {
  return existing.some(
    n =>
      n.user_id === userId &&
      n.kind === 'comment' &&
      n.observation_id === observationId &&
      now.getTime() - n.created_at.getTime() < RATE_LIMIT_MS,
  );
}

function simulateNotifyOnCommentWithRateLimit(
  NEW: NewComment,
  obsOwner: string | null,
  parentAuthor: string | null,
  existingNotifications: ExistingNotification[],
  now: Date = new Date(),
): Notification[] {
  const notifications: Notification[] = [];

  // Notify obs owner (unless they are the commenter)
  if (obsOwner !== null && obsOwner !== NEW.author_id) {
    if (!hasRecentNotification(existingNotifications, obsOwner, NEW.observation_id, now)) {
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
  }

  // Notify parent comment author on reply
  if (NEW.parent_id !== null && parentAuthor !== null) {
    if (parentAuthor !== NEW.author_id && parentAuthor !== obsOwner) {
      if (!hasRecentNotification(existingNotifications, parentAuthor, NEW.observation_id, now)) {
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
  }

  return notifications;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const OBS_OWNER   = 'owner-uuid-0001';
const COMMENTER   = 'commenter-uuid-0002';
const COMMENTER_B = 'commenter-uuid-0003';
const THIRD_PARTY = 'parent-author-uuid-0004';
const OBS_ID      = 'obs-uuid-aaa';
const COMMENT_ID  = 'comment-uuid-bbb';
const COMMENT_ID2 = 'comment-uuid-ccc';
const PARENT_ID   = 'parent-uuid-ddd';

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notify_on_comment rate-limit dedup (#970)', () => {
  // ── 1. First comment always produces a notification ───────────────────────
  it('sends a notification when no prior notification exists for this observation', () => {
    const notifications = simulateNotifyOnCommentWithRateLimit(
      { id: COMMENT_ID, observation_id: OBS_ID, author_id: COMMENTER, parent_id: null },
      OBS_OWNER,
      null,
      [], // no prior notifications
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0].user_id).toBe(OBS_OWNER);
  });

  // ── 2. Second comment within 30 min is suppressed ────────────────────────
  it('suppresses the owner notification when a comment notification was sent < 30 min ago', () => {
    const priorNotifications: ExistingNotification[] = [
      {
        user_id: OBS_OWNER,
        kind: 'comment',
        observation_id: OBS_ID,
        created_at: minutesAgo(10), // 10 minutes ago — within the window
      },
    ];

    const notifications = simulateNotifyOnCommentWithRateLimit(
      { id: COMMENT_ID2, observation_id: OBS_ID, author_id: COMMENTER_B, parent_id: null },
      OBS_OWNER,
      null,
      priorNotifications,
    );

    expect(notifications).toHaveLength(0);
  });

  // ── 3. Comment after 30-min window triggers a new notification ────────────
  it('sends a notification when the prior notification is > 30 minutes old (window expired)', () => {
    const priorNotifications: ExistingNotification[] = [
      {
        user_id: OBS_OWNER,
        kind: 'comment',
        observation_id: OBS_ID,
        created_at: minutesAgo(35), // 35 minutes ago — outside the window
      },
    ];

    const notifications = simulateNotifyOnCommentWithRateLimit(
      { id: COMMENT_ID2, observation_id: OBS_ID, author_id: COMMENTER_B, parent_id: null },
      OBS_OWNER,
      null,
      priorNotifications,
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0].user_id).toBe(OBS_OWNER);
  });

  // ── 4. Rate-limit is per-observation, not per-user ────────────────────────
  it('sends a notification for obs B even when obs A is in the rate-limit window', () => {
    const OTHER_OBS_ID = 'obs-uuid-bbb';

    const priorNotifications: ExistingNotification[] = [
      {
        user_id: OBS_OWNER,
        kind: 'comment',
        observation_id: OBS_ID, // rate-limited on OBS_ID …
        created_at: minutesAgo(5),
      },
    ];

    const notifications = simulateNotifyOnCommentWithRateLimit(
      // … but the new comment is on OTHER_OBS_ID
      { id: COMMENT_ID2, observation_id: OTHER_OBS_ID, author_id: COMMENTER, parent_id: null },
      OBS_OWNER,
      null,
      priorNotifications,
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0].user_id).toBe(OBS_OWNER);
    expect(notifications[0].payload.observation_id).toBe(OTHER_OBS_ID);
  });

  // ── 5. Rate-limit applies to parent author too (reply path) ───────────────
  it('suppresses the parent-author reply notification when one was sent < 30 min ago', () => {
    const priorNotifications: ExistingNotification[] = [
      {
        user_id: THIRD_PARTY,
        kind: 'comment',
        observation_id: OBS_ID,
        created_at: minutesAgo(15), // within the window
      },
    ];

    const notifications = simulateNotifyOnCommentWithRateLimit(
      { id: COMMENT_ID2, observation_id: OBS_ID, author_id: COMMENTER, parent_id: PARENT_ID },
      OBS_OWNER,
      THIRD_PARTY,
      priorNotifications,
    );

    // THIRD_PARTY suppressed; OBS_OWNER has no prior notification so they still get one
    const recipientIds = notifications.map(n => n.user_id);
    expect(recipientIds).toContain(OBS_OWNER);
    expect(recipientIds).not.toContain(THIRD_PARTY);
  });
});
