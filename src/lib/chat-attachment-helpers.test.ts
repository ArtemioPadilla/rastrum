import { describe, it, expect } from 'vitest';
import {
  buildCascadeInterpretationPrompt,
  buildVisionFallbackPrompt,
  buildPendingObservation,
  buildChatSuggestions,
  parsePendingObservation,
  pluginIdToObservationSource,
  PENDING_OBSERVATION_KEY,
  type CascadeCandidate,
} from './chat-attachment-helpers';

const photoTopMatch: CascadeCandidate = {
  scientific_name: 'Quetzalus mocinno',
  common_name_en: 'Resplendent Quetzal',
  common_name_es: 'Quetzal',
  family: 'Trogonidae',
  kingdom: 'Animalia',
  confidence: 0.82,
  source: 'plantnet',
};

describe('chat-attachment-helpers · cascade interpretation prompt', () => {
  it('embeds top species, percentage, source, family, kingdom', () => {
    const p = buildCascadeInterpretationPrompt({
      kind: 'photo',
      userText: 'is this a quetzal?',
      locale: 'en',
      best: photoTopMatch,
    });
    expect(p).toContain('Quetzalus mocinno');
    expect(p).toContain('82%');
    expect(p).toContain('plantnet');
    expect(p).toContain('Trogonidae');
    expect(p).toContain('Animalia');
    expect(p).toContain('"is this a quetzal?"');
    expect(p).toContain('English');
  });

  it('uses the requested language phrase for ES', () => {
    const p = buildCascadeInterpretationPrompt({
      kind: 'photo',
      userText: '',
      locale: 'es',
      best: photoTopMatch,
    });
    expect(p).toContain('Spanish');
    // Empty user text falls back to a locale-aware placeholder
    expect(p).toContain('¿qué es esto?');
  });

  it('defaults user text to the EN placeholder when empty + locale=en', () => {
    const p = buildCascadeInterpretationPrompt({
      kind: 'audio',
      userText: '   ',
      locale: 'en',
      best: photoTopMatch,
    });
    expect(p).toContain('what is this?');
    expect(p).toContain('audio recording');
  });

  it('renders the picked common name (ES preferred when locale=es)', () => {
    const p = buildCascadeInterpretationPrompt({
      kind: 'photo',
      userText: 'q',
      locale: 'es',
      best: photoTopMatch,
    });
    expect(p).toContain('Common name: Quetzal');
  });

  it('falls back to the EN common name when ES is missing and locale=es', () => {
    const c: CascadeCandidate = { ...photoTopMatch, common_name_es: null };
    const p = buildCascadeInterpretationPrompt({ kind: 'photo', userText: '', locale: 'es', best: c });
    expect(p).toContain('Common name: Resplendent Quetzal');
  });

  it('lists alternates without repeating the top match', () => {
    const alts: CascadeCandidate[] = [
      { scientific_name: 'Quetzalus mocinno', confidence: 0.5, source: 'x' }, // dupe — drop
      { scientific_name: 'Trogon massena', confidence: 0.31, source: 'plantnet' },
      { scientific_name: 'Pharomachrus auriceps', confidence: 0.22, source: 'plantnet' },
    ];
    const p = buildCascadeInterpretationPrompt({
      kind: 'photo', userText: '', locale: 'en', best: photoTopMatch, alternates: alts,
    });
    expect(p).toContain('Trogon massena');
    expect(p).toContain('31%');
    expect(p).toContain('Pharomachrus auriceps');
    // Top match should appear ONCE — in the "Top species" line, not in alternates.
    const matches = p.match(/Quetzalus mocinno/g);
    expect(matches?.length).toBe(1);
  });

  it('asks the model to call out low confidence', () => {
    const p = buildCascadeInterpretationPrompt({ kind: 'photo', userText: '', locale: 'en', best: photoTopMatch });
    expect(p).toMatch(/below 40%/i);
    expect(p).toMatch(/Do not invent/);
  });
});

describe('chat-attachment-helpers · vision fallback prompt', () => {
  it('mentions the user text and language', () => {
    const p = buildVisionFallbackPrompt({ userText: 'what bird is this?', locale: 'en' });
    expect(p).toContain('what bird is this?');
    expect(p).toContain('English');
  });

  it('locale=es picks Spanish', () => {
    const p = buildVisionFallbackPrompt({ userText: '', locale: 'es' });
    expect(p).toContain('Spanish');
    expect(p).toContain('¿qué es esto?');
  });
});

