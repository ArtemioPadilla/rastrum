import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('./supabase', () => ({ getSupabase: () => ({ rpc: rpcMock }) }));

import { runTool, listTools, toolDefinitions } from './chat-tools';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('chat-tools', () => {
  it('exposes the registered tools', () => {
    const names = listTools().map(t => t.name).sort();
    expect(names).toEqual([
      'find_camera_stations',
      'find_location',
      'find_observations',
      'find_observers',
      'find_projects',
      'find_species',
    ]);
  });

  it('toolDefinitions is a JSON-shaped string for the system prompt', () => {
    const defs = toolDefinitions();
    expect(typeof defs).toBe('string');
    expect(defs).toContain('find_observations');
    expect(defs).toContain('find_species');
  });

  it('runTool: unknown name returns error', async () => {
    const r = await runTool({ name: 'unknown', args: {} });
    expect(r).toEqual({ error: 'unknown_tool' });
  });

  it('runTool: invalid args returns invalid_args', async () => {
    const r = await runTool({ name: 'find_observations', args: { p_filters: 'not an object' } });
    expect(r).toMatchObject({ error: 'invalid_args' });
  });

  it('runTool: dispatches a valid call and returns ok', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 'a' }], error: null });
    const r = await runTool({ name: 'find_species', args: { p_query: 'magnolia', p_limit: 5 } });
    expect(rpcMock).toHaveBeenCalledWith('chat_find_species', { p_query: 'magnolia', p_limit: 5 });
    expect(r).toEqual({ ok: true, data: [{ id: 'a' }] });
  });

  it('runTool: RPC network error → {error: "network"}', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
    const r = await runTool({ name: 'find_species', args: { p_query: 'x' } });
    expect(r).toMatchObject({ error: 'network' });
  });

  it('runTool: thrown promise → {error: "offline"}', async () => {
    rpcMock.mockRejectedValue(new Error('Failed to fetch'));
    const r = await runTool({ name: 'find_species', args: { p_query: 'x' } });
    expect(r).toMatchObject({ error: 'offline' });
  });

  it('find_observations validates radius_km is a number', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const ok = await runTool({
      name: 'find_observations',
      args: { p_filters: { radius_km: 25 }, p_limit: 10 },
    });
    expect(ok).toMatchObject({ ok: true });

    const bad = await runTool({
      name: 'find_observations',
      args: { p_filters: { radius_km: 'far' } },
    });
    expect(bad).toMatchObject({ error: 'invalid_args' });
  });
});
