/**
 * Per-device chat history — backed by the Dexie `chatTurns` store.
 *
 * Privacy note: chat content lives ONLY in this device's IndexedDB. It is
 * never synced to Supabase, R2, or any third-party service. See module 11
 * (in-browser AI) for the full data-flow description.
 *
 * The functions accept an injected store so unit tests can pass an in-memory
 * fake without spinning up Dexie. Production callers use `defaultStore()`.
 */
import type { ChatTurnRecord } from './db';

export const CHAT_HISTORY_LIMIT = 50;

export interface ChatTurnStore {
  add(turn: ChatTurnRecord): Promise<void>;
  /** Returns up to `limit` most recent turns, oldest-first. */
  list(limit: number): Promise<ChatTurnRecord[]>;
  clear(): Promise<void>;
}

/**
 * Default Dexie-backed store. Lazily resolves the singleton db so a Node
 * import (e.g. SSR) never throws at module-init time.
 */
export function defaultStore(): ChatTurnStore {
  return {
    async add(turn) {
      const { getDB } = await import('./db');
      await getDB().chatTurns.put(turn);
    },
    async list(limit) {
      const { getDB } = await import('./db');
      const all = await getDB().chatTurns.orderBy('created_at').toArray();
      return all.slice(Math.max(0, all.length - limit));
    },
    async clear() {
      const { getDB } = await import('./db');
      await getDB().chatTurns.clear();
    },
  };
}

/** Stable id for a fresh turn — monotonic enough for natural ordering. */
export function makeTurnId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now.toString(36)}-${rand}`;
}

export async function appendTurn(
  store: ChatTurnStore,
  turn: Omit<ChatTurnRecord, 'id' | 'created_at'> & Partial<Pick<ChatTurnRecord, 'id' | 'created_at'>>,
): Promise<ChatTurnRecord> {
  const created_at = turn.created_at ?? new Date().toISOString();
  const id = turn.id ?? makeTurnId(Date.parse(created_at));
  const record: ChatTurnRecord = {
    id,
    role: turn.role,
    content: turn.content,
    attachments: turn.attachments,
    created_at,
  };
  await store.add(record);
  return record;
}

export async function readRecentTurns(
  store: ChatTurnStore,
  limit: number = CHAT_HISTORY_LIMIT,
): Promise<ChatTurnRecord[]> {
  return store.list(limit);
}

export async function clearChatHistory(store: ChatTurnStore): Promise<void> {
  await store.clear();
}
