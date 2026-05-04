/**
 * pipeline-engine.ts — Observe 2.0 pipeline DAG engine
 *
 * Provides types, file triage, graph construction, and IndexedDB persistence
 * for the Drop & Discover observation pipeline. All processing is client-side.
 *
 * The engine is intentionally separate from UI rendering so that
 * ObserveView2 (full) and QuickObserveSheet (quick) can share the same logic.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type FileKind = 'photo' | 'audio' | 'video' | 'unknown';
/**
 * #592: extended states surface real cascade outcomes:
 *   running   — plugin in flight
 *   done      — accepted (confidence ≥ ACCEPT_THRESHOLD)
 *   rejected  — ran but below threshold; cascade continued
 *   failed    — threw an unrecognised error
 *   aborted   — cancelled mid-flight (e.g. higher-priority winner)
 *   skipped   — not eligible (no key, no download, etc.)
 */
export type NodeState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'rejected' | 'aborted';
export type NodeKind = 'input' | 'identify' | 'merge' | 'location' | 'save';

export interface PipelineResult {
  scientific_name: string;
  common_name_en: string | null;
  confidence: number;
  source: string;
}

export interface PipelineFile {
  id: string;
  file: File;
  kind: FileKind;
  blobUrl: string;
}

export interface PipelineNode {
  id: string;
  label: string;
  kind: NodeKind;
  state: NodeState;
  /** For identify nodes: which file this processes */
  fileId?: string;
  /** Which runner: plantnet, birdnet, claude, phi */
  runner?: string;
  dependsOn: string[];
  output?: PipelineResult;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface PipelineState {
  id: string;
  createdAt: number;
  files: PipelineFile[];
  nodes: PipelineNode[];
  mode: 'full' | 'quick';
  status: 'idle' | 'processing' | 'done' | 'failed';
}

export interface AvailableRunners {
  plantnet: boolean;
  birdnet: boolean;
  claude: boolean;
  phi: boolean;
}

// ── File triage ────────────────────────────────────────────────────────────

/**
 * Determine the media kind from MIME type.
 * Falls back to file extension if MIME is missing or generic.
 */
export function triageFile(file: File): FileKind {
  const mime = (file.type ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';

  // Fallback: extension sniff
  const ext = (file.name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'avif', 'bmp'].includes(ext)) return 'photo';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', '3gp'].includes(ext)) return 'video';

  return 'unknown';
}

// ── Graph construction ─────────────────────────────────────────────────────

/**
 * Build the pipeline DAG for a given set of files and available runners.
 * Returns the node list in topological order (inputs → processors → merge → save).
 */
export function buildGraph(files: PipelineFile[], runners: AvailableRunners): PipelineNode[] {
  const nodes: PipelineNode[] = [];

  // Input nodes — one per file
  for (const pf of files) {
    nodes.push({
      id: `input-${pf.id}`,
      label: pf.file.name ?? kindLabel(pf.kind),
      kind: 'input',
      state: 'done', // inputs are "done" immediately
      fileId: pf.id,
      dependsOn: [],
    });
  }

  // Identify nodes — one per file (depends on its input node)
  for (const pf of files) {
    const runner = pickRunner(pf.kind, runners);
    const available = runner !== null;
    nodes.push({
      id: `identify-${pf.id}`,
      label: identifyLabel(pf.kind, runner),
      kind: 'identify',
      state: available ? 'pending' : 'skipped',
      fileId: pf.id,
      runner: runner ?? undefined,
      dependsOn: [`input-${pf.id}`],
      error: available ? undefined : noRunnerMsg(pf.kind),
    });
  }

  // Merge node — depends on all identify nodes
  const identifyIds = files.map(pf => `identify-${pf.id}`);
  nodes.push({
    id: 'merge',
    label: 'Merge results',
    kind: 'merge',
    state: 'pending',
    dependsOn: identifyIds,
  });

  // Location node — depends on merge
  nodes.push({
    id: 'location',
    label: 'GPS location',
    kind: 'location',
    state: 'pending',
    dependsOn: ['merge'],
  });

  // Save node — depends on merge and location
  nodes.push({
    id: 'save',
    label: 'Save observation',
    kind: 'save',
    state: 'pending',
    dependsOn: ['merge', 'location'],
  });

  return nodes;
}

function kindLabel(kind: FileKind): string {
  if (kind === 'photo') return 'Photo';
  if (kind === 'audio') return 'Audio';
  if (kind === 'video') return 'Video';
  return 'File';
}

function identifyLabel(kind: FileKind, runner: string | null): string {
  if (kind === 'audio') return runner ? 'BirdNET' : 'Audio (no runner)';
  if (kind === 'photo') return runner === 'plantnet' ? 'PlantNet' : runner === 'claude' ? 'Claude Haiku' : runner === 'phi' ? 'Phi Vision' : 'Photo ID';
  if (kind === 'video') return 'Video frames';
  return 'Identify';
}

function pickRunner(kind: FileKind, runners: AvailableRunners): string | null {
  if (kind === 'audio') return runners.birdnet ? 'birdnet' : null;
  if (kind === 'photo') {
    if (runners.plantnet) return 'plantnet';
    if (runners.claude) return 'claude';
    if (runners.phi) return 'phi';
    return null;
  }
  if (kind === 'video') return runners.plantnet || runners.claude ? 'frames' : null;
  return null;
}

function noRunnerMsg(kind: FileKind): string {
  if (kind === 'audio') return 'BirdNET not cached';
  if (kind === 'photo') return 'No ID runner available (set PlantNet key or Anthropic key)';
  if (kind === 'video') return 'No runner for video';
  return 'Unsupported file type';
}

// ── IndexedDB persistence ──────────────────────────────────────────────────

const DB_NAME = 'rastrum-pipeline';
const DB_VERSION = 1;
const STORE = 'states';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePipelineState(state: PipelineState): Promise<void> {
  // Files contain File objects which can't be serialized to IDB directly.
  // Store a stripped version with just metadata.
  const serializable = {
    ...state,
    files: state.files.map(f => ({
      id: f.id,
      kind: f.kind,
      blobUrl: f.blobUrl,
      fileName: f.file.name,
      fileSize: f.file.size,
      fileType: f.file.type,
      // file object omitted — can't serialize File to IDB
    })),
  };
  // Also save under '__latest__' key for easy resume lookup
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(serializable);
    store.put({ ...serializable, id: '__latest__' });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPipelineState(id: string): Promise<PipelineState | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as PipelineState) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearPipelineState(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.objectStore(STORE).delete('__latest__');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// #592 — startCascadeWithGraph: bridges runCascade's live onAttempt events
// to PipelineGraph nodes, so the identify column reflects the real cascade
// decision tree instead of pickRunner's hardcoded one-runner-per-file
// approximation.
//
// Each onAttempt event creates or updates a node id `identify-${fileId}-${pluginId}`
// and dispatches `rastrum:pipeline-update` with the full node array so
// PipelineGraph re-renders.
// ─────────────────────────────────────────────────────────────────────────────

import type { CascadeAttemptEvent } from './identifiers/cascade';
import type { IdentifyInput } from './identifiers/types';
import type { CascadeOptions } from './identifiers/cascade';

export interface CascadeWithGraphInput {
  fileId: string;
  input: IdentifyInput;
  options: Omit<CascadeOptions, 'onAttempt'>;
  baseNodes: PipelineNode[];
}

function attemptStateToNodeState(state: CascadeAttemptEvent['state']): NodeState {
  switch (state) {
    case 'starting':  return 'running';
    case 'accepted':  return 'done';
    case 'rejected':  return 'rejected';
    case 'failed':    return 'failed';
    case 'skipped':   return 'skipped';
    case 'filtered':  return 'aborted';
  }
}

export async function startCascadeWithGraph(
  args: CascadeWithGraphInput,
): Promise<{ best: PipelineResult | null; nodes: PipelineNode[] }> {
  const { runCascade } = await import('./identifiers');
  const cascadeNodes = new Map<string, PipelineNode>();

  function emit(): void {
    if (typeof document === 'undefined') return;
    const all = [...args.baseNodes, ...cascadeNodes.values()];
    document.dispatchEvent(new CustomEvent('rastrum:pipeline-update', { detail: { nodes: all } }));
  }

  const result = await runCascade(args.input, {
    ...args.options,
    onAttempt: (ev) => {
      const id = `identify-${args.fileId}-${ev.id}`;
      const existing = cascadeNodes.get(id);
      const node: PipelineNode = existing ?? {
        id,
        label: ev.id,
        kind: 'identify',
        state: 'pending',
        fileId: args.fileId,
        runner: ev.id,
        dependsOn: [`input-${args.fileId}`],
      };
      node.state = attemptStateToNodeState(ev.state);
      if (ev.state === 'starting') node.startedAt = Date.now();
      else if (ev.state === 'accepted' || ev.state === 'rejected' || ev.state === 'failed' || ev.state === 'filtered') {
        node.completedAt = Date.now();
      }
      if (ev.result) {
        node.output = {
          scientific_name: ev.result.scientific_name,
          common_name_en: ev.result.common_name_en,
          confidence: ev.result.confidence,
          source: ev.result.source,
        };
      }
      if (ev.error) node.error = ev.error;
      if (ev.reason) node.error = node.error ?? ev.reason;
      cascadeNodes.set(id, node);
      emit();
    },
  });

  const best = result.best ? {
    scientific_name: result.best.scientific_name,
    common_name_en: result.best.common_name_en,
    confidence: result.best.confidence,
    source: result.best.source,
  } : null;

  return { best, nodes: [...args.baseNodes, ...cascadeNodes.values()] };
}
