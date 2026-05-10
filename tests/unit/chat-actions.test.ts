/**
 * Tests for the guided-actions / apply-fix contract (#917).
 * Covers: ChatAction type, buildUpdateNotesAction, executeAction,
 * and action_suggestion emission from streamChat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mock supabase (for executeAction) ---
const rpcMock = vi.fn();
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

// --- mock local-ai and chat-tools for streamChat ---
const loadGemmaMock = vi.fn();
vi.mock('../../src/lib/local-ai', () => ({
  loadGemmaTextEngine: () => loadGemmaMock(),
  loadTextEngine: vi.fn(),
  localAISupported: () => true,
}));
const runToolMock = vi.fn();
vi.mock('../../src/lib/chat-tools', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/chat-tools')>('../../src/lib/chat-tools');
  return {
    ...actual,
    runTool: (...a: unknown[]) => runToolMock(...a),
    toolDefinitions: () => '[]',
  };
});

import {
  buildUpdateNotesAction,
  executeAction,
  type ChatAction,
} from '../../src/lib/chat-tools';
import { streamChat } from '../../src/lib/chat-engine';

beforeEach(() => {
  rpcMock.mockReset();
  loadGemmaMock.mockReset();
  runToolMock.mockReset();
});

describe('buildUpdateNotesAction', () => {
  it('builds a ChatAction with correct shape', () => {
    const action = buildUpdateNotesAction('obs-123', 'New notes here');
    expect(action.id).toBe('update-notes-obs-123');
    expect(action.tool).toBe('chat_update_observation_notes');
    expect(action.args).toEqual({ observation_id: 'obs-123', notes: 'New notes here' });
    expect(action.requiresConfirmation).toBe(true);
    expect(action.undoable).toBe(true);
    expect(action.label.en).toContain('update notes');
    expect(action.label.es).toBeTruthy();
  });

  it('embeds observation_id in the action id', () => {
    const action = buildUpdateNotesAction('some-uuid-here', 'notes');
    expect(action.id).toBe('update-notes-some-uuid-here');
  });
});

describe('executeAction', () => {
  it('calls the correct RPC with remapped args', async () => {
    rpcMock.mockResolvedValue({ data: { updated: true }, error: null });
    const action = buildUpdateNotesAction('obs-abc', 'Updated text');
    const result = await executeAction(action);
    expect(rpcMock).toHaveBeenCalledWith('chat_update_observation_notes', {
      p_observation_id: 'obs-abc',
      p_notes: 'Updated text',
    });
    expect(result).toEqual({ ok: true, data: { updated: true } });
  });

  it('returns network error when RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RLS denied' } });
    const action = buildUpdateNotesAction('obs-xyz', 'text');
    const result = await executeAction(action);
    expect(result).toMatchObject({ error: 'network' });
  });

  it('returns unknown_tool for unsupported action tools', async () => {
    const badAction: ChatAction = {
      id: 'bad',
      label: { en: 'Bad', es: 'Malo' },
      tool: 'chat_delete_observation',
      args: { observation_id: 'x' },
      requiresConfirmation: true,
      undoable: false,
    };
    const result = await executeAction(badAction);
    expect(result).toEqual({ error: 'unknown_tool' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns invalid_args when args are missing required fields', async () => {
    const action: ChatAction = {
      id: 'bad-args',
      label: { en: 'Bad', es: 'Malo' },
      tool: 'chat_update_observation_notes',
      args: { observation_id: 123 as unknown as string, notes: 'text' }, // wrong type
      requiresConfirmation: true,
      undoable: true,
    };
    const result = await executeAction(action);
    expect(result).toMatchObject({ error: 'invalid_args' });
  });
});

describe('streamChat action_suggestion', () => {
  it('emits action_suggestion event when model outputs suggest_action JSON', async () => {
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        yield {
          choices: [{
            delta: {
              content: JSON.stringify({
                suggest_action: 'update_notes',
                observation_id: 'obs-001',
                notes: 'Spotted near the river at dusk',
              }),
            },
          }],
        };
      },
    });

    const events: Array<{ type: string; action?: ChatAction }> = [];
    for await (const ev of streamChat({ messages: [{ role: 'user', content: 'update my notes' }] })) {
      events.push(ev);
    }

    const suggestion = events.find(e => e.type === 'action_suggestion');
    expect(suggestion).toBeDefined();
    expect(suggestion?.action?.tool).toBe('chat_update_observation_notes');
    expect(suggestion?.action?.args).toMatchObject({
      observation_id: 'obs-001',
      notes: 'Spotted near the river at dusk',
    });
    expect(suggestion?.action?.requiresConfirmation).toBe(true);
    expect(suggestion?.action?.undoable).toBe(true);
    // Should NOT have called runTool (write ops don't auto-execute)
    expect(runToolMock).not.toHaveBeenCalled();
  });

  it('does not emit action_suggestion for regular tool calls', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        if (callIdx++ === 0) {
          yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"oak"}}' } }] };
        } else {
          yield { choices: [{ delta: { content: 'Found oak species.' } }] };
        }
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string }> = [];
    for await (const ev of streamChat({ messages: [{ role: 'user', content: 'find oak' }] })) {
      events.push(ev);
    }
    expect(events.some(e => e.type === 'action_suggestion')).toBe(false);
    expect(events.some(e => e.type === 'tool_call')).toBe(true);
  });
});
