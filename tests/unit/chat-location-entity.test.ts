/**
 * Tests for the location entity kind (#914).
 * Covers: locationSpec, find_location tool, canonicalEntityUrl, and
 * bootstrapChatEntities registration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mock supabase ---
const rpcMock = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

import { locationSpec } from '../../src/lib/chat-entities/location';
import { registry } from '../../src/lib/chat-entities/registry';
import { bootstrapChatEntities } from '../../src/lib/chat-entities/index';
import { canonicalEntityUrl } from '../../src/lib/chat-bubble-html';
import { runTool, listTools } from '../../src/lib/chat-tools';

beforeEach(() => {
  rpcMock.mockReset();
  (registry as unknown as { _resetForTests: () => void })._resetForTests();
  // Reset bootstrapped flag via re-import isn't possible with vitest cache,
  // so directly register for registry tests.
});

// ---------------------------------------------------------------------------
// locationSpec unit tests
// ---------------------------------------------------------------------------

describe('locationSpec', () => {
  it('kind is "location"', () => {
    expect(locationSpec.kind).toBe('location');
  });

  it('icon is 📍', () => {
    expect(locationSpec.icon).toBe('📍');
  });

  it('has bilingual label', () => {
    expect(locationSpec.label.en).toBeTruthy();
    expect(locationSpec.label.es).toBeTruthy();
  });

  it('fetchCard calls chat_entity_card with kind=location', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await locationSpec.fetchCard('test-id');
    expect(rpcMock).toHaveBeenCalledWith('chat_entity_card', {
      p_kind: 'location',
      p_id: 'test-id',
    });
  });

  it('fetchCard returns null when RPC returns null data', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await locationSpec.fetchCard('test-id')).toBeNull();
  });

  it('fetchCard returns the card when RPC returns data', async () => {
    const card = {
      kind: 'location',
      id: 'loc-1',
      label: 'Reserva Tehuacán',
      summary_text: 'Protected area',
      fields: { place_type: 'protected_area', observation_count: 42 },
      suggested_questions: [],
      related: {},
    };
    rpcMock.mockResolvedValue({ data: card, error: null });
    const result = await locationSpec.fetchCard('loc-1');
    expect(result?.label).toBe('Reserva Tehuacán');
  });

  it('fetchCard throws on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'places rls denied' } });
    await expect(locationSpec.fetchCard('test-id')).rejects.toThrow(/places rls denied/);
  });

  it('suggestedTools includes find_location', () => {
    expect(locationSpec.suggestedTools).toContain('find_location');
  });
});

// ---------------------------------------------------------------------------
// canonicalEntityUrl for location
// ---------------------------------------------------------------------------

describe('canonicalEntityUrl location', () => {
  it('generates es URL with explorar/lugares slug', () => {
    const url = canonicalEntityUrl('location', 'reserva-tehuacan', 'es');
    expect(url).toContain('explorar');
    expect(url).toContain('lugares');
    expect(url).toContain('reserva-tehuacan');
  });

  it('generates en URL with explore slug', () => {
    const url = canonicalEntityUrl('location', 'reserva-tehuacan', 'en');
    expect(url).toContain('explore');
    expect(url).toContain('reserva-tehuacan');
  });
});

// ---------------------------------------------------------------------------
// find_location tool
// ---------------------------------------------------------------------------

describe('find_location tool', () => {
  it('is registered in listTools()', () => {
    const names = listTools().map(t => t.name);
    expect(names).toContain('find_location');
  });

  it('runTool returns unknown_tool for unknown name', async () => {
    const result = await runTool({ name: 'find_location_unknown', args: {} });
    expect(result).toEqual({ error: 'unknown_tool' });
  });

  it('runTool validates missing p_query', async () => {
    const result = await runTool({ name: 'find_location', args: {} });
    expect(result).toMatchObject({ error: 'invalid_args' });
  });

  it('runTool validates empty p_query string', async () => {
    const result = await runTool({ name: 'find_location', args: { p_query: '  ' } });
    expect(result).toMatchObject({ error: 'invalid_args' });
  });

  it('runTool calls chat_find_location RPC with correct args', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await runTool({ name: 'find_location', args: { p_query: 'tehuacan' } });
    expect(rpcMock).toHaveBeenCalledWith('chat_find_location', {
      p_query: 'tehuacan',
      p_limit: 5,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('runTool respects explicit p_limit', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await runTool({ name: 'find_location', args: { p_query: 'oaxaca', p_limit: 3 } });
    expect(rpcMock).toHaveBeenCalledWith('chat_find_location', {
      p_query: 'oaxaca',
      p_limit: 3,
    });
  });

  it('runTool returns network error on RPC failure', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    const result = await runTool({ name: 'find_location', args: { p_query: 'oaxaca' } });
    expect(result).toMatchObject({ error: 'network' });
  });
});
