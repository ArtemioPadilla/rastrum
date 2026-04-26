import { describe, it, expect } from 'vitest';
import {
  buildCommentTree,
  formatTimeAgo,
  renderMarkdown,
  sanitizeCommentBody,
  summarizeStreak,
  formatStreakDays,
  isSyncFilter,
  type CommentRow,
} from './social';

const row = (over: Partial<CommentRow>): CommentRow => ({
  id: over.id ?? 'r',
  observation_id: 'obs-1',
  author_id: 'user-1',
  body: over.body ?? 'hi',
  parent_id: over.parent_id ?? null,
  created_at: over.created_at ?? '2026-04-25T12:00:00Z',
  ...over,
});

describe('buildCommentTree', () => {
  it('groups replies under their top-level parent', () => {
    const rows: CommentRow[] = [
      row({ id: 'a', created_at: '2026-04-25T12:00:00Z' }),
      row({ id: 'b', created_at: '2026-04-25T12:01:00Z' }),
      row({ id: 'c', parent_id: 'a', created_at: '2026-04-25T12:02:00Z' }),
      row({ id: 'd', parent_id: 'b', created_at: '2026-04-25T12:03:00Z' }),
    ];
    const tree = buildCommentTree(rows);
    expect(tree.map(n => n.id)).toEqual(['a', 'b']);
    expect(tree[0].replies.map(n => n.id)).toEqual(['c']);
    expect(tree[1].replies.map(n => n.id)).toEqual(['d']);
  });

  it('flattens deep nesting to a single reply level', () => {
    const rows: CommentRow[] = [
      row({ id: 'top' }),
      row({ id: 'mid', parent_id: 'top', created_at: '2026-04-25T12:01:00Z' }),
      row({ id: 'deep', parent_id: 'mid', created_at: '2026-04-25T12:02:00Z' }),
    ];
    const tree = buildCommentTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('top');
    const ids = tree[0].replies.map(n => n.id).sort();
    expect(ids).toEqual(['deep', 'mid']);
  });

  it('promotes orphan replies to roots when parent is missing', () => {
    const rows: CommentRow[] = [
      row({ id: 'lone', parent_id: 'missing' }),
    ];
    const tree = buildCommentTree(rows);
    expect(tree.map(n => n.id)).toEqual(['lone']);
  });

  it('sorts roots and replies by created_at ascending', () => {
    const rows: CommentRow[] = [
      row({ id: 'b', created_at: '2026-04-25T13:00:00Z' }),
      row({ id: 'a', created_at: '2026-04-25T12:00:00Z' }),
      row({ id: 'a2', parent_id: 'a', created_at: '2026-04-25T12:30:00Z' }),
      row({ id: 'a1', parent_id: 'a', created_at: '2026-04-25T12:10:00Z' }),
    ];
    const tree = buildCommentTree(rows);
    expect(tree.map(n => n.id)).toEqual(['a', 'b']);
    expect(tree[0].replies.map(n => n.id)).toEqual(['a1', 'a2']);
  });
});

describe('formatTimeAgo', () => {
  const now = new Date('2026-04-25T12:00:00Z');

  it('returns "just now" within a minute (en)', () => {
    expect(formatTimeAgo('2026-04-25T11:59:30Z', 'en', now)).toBe('just now');
  });

  it('returns minute granularity (en)', () => {
    expect(formatTimeAgo('2026-04-25T11:55:00Z', 'en', now)).toBe('5m ago');
  });

  it('returns Spanish phrasing', () => {
    expect(formatTimeAgo('2026-04-25T11:55:00Z', 'es', now)).toBe('hace 5 min');
    expect(formatTimeAgo('2026-04-25T11:59:30Z', 'es', now)).toBe('ahora');
    expect(formatTimeAgo('2026-04-24T12:00:00Z', 'es', now)).toBe('hace 1 d');
  });

  it('rolls up to days/weeks/months/years', () => {
    expect(formatTimeAgo('2026-04-23T12:00:00Z', 'en', now)).toBe('2d ago');
    expect(formatTimeAgo('2026-04-10T12:00:00Z', 'en', now)).toBe('2w ago');
    expect(formatTimeAgo('2026-01-25T12:00:00Z', 'en', now)).toBe('3mo ago');
    expect(formatTimeAgo('2024-04-25T12:00:00Z', 'en', now)).toBe('2y ago');
  });
});

