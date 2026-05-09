import { describe, it, expect, vi } from 'vitest';

const rpcMock = vi.fn();
vi.mock('../supabase', () => ({ getSupabase: () => ({ rpc: rpcMock }) }));

import { observationSpec } from './observation';
import { speciesSpec } from './species';
import { projectSpec } from './project';
import { cameraStationSpec } from './camera-station';
import { observerSpec } from './observer';
import { selfProfileSpec } from './self-profile';

const cases = [
  ['observation', observationSpec],
  ['species', speciesSpec],
  ['project', projectSpec],
  ['camera_station', cameraStationSpec],
  ['observer', observerSpec],
  ['self_profile', selfProfileSpec],
] as const;

describe.each(cases)('%s EntitySpec', (kind, spec) => {
  it(`kind is "${kind}"`, () => {
    expect(spec.kind).toBe(kind);
  });

  it('fetchCard calls chat_entity_card with the right kind', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    await spec.fetchCard('xxx');
    expect(rpcMock).toHaveBeenCalledWith('chat_entity_card', {
      p_kind: kind,
      p_id: 'xxx',
    });
  });

  it('returns null when RPC returns null data', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await spec.fetchCard('xxx')).toBeNull();
  });

  it('returns the card when RPC returns data', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { kind, id: 'abc', label: 'L', summary_text: 's', fields: {}, suggested_questions: [], related: {} },
      error: null,
    });
    const card = await spec.fetchCard('abc');
    expect(card?.label).toBe('L');
  });

  it('throws on RPC error', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    await expect(spec.fetchCard('xxx')).rejects.toThrow(/rls denied/);
  });
});
