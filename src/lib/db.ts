/**
 * Dexie IndexedDB outbox — see docs/specs/modules/03-offline.md.
 *
 * Client-only. Observations are written here first, then flushed to Supabase
 * by the sync engine (src/lib/sync.ts). Media blobs live in a separate table
 * so Dexie can stream them without pulling the whole observation row into
 * memory.
 */
import Dexie, { type Table } from 'dexie';
import type { Observation } from './types';

export interface ObservationRecord {
  id: string;                            // UUID v4, primary key
  observer_kind: 'user' | 'guest';       // mirrors observer_ref discriminator
  data: Observation;                     // the full observation payload
  /**
   * 'draft' = local-only, missing required GPS; sync engine SKIPS these
   * until the user opens the row and adds a location, which flips them to
   * 'pending' so they enter the normal upload path.
   */
  sync_status: 'pending' | 'synced' | 'error' | 'draft';
  sync_error?: string;
  sync_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface MediaBlobRecord {
  id: string;                            // UUID matching MediaFile.id
  observation_id: string;
  blob: Blob;
  mime_type: string;
  size_bytes: number;
  uploaded: boolean;
  upload_url?: string;                   // R2 URL once uploaded
}

export interface IDQueueRecord {
  observation_id: string;                // PK; one pending ID request per obs
  queued_at: string;
  attempts: number;
  last_error?: string;
}

/**
 * Persisted chat turn — per-device only, NEVER synced to Supabase. The
 * `attachments` field is light metadata (kind + mime + last cascade match)
 * so we can re-render the bubble; the original Blob is not preserved across
 * reloads (object URLs are revoked on unload anyway).
 */
export interface ChatTurnRecord {
  id: string;                             // monotonic local id
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    kind: 'photo' | 'audio';
    mime_type: string;
    duration_sec?: number;
    /** Best cascade scientific name, if the assistant turn carried one. */
    scientific_name?: string;
    confidence?: number;
    source?: string;
  }>;
  created_at: string;
}

export class RastrumDB extends Dexie {
  observations!: Table<ObservationRecord, string>;
  mediaBlobs!: Table<MediaBlobRecord, string>;
  idQueue!: Table<IDQueueRecord, string>;
  chatTurns!: Table<ChatTurnRecord, string>;

  constructor() {
    super('rastrum-v1');
    // Dexie schema version 1 — see docs/specs/modules/03-offline.md.
    // Bumping this version requires adding a migration (`.upgrade()`).
    this.version(1).stores({
      observations: 'id, observer_kind, sync_status, created_at',
      mediaBlobs:   'id, observation_id, uploaded',
      idQueue:      'observation_id, queued_at',
    });
    // Schema v2 — adds the per-device chat history store. Older clients
    // simply gain the empty store on next open; no data migration needed.
    this.version(2).stores({
      observations: 'id, observer_kind, sync_status, created_at',
      mediaBlobs:   'id, observation_id, uploaded',
      idQueue:      'observation_id, queued_at',
      chatTurns:    'id, role, created_at',
    });
  }
}

let _db: RastrumDB | null = null;

/** Singleton. Only call from client-side code (window required). */
export function getDB(): RastrumDB {
  if (!_db) _db = new RastrumDB();
  return _db;
}

/**
 * Ask the browser for persistent storage so iOS / Chrome don't evict our
 * observations under storage pressure. See module 03 § iOS constraints.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

/** Quick counts for the header / profile. */
export async function countPending(): Promise<number> {
  return getDB().observations.where('sync_status').equals('pending').count();
}
