/**
 * Pure builder for the audit "view trace" panel. One row per real
 * identification attempt (maps to identifications rows + cascade filter
 * outcomes), sorted oldest-first, with a typed outcome and a capped flag
 * for honest research-grade-floor messaging. See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */

// Sources whose registry confidence_ceiling is below the cascade
// ACCEPT_THRESHOLD (0.7) — they can never be authoritative / research-grade.
// EfficientNet 0.4, MegaDetector 0.4, Phi 0.35, Gemma 0.35. SpeciesNet
// (0.85) and cloud sources are NOT capped.
const CAPPED_SOURCES = new Set<string>([
  'onnx_efficientnet_lite0',
  'camera_trap_megadetector',
  'phi_vision',
  'onnx_gemma4_vision',
]);

export interface IdAttempt {
  source: string;
  where: 'device' | 'cloud';
  scientificName: string | null;
  confidence: number;
  isPrimary: boolean;
  createdAt: string;
  filteredLabel?: string;
}

export type TraceOutcome = 'pre-filter' | 'primary' | 'non-primary';

export interface TraceEntry {
  source: string;
  where: 'device' | 'cloud';
  scientificName: string | null;
  confidence: number;
  outcome: TraceOutcome;
  capped: boolean;
  createdAt: string;
}

export function buildAuditTrace(attempts: IdAttempt[]): TraceEntry[] {
  return [...attempts]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((a) => ({
      source: a.source,
      where: a.where,
      scientificName: a.scientificName,
      confidence: a.confidence,
      outcome: a.filteredLabel ? 'pre-filter' : a.isPrimary ? 'primary' : 'non-primary',
      capped: CAPPED_SOURCES.has(a.source),
      createdAt: a.createdAt,
    }));
}