describe('renderMarkdown', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders bold and italic', () => {
    expect(renderMarkdown('**bold** and *italic*')).toBe(
      '<strong>bold</strong> and <em>italic</em>'
    );
  });

  it('renders inline code without re-escaping', () => {
    expect(renderMarkdown('use `npm install`')).toBe('use <code>npm install</code>');
  });

  it('renders explicit links with safe rels', () => {
    const html = renderMarkdown('[Rastrum](https://rastrum.artemiop.com)');
    expect(html).toContain('href="https://rastrum.artemiop.com"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('rejects javascript: links', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('click');
  });

  it('autolinks bare http URLs', () => {
    const html = renderMarkdown('see https://example.org for more');
    expect(html).toContain('href="https://example.org"');
  });

  it('strips on* attributes by escaping the whole input', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    // No live tag is emitted — it's escaped to text, so no on-handler can fire.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('"alert(1)"'); // quotes were escaped too
  });

  it('preserves newlines as <br>', () => {
    expect(renderMarkdown('a\nb')).toBe('a<br>b');
  });
});

describe('sanitizeCommentBody', () => {
  it('trims and renders', () => {
    expect(sanitizeCommentBody('   **hi**   ')).toBe('<strong>hi</strong>');
  });

  it('caps to 2000 chars', () => {
    const input = 'x'.repeat(3000);
    const out = sanitizeCommentBody(input);
    expect(out.length).toBeLessThanOrEqual(2000);
  });

  it('handles empty input', () => {
    expect(sanitizeCommentBody('')).toBe('');
  });
});

describe('summarizeStreak', () => {
  const today = new Date('2026-04-25T15:00:00Z');

  it('returns "none" when row is null', () => {
    const s = summarizeStreak(null, today);
    expect(s.state).toBe('none');
    expect(s.current).toBe(0);
    expect(s.longest).toBe(0);
  });

  it('returns "none" when never qualified', () => {
    const s = summarizeStreak({ current_days: 0, longest_days: 0, last_qualifying_day: null }, today);
    expect(s.state).toBe('none');
  });

  it('returns "active" when last day was today', () => {
    const s = summarizeStreak(
      { current_days: 5, longest_days: 9, last_qualifying_day: '2026-04-25' },
      today
    );
    expect(s.state).toBe('active');
    expect(s.daysSinceLast).toBe(0);
  });

  it('returns "active" when last day was yesterday', () => {
    const s = summarizeStreak(
      { current_days: 5, longest_days: 9, last_qualifying_day: '2026-04-24' },
      today
    );
    expect(s.state).toBe('active');
    expect(s.daysSinceLast).toBe(1);
  });

  it('returns "at_risk" when last day was 2 days ago but server still says active', () => {
    const s = summarizeStreak(
      { current_days: 5, longest_days: 9, last_qualifying_day: '2026-04-23' },
      today
    );
    expect(s.state).toBe('at_risk');
    expect(s.daysSinceLast).toBe(2);
  });

  it('returns "broken" when current is 0 but longest is positive', () => {
    const s = summarizeStreak(
      { current_days: 0, longest_days: 12, last_qualifying_day: '2026-04-01' },
      today
    );
    expect(s.state).toBe('broken');
  });
});

describe('formatStreakDays', () => {
  it('singular en', () => {
    expect(formatStreakDays(1, 'en')).toBe('1 day');
  });
  it('plural en', () => {
    expect(formatStreakDays(7, 'en')).toBe('7 days');
  });
  it('singular es', () => {
    expect(formatStreakDays(1, 'es')).toBe('1 día');
  });
  it('plural es', () => {
    expect(formatStreakDays(0, 'es')).toBe('0 días');
  });
  it('clamps NaN to 0', () => {
    expect(formatStreakDays(Number.NaN, 'en')).toBe('0 days');
  });
});

describe('isSyncFilter', () => {
  it('accepts known values', () => {
    expect(isSyncFilter('all')).toBe(true);
    expect(isSyncFilter('synced')).toBe(true);
    expect(isSyncFilter('pending')).toBe(true);
    expect(isSyncFilter('error')).toBe(true);
  });
  it('rejects unknown values', () => {
    expect(isSyncFilter(null)).toBe(false);
    expect(isSyncFilter('')).toBe(false);
    expect(isSyncFilter('SYNCED')).toBe(false);
    expect(isSyncFilter('foo')).toBe(false);
  });
});
