import { describe, it, expect } from 'vitest';
import {
  fromRunCascade,
  fromEfResponse,
  fromIdentificationRow,
} from '../../src/lib/cascade-trace';

describe('cascade-trace adapters (#584)', () => {
  describe('fromRunCascade', () => {
    it('marks accepted when winner crosses threshold', () => {
      const trace = fromRunCascade({
        best: { source: 'claude_haiku', confidence: 0.89 },
        attempts: [
          { id: 'plantnet', ok: true, result: { scientific_name: 'X', common_name_en: null, confidence: 0.2, source: 'plantnet' } },
          { id: 'claude_haiku', ok: true, result: { scientific_name: 'Panthera onca', common_name_en: 'Jaguar', confidence: 0.89, source: 'claude_haiku' } },
        ],
      }, 'photo');
      expect(trace.attempts[0].state).toBe('rejected');
      expect(trace.attempts[1].state).toBe('accepted');
      expect(trace.threshold).toBe(0.7);
      expect(trace.winner?.provider_id).toBe('claude_haiku');
    });

    it('marks skipped when isAvailable failed (needs_key)', () => {
      const trace = fromRunCascade({
        best: null,
        attempts: [{ id: 'claude_haiku', ok: false, error: 'needs_key' }],
      }, 'photo');
      expect(trace.attempts[0].state).toBe('skipped');
    });

    it('marks failed for unknown errors', () => {
      const trace = fromRunCascade({
        best: null,
        attempts: [{ id: 'plantnet', ok: false, error: 'network blip' }],
      }, 'photo');
      expect(trace.attempts[0].state).toBe('failed');
    });

    it('uses display map for known plugins', () => {
      const trace = fromRunCascade({
        best: null,
        attempts: [{ id: 'camera_trap_megadetector', ok: false, error: 'needs_download' }],
      }, 'photo');
      expect(trace.attempts[0].display_name).toBe('MegaDetector');
      expect(trace.attempts[0].brand).toBe('🎯');
    });
  });

  describe('fromEfResponse', () => {
    it('parses cascade_attempts and infers winner', () => {
      const trace = fromEfResponse({
        source: 'plantnet',
        confidence: 0.81,
        cascade_attempts: [
          { provider: 'plantnet', confidence: 0.81 },
          { provider: 'claude_haiku', confidence: null, error: 'aborted' },
        ],
      });
      expect(trace.attempts[0].state).toBe('accepted');
      expect(trace.attempts[1].state).toBe('aborted');
    });
  });

  describe('fromIdentificationRow', () => {
    it('falls back to single-attempt summary when raw_response has no cascade_attempts', () => {
      const trace = fromIdentificationRow({
        source: 'plantnet',
        scientific_name: 'Quercus rubra',
        confidence: 0.85,
        raw_response: { common_name_en: 'Red oak' },
      });
      expect(trace?.attempts).toHaveLength(1);
      expect(trace?.attempts[0].state).toBe('accepted');
    });

    it('uses cascade_attempts when present', () => {
      const trace = fromIdentificationRow({
        source: 'claude_haiku',
        scientific_name: 'Panthera onca',
        confidence: 0.89,
        raw_response: {
          cascade_attempts: [
            { provider: 'plantnet', confidence: 0.05 },
            { provider: 'claude_haiku', confidence: 0.89 },
          ],
        },
      });
      expect(trace?.attempts).toHaveLength(2);
      expect(trace?.attempts[1].state).toBe('accepted');
    });
  });
});
