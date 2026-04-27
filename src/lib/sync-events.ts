/**
 * Lightweight pub/sub for sync state. Multiple disconnected components
 * (header pill, observation form progress bar, profile last-sync stamp,
 * /mis-observaciones list) need to react to the same events without
 * importing each other.
 *
 * Events are dispatched on `window` so any island can subscribe via
 * standard `addEventListener`. Payloads are typed below.
 */

export const SYNC_EVENTS = {
  /** Fired when syncOutbox starts walking the queue. */
  start:    'rastrum:sync-start',
  /** Per-blob upload progress (R2 PUT). */
  progress: 'rastrum:sync-progress',
  /** A single observation finished syncing successfully. */
  rowDone:  'rastrum:sync-row-done',
  /** A single observation failed to sync; payload has the error message. */
  rowFail:  'rastrum:sync-row-fail',
  /** syncOutbox finished. Payload: synced/failed/last_error. */
  done:     'rastrum:sync-done',
  /** Pending Dexie row count changed (write or sync transition). */
  pendingChanged: 'rastrum:pending-changed',
} as const;

export type SyncDoneDetail = {
  synced: number;
  failed: number;
  skipped_guest: number;
  last_error: string | null;
};

export type SyncProgressDetail = {
  observation_id: string;
  blob_id: string;
  loaded: number;
  total: number;
};

export type SyncRowDetail = {
  observation_id: string;
  error?: string;
};

export type PendingChangedDetail = {
  count: number;
};

const LAST_SYNC_KEY = 'rastrum.lastSyncAt';

export function emit<T>(name: string, detail: T): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function setLastSyncAt(ts: string = new Date().toISOString()): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LAST_SYNC_KEY, ts); } catch { /* full storage */ }
}

export function getLastSyncAt(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(LAST_SYNC_KEY); } catch { return null; }
}

/**
 * Fetch the current pending-row count from Dexie. Used by the header pill
 * on init + after any sync event so the badge stays in sync.
 */
export async function getPendingCount(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  try {
    const { getDB } = await import('./db');
    const db = getDB();
    return await db.observations.where('sync_status').anyOf('pending', 'error').count();
  } catch {
    return 0;
  }
}

export async function announcePendingCount(): Promise<void> {
  const count = await getPendingCount();
  emit<PendingChangedDetail>(SYNC_EVENTS.pendingChanged, { count });
}
