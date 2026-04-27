import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendTurn,
  clearChatHistory,
  readRecentTurns,
  makeTurnId,
  CHAT_HISTORY_LIMIT,
  type ChatTurnStore,
} from './chat-history';
import type { ChatTurnRecord } from './db';

/**
 * In-memory fake of `ChatTurnStore`. The Dexie-backed default lives in
 * production code; the helper API is structured around an injectable store
 * specifically so these tests don't need a real IndexedDB.
 */
function makeFakeStore(): ChatTurnStore & { rows: ChatTurnRecord[] } {
  const rows: ChatTurnRecord[] = [];
  return {
    rows,
    async add(turn) { rows.push(turn); },
    async list(limit) {
      const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return sorted.slice(Math.max(0, sorted.length - limit));
    },
    async clear() { rows.length = 0; },
  };
}

describe('chat-history · write', () => {
  let store: ReturnType<typeof makeFakeStore>;
  beforeEach(() => { store = makeFakeStore(); });

  it('appends user and assistant turns with stable created_at + id', async () => {
    const u = await appendTurn(store, {
      role: 'user',
      content: 'is this a quetzal?',
      attachments: [{ kind: 'photo', mime_type: 'image/jpeg' }],
      created_at: '2026-04-25T10:00:00.000Z',
    });
    const a = await appendTurn(store, {
      role: 'assistant',
      content: 'Yes — Pharomachrus mocinno (resplendent quetzal).',
      created_at: '2026-04-25T10:00:01.000Z',
    });
    expect(store.rows).toHaveLength(2);
    expect(u.role).toBe('user');
    expect(u.content).toBe('is this a quetzal?');
    expect(u.attachments?.[0].kind).toBe('photo');
    expect(a.role).toBe('assistant');
    expect(u.id).not.toBe(a.id);
    expect(u.created_at).toBe('2026-04-25T10:00:00.000Z');
  });
});

describe('chat-history · read pagination', () => {
  let store: ReturnType<typeof makeFakeStore>;
  beforeEach(() => { store = makeFakeStore(); });

  it('caps to CHAT_HISTORY_LIMIT and returns the newest tail oldest-first', async () => {
    // Seed 60 turns (more than CHAT_HISTORY_LIMIT = 50) with monotonic timestamps
    for (let i = 0; i < 60; i++) {
      const ts = `2026-04-25T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      await appendTurn(store, {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn-${i}`,
        created_at: ts,
        id: `id-${i}`,
      });
    }
    expect(store.rows).toHaveLength(60);

    const recent = await readRecentTurns(store);
    expect(recent).toHaveLength(CHAT_HISTORY_LIMIT);
    // oldest-first within the page; first entry should be turn-10 (60 - 50)
    expect(recent[0].content).toBe('turn-10');
    expect(recent[recent.length - 1].content).toBe('turn-59');
  });

  it('honours an explicit lower limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendTurn(store, {
        role: 'user', content: `t-${i}`,
        created_at: `2026-04-25T10:00:0${i}.000Z`,
      });
    }
    const recent = await readRecentTurns(store, 3);
    expect(recent.map(r => r.content)).toEqual(['t-2', 't-3', 't-4']);
  });
});

describe('chat-history · clear', () => {
  it('removes every persisted turn', async () => {
    const store = makeFakeStore();
    await appendTurn(store, { role: 'user', content: 'a', created_at: '2026-04-25T10:00:00.000Z' });
    await appendTurn(store, { role: 'assistant', content: 'b', created_at: '2026-04-25T10:00:01.000Z' });
    expect(store.rows).toHaveLength(2);
    await clearChatHistory(store);
    expect(store.rows).toHaveLength(0);
    const recent = await readRecentTurns(store);
    expect(recent).toEqual([]);
  });
});

describe('chat-history · schema migration (v1 → v2)', () => {
  it('Dexie schema declares the chatTurns store at version 2', async () => {
    const { RastrumDB } = await import('./db');
    const db = new RastrumDB();
    // Dexie exposes the configured version number via `verno` after open.
    // We don't open here (no IndexedDB in node) but the `_versions` array
    // is populated synchronously via the constructor's `.version()` calls.
    type DexieInternal = typeof db & { _versions: Array<{ _cfg: { version: number; storesSource: Record<string, string | null> } }> };
    const versions = (db as DexieInternal)._versions;
    expect(versions.length).toBeGreaterThanOrEqual(2);
    const v2 = versions.find(v => v._cfg.version === 2);
    expect(v2).toBeTruthy();
    const stores = v2!._cfg.storesSource;
    expect(stores.chatTurns).toBeTruthy();
    // v1 must NOT have chatTurns — schema migration path is real
    const v1 = versions.find(v => v._cfg.version === 1);
    expect(v1?._cfg.storesSource.chatTurns).toBeFalsy();
  });

  it('makeTurnId produces unique ids for sequential calls', () => {
    const a = makeTurnId(1_700_000_000_000);
    const b = makeTurnId(1_700_000_000_000);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});