describe('chat-attachment-helpers · pending observation handoff', () => {
  it('round-trips a typical photo payload', () => {
    const payload = {
      blob_url: 'blob:https://rastrum.org/abcd-1234',
      mime_type: 'image/jpeg',
      scientific_name: 'Quetzalus mocinno',
      confidence: 0.82,
      source: 'plantnet',
      common_name: 'Quetzal',
      kind: 'photo' as const,
    };
    const raw = buildPendingObservation(payload);
    const back = parsePendingObservation(raw);
    expect(back).toEqual(payload);
  });

  it('round-trips an audio payload', () => {
    const payload = {
      blob_url: 'blob:https://rastrum.org/feed-feed',
      mime_type: 'audio/webm',
      scientific_name: 'Trogon caligatus',
      confidence: 0.65,
      source: 'birdnet_lite',
      common_name: null,
      kind: 'audio' as const,
    };
    const raw = buildPendingObservation(payload);
    expect(parsePendingObservation(raw)).toEqual(payload);
  });

  it('returns null for malformed json / missing fields / wrong kind', () => {
    expect(parsePendingObservation(null)).toBeNull();
    expect(parsePendingObservation('')).toBeNull();
    expect(parsePendingObservation('{not json')).toBeNull();
    expect(parsePendingObservation('{}')).toBeNull();
    expect(parsePendingObservation(JSON.stringify({ blob_url: 'x', kind: 'video' }))).toBeNull();
    expect(parsePendingObservation(JSON.stringify({ blob_url: '', kind: 'photo' }))).toBeNull();
  });

  it('coerces missing optional fields to safe defaults', () => {
    const raw = JSON.stringify({ blob_url: 'blob:foo', kind: 'photo' });
    const v = parsePendingObservation(raw);
    expect(v).not.toBeNull();
    expect(v!.scientific_name).toBe('');
    expect(v!.confidence).toBe(0);
    expect(v!.source).toBe('human');
    expect(v!.common_name).toBeNull();
    expect(v!.mime_type).toBe('application/octet-stream');
  });

  it('exposes a stable storage key', () => {
    expect(PENDING_OBSERVATION_KEY).toBe('rastrum.pendingObservation');
  });
});

describe('chat-attachment-helpers · plugin id → IDSource', () => {
  it('preserves direct equivalents', () => {
    expect(pluginIdToObservationSource('plantnet')).toBe('plantnet');
    expect(pluginIdToObservationSource('claude_haiku')).toBe('claude_haiku');
    expect(pluginIdToObservationSource('claude_sonnet')).toBe('claude_sonnet');
  });

  it('collapses on-device plugins to onnx_offline', () => {
    expect(pluginIdToObservationSource('webllm_phi35_vision')).toBe('onnx_offline');
    expect(pluginIdToObservationSource('birdnet_lite')).toBe('onnx_offline');
    expect(pluginIdToObservationSource('onnx_efficientnet_lite0')).toBe('onnx_offline');
  });

  it('falls back to human for unknown plugins', () => {
    expect(pluginIdToObservationSource('made_up_plugin')).toBe('human');
    expect(pluginIdToObservationSource('')).toBe('human');
  });
});

describe('chat-attachment-helpers · suggestion chips', () => {
  it('returns 3 generic chips on the first turn (no species in scope) — EN', () => {
    const chips = buildChatSuggestions({ locale: 'en' });
    expect(chips).toHaveLength(3);
    expect(chips[0].label).toMatch(/poisonous/i);
    expect(chips[1].label).toMatch(/tell.*apart/i);
    expect(chips[2].label).toMatch(/habitat/i);
  });

  it('returns 3 generic chips on the first turn (no species in scope) — ES', () => {
    const chips = buildChatSuggestions({ locale: 'es' });
    expect(chips).toHaveLength(3);
    expect(chips[0].label).toBe('¿Es venenosa?');
    expect(chips[1].label).toBe('¿Cómo la distingo?');
    expect(chips[2].label).toBe('Hábitat típico');
  });

  it('personalises chips when a scientific name is in scope', () => {
    const chips = buildChatSuggestions({
      locale: 'es',
      scientificName: 'Brongniartia argentea',
    });
    expect(chips[0].prompt).toContain('Brongniartia argentea');
    expect(chips[1].prompt).toContain('Brongniartia argentea');
    expect(chips[2].prompt).toContain('Brongniartia argentea');
  });

  it('uses the common name in chip labels when supplied', () => {
    const chips = buildChatSuggestions({
      locale: 'en',
      scientificName: 'Pharomachrus mocinno',
      commonName: 'Resplendent Quetzal',
    });
    expect(chips[0].label).toContain('Resplendent Quetzal');
    expect(chips[1].label).toContain('Resplendent Quetzal');
    expect(chips[2].label).toContain('Resplendent Quetzal');
    // Prompts still carry the scientific name
    expect(chips[0].prompt).toContain('Pharomachrus mocinno');
  });
});
