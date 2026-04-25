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
