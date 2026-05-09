import { describe, expect, it } from 'vitest';
import { pickProviderNote } from '../../src/lib/why-this-species';

// Pin the provider-note registry for the "Why this species?" panel
// (issue #736). The chip names + the "what this is good at" line are
// load-bearing UI strings — a typo here changes what users see in
// the credibility panel under every cascade result.

describe('pickProviderNote', () => {
  const sources = [
    'plantnet',
    'claude_haiku',
    'webllm_phi35_vision',
    'onnx_gemma4_vision',
    'birdnet',
    'onnx_base',
  ] as const;

  it('returns a name + note for every known source in EN', () => {
    for (const s of sources) {
      const r = pickProviderNote(s, 'en');
      expect(r.name).toBeTruthy();
      expect(r.note).toBeTruthy();
      expect(r.name).not.toBe(s);
    }
  });

  it('returns a name + note for every known source in ES', () => {
    for (const s of sources) {
      const r = pickProviderNote(s, 'es');
      expect(r.name).toBeTruthy();
      expect(r.note).toBeTruthy();
      expect(r.name).not.toBe(s);
    }
  });

  it('uses the same display name across languages', () => {
    for (const s of sources) {
      const en = pickProviderNote(s, 'en');
      const es = pickProviderNote(s, 'es');
      expect(en.name).toBe(es.name);
    }
  });

  it('translates the note between EN and ES', () => {
    for (const s of sources) {
      const en = pickProviderNote(s, 'en');
      const es = pickProviderNote(s, 'es');
      expect(en.note).not.toBe(es.note);
    }
  });

  it('PlantNet note mentions plants', () => {
    expect(pickProviderNote('plantnet', 'en').note).toMatch(/plant/i);
    expect(pickProviderNote('plantnet', 'es').note).toMatch(/plant/i);
  });

  it('Claude note signals generalist', () => {
    expect(pickProviderNote('claude_haiku', 'en').name).toMatch(/Claude/);
    expect(pickProviderNote('claude_haiku', 'en').note).toMatch(/general/i);
  });

  it('on-device VLMs are flagged as hints, not verdicts', () => {
    expect(pickProviderNote('webllm_phi35_vision', 'en').note).toMatch(/hint/i);
    expect(pickProviderNote('onnx_gemma4_vision', 'en').note).toMatch(/hint/i);
    expect(pickProviderNote('webllm_phi35_vision', 'es').note).toMatch(/pista/i);
    expect(pickProviderNote('onnx_gemma4_vision', 'es').note).toMatch(/pista/i);
  });

  it('falls back to the raw id for unknown sources', () => {
    const en = pickProviderNote('mystery_model_v9', 'en');
    expect(en.name).toBe('mystery_model_v9');
    expect(en.note).toBeTruthy();
    const es = pickProviderNote('mystery_model_v9', 'es');
    expect(es.name).toBe('mystery_model_v9');
    expect(es.note).toBeTruthy();
  });
});
