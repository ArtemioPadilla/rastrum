/**
 * Social helpers — pure functions for time-ago, comment-tree building, and
 * a tiny markdown sanitizer. Used by FollowButton, Comments, and Watchlist.
 *
 * The markdown subset is intentionally narrow: bold, italic, links,
 * autolinks, and code spans. Anything else is rendered as plain text.
 *
 * See docs/specs/modules/08-profile-activity-gamification.md for the
 * social schema. RLS is enforced server-side; we never gate on the client.
 */

export interface CommentRow {
  id: string;
  observation_id: string;
  author_id: string;
  body: string;
  parent_id: string | null;
  helpful_count?: number;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
}

export interface CommentNode extends CommentRow {
  replies: CommentNode[];
}

/**
 * Build a single-level threaded tree from flat rows.
 *
 * Rastrum threading is intentionally shallow — replies hang off top-level
 * comments only. If a row has a `parent_id` whose parent itself has a
 * parent, we promote the row to be a reply on the nearest top-level
 * ancestor, so we never render a third nesting level.
 */
export function buildCommentTree(rows: CommentRow[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const r of rows) byId.set(r.id, { ...r, replies: [] });

  const roots: CommentNode[] = [];

  for (const r of rows) {
    const node = byId.get(r.id);
    if (!node) continue;
    if (!r.parent_id) {
      roots.push(node);
      continue;
    }
    let parent = byId.get(r.parent_id);
    while (parent && parent.parent_id) {
      parent = byId.get(parent.parent_id);
    }
    if (parent) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  const byTime = (a: CommentNode, b: CommentNode) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  roots.sort(byTime);
  for (const r of roots) r.replies.sort(byTime);
  return roots;
}

/**
 * Locale-aware "time ago" string. Avoids any third-party dep —
 * accuracy to the minute is enough for a social feed.
 */
export function formatTimeAgo(isoOrDate: string | Date, lang: 'en' | 'es' = 'en', now: Date = new Date()): string {
  const then = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(seconds / 3600);
  const days = Math.round(seconds / 86400);
  const weeks = Math.round(days / 7);
  const months = Math.round(days / 30);
  const years = Math.round(days / 365);

  if (lang === 'es') {
    if (seconds < 60) return 'ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    if (hours < 24) return `hace ${hours} h`;
    if (days < 7) return `hace ${days} d`;
    if (weeks < 5) return `hace ${weeks} sem`;
    if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
    return `hace ${years} año${years === 1 ? '' : 's'}`;
  }
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

/** HTML-escape a string. Fast, no DOM required. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;

/**
 * Render a tiny, safe subset of markdown to HTML.
 *
 * Order matters: escape first, then run inline replacements on the
 * already-escaped output. Anything we don't recognise is plain text.
 *
 * Supported:
 *   `code`           -> <code>code</code>
 *   **bold**         -> <strong>bold</strong>
 *   *italic*         -> <em>italic</em>
 *   [text](url)      -> <a href="url">text</a>
 *   bare https://... -> <a href="...">...</a>
 *
 * URLs that don't match http(s)/mailto are rendered as plain text. We
 * never emit attribute names beyond `href`, `rel`, `target`, `class`,
 * so `on*` cannot leak in.
 */
export function renderMarkdown(input: string): string {
  if (!input) return '';
  const lines = input.split(/\r?\n/);
  const html = lines
    .map(line => inlineMarkdown(escapeHtml(line)))
    .join('<br>');
  return html;
}

function inlineMarkdown(escaped: string): string {
  let out = escaped;
  out = out.replace(/`([^`\n]+?)`/g, (_m, code: string) => `<code>${code}</code>`);

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    if (!SAFE_URL.test(url)) return `${text}`;
    return `<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${text}</a>`;
  });

  out = out.replace(/(^|[\s(])((?:https?:\/\/|mailto:)[^\s<>"')]+)/g, (_m, lead: string, url: string) => {
    if (!SAFE_URL.test(url)) return `${lead}${url}`;
    return `${lead}<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${url}</a>`;
  });

  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

/**
 * Full sanitisation pipeline used by the comments component:
 * trim, cap length, run renderMarkdown.
 *
 * The cap matches the schema CHECK constraint (2000 chars).
 */
export function sanitizeCommentBody(input: string): string {
  const trimmed = (input ?? '').trim().slice(0, 2000);
  return renderMarkdown(trimmed);
}

/**
 * Streak state derived from the public.user_streaks row plus today's date.
 *
 * 'active'  — streak is alive and the user observed today or yesterday
 * 'at_risk' — last qualifying day was 2 days ago (one grace miss left)
 * 'broken'  — current_days is 0 because the streak lapsed
 * 'none'    — user has never qualified
 */
export type StreakState = 'active' | 'at_risk' | 'broken' | 'none';

export interface StreakRow {
  current_days: number;
  longest_days: number;
  last_qualifying_day: string | null;
  updated_at?: string | null;
}

export interface StreakSummary {
  state: StreakState;
  current: number;
  longest: number;
  /** Human-friendly local-date string for last_qualifying_day (or null). */
  lastDayIso: string | null;
  /** Days elapsed since last_qualifying_day; null when no day on record. */
  daysSinceLast: number | null;
}

const MS_PER_DAY = 86_400_000;

function parseUtcDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function utcStartOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Summarise a streak row for display. Pure — no DB calls.
 *
 * The recompute job sets current_days = 0 when last_qualifying_day is older
 * than yesterday, but the day in between (today, with no obs yet) is still
 * "active" if last day was yesterday. We surface 'at_risk' when last day was
 * 2 days ago — the SQL allows a single 30-day grace miss, so the streak may
 * still be alive on the server.
 */
export function summarizeStreak(row: StreakRow | null | undefined, now: Date = new Date()): StreakSummary {
  if (!row || (row.current_days === 0 && row.longest_days === 0 && !row.last_qualifying_day)) {
    return { state: 'none', current: 0, longest: 0, lastDayIso: null, daysSinceLast: null };
  }
  const lastDate = row.last_qualifying_day ? parseUtcDate(row.last_qualifying_day) : null;
  const daysSinceLast = lastDate
    ? Math.floor((utcStartOfDay(now) - utcStartOfDay(lastDate)) / MS_PER_DAY)
    : null;

  let state: StreakState;
  if (row.current_days === 0) {
    state = row.longest_days > 0 ? 'broken' : 'none';
  } else if (daysSinceLast !== null && daysSinceLast >= 2) {
    state = 'at_risk';
  } else {
    state = 'active';
  }

  return {
    state,
    current: row.current_days,
    longest: row.longest_days,
    lastDayIso: row.last_qualifying_day ?? null,
    daysSinceLast,
  };
}

/**
 * Locale-aware label for a streak count.
 *
 * Examples:
 *   formatStreakDays(0, 'en') => '0 days'
 *   formatStreakDays(1, 'en') => '1 day'
 *   formatStreakDays(7, 'es') => '7 días'
 *   formatStreakDays(1, 'es') => '1 día'
 */
export function formatStreakDays(n: number, lang: 'en' | 'es'): string {
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (lang === 'es') return `${safe} día${safe === 1 ? '' : 's'}`;
  return `${safe} day${safe === 1 ? '' : 's'}`;
}

/**
 * Sync-status filter used by the My Observations list. Pure helper so the
 * page can be tested without a DOM.
 */
export type SyncFilter = 'all' | 'synced' | 'pending' | 'error' | 'draft';

export const SYNC_FILTERS: ReadonlyArray<SyncFilter> = ['all', 'synced', 'pending', 'error', 'draft'];

export function isSyncFilter(value: string | null | undefined): value is SyncFilter {
  return !!value && (SYNC_FILTERS as ReadonlyArray<string>).includes(value);
}
