/**
 * Unit tests for species lists (#875):
 * - Slug generation logic (pure function)
 * - Visibility filter logic
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Slug generation (mirrors the SQL trigger logic, extracted as a pure fn)
// ---------------------------------------------------------------------------

/**
 * Generate a URL-safe slug from a list name.
 * Mirrors public.generate_list_slug() in supabase-schema.sql.
 */
function generateBaseSlug(nameEs: string | null, nameEn: string | null): string {
  const source = nameEs ?? nameEn ?? 'list';
  const base = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'list';
}

/**
 * Resolve a unique slug given a set of existing slugs for the same user.
 * Appends -2, -3, … on collision.
 */
function resolveUniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let count = 1;
  let candidate = `${base}-${count}`;
  while (existing.has(candidate)) {
    count++;
    candidate = `${base}-${count}`;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Visibility filter (mirrors RLS policy logic)
// ---------------------------------------------------------------------------

type ListRow = {
  user_id: string;
  visibility: 'public' | 'private';
};

/**
 * Returns true if a caller can read the list.
 * Mirrors: visibility = 'public' OR auth.uid() = user_id
 */
function canReadList(list: ListRow, callerId: string | null): boolean {
  return list.visibility === 'public' || (callerId !== null && callerId === list.user_id);
}

/**
 * Returns true if a caller can write (insert/update/delete) to the list.
 * Mirrors: auth.uid() = user_id
 */
function canWriteList(list: ListRow, callerId: string | null): boolean {
  return callerId !== null && callerId === list.user_id;
}

// ---------------------------------------------------------------------------
// Tests: slug generation
// ---------------------------------------------------------------------------

describe('generateBaseSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(generateBaseSlug('Aves de mi jardín', null)).toBe('aves-de-mi-jard-n');
  });

  it('prefers name_es over name_en', () => {
    expect(generateBaseSlug('Aves locales', 'Local birds')).toBe('aves-locales');
  });

  it('falls back to name_en when name_es is null', () => {
    expect(generateBaseSlug(null, 'Garden birds')).toBe('garden-birds');
  });

  it('falls back to "list" when both names are null', () => {
    expect(generateBaseSlug(null, null)).toBe('list');
  });

  it('strips leading and trailing hyphens', () => {
    expect(generateBaseSlug('---hello---', null)).toBe('hello');
  });

  it('collapses multiple special chars into one hyphen', () => {
    expect(generateBaseSlug('birds & bees!!', null)).toBe('birds-bees');
  });

  it('handles empty string by returning "list"', () => {
    expect(generateBaseSlug('', null)).toBe('list');
  });
});

describe('resolveUniqueSlug', () => {
  it('returns base slug when no collision', () => {
    expect(resolveUniqueSlug('aves', new Set())).toBe('aves');
  });

  it('appends -1 suffix on first collision', () => {
    expect(resolveUniqueSlug('aves', new Set(['aves']))).toBe('aves-1');
  });

  it('increments suffix until unique', () => {
    const existing = new Set(['aves', 'aves-1', 'aves-2']);
    expect(resolveUniqueSlug('aves', existing)).toBe('aves-3');
  });

  it('returns base when collision set is empty', () => {
    expect(resolveUniqueSlug('mariposas', new Set())).toBe('mariposas');
  });
});

// ---------------------------------------------------------------------------
// Tests: visibility filter
// ---------------------------------------------------------------------------

describe('canReadList', () => {
  const ownerId = 'user-123';
  const otherId = 'user-456';

  it('allows anon to read public lists', () => {
    expect(canReadList({ user_id: ownerId, visibility: 'public' }, null)).toBe(true);
  });

  it('denies anon from reading private lists', () => {
    expect(canReadList({ user_id: ownerId, visibility: 'private' }, null)).toBe(false);
  });

  it('allows owner to read their own private list', () => {
    expect(canReadList({ user_id: ownerId, visibility: 'private' }, ownerId)).toBe(true);
  });

  it('denies non-owner from reading private list', () => {
    expect(canReadList({ user_id: ownerId, visibility: 'private' }, otherId)).toBe(false);
  });

  it('allows non-owner to read public list', () => {
    expect(canReadList({ user_id: ownerId, visibility: 'public' }, otherId)).toBe(true);
  });
});

describe('canWriteList', () => {
  const ownerId = 'user-123';
  const otherId = 'user-456';

  it('allows owner to write their list', () => {
    expect(canWriteList({ user_id: ownerId, visibility: 'public' }, ownerId)).toBe(true);
  });

  it('denies non-owner from writing', () => {
    expect(canWriteList({ user_id: ownerId, visibility: 'public' }, otherId)).toBe(false);
  });

  it('denies anon from writing', () => {
    expect(canWriteList({ user_id: ownerId, visibility: 'private' }, null)).toBe(false);
  });

  it('denies even owner if callerId is null', () => {
    // callerId=null means unauthenticated — even if the user_id matches somehow
    expect(canWriteList({ user_id: ownerId, visibility: 'public' }, null)).toBe(false);
  });
});
