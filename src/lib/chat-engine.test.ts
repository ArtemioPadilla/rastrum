import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadGemmaMock = vi.fn();
const loadLlamaMock = vi.fn();
vi.mock('./local-ai', () => ({
  loadGemmaTextEngine: () => loadGemmaMock(),
  loadTextEngine: () => loadLlamaMock(),
  localAISupported: () => true,
}));

const runToolMock = vi.fn();
vi.mock('./chat-tools', () => ({
  runTool: (...a: unknown[]) => runToolMock(...a),
  toolDefinitions: () => '[]',
  listTools: () => [],
}));

import { streamChat } from './chat-engine';

function fakeStream(chunks: string[]) {
  return {
    async *generate() {
      for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
    },
  };
}

beforeEach(() => {
  loadGemmaMock.mockReset();
  loadLlamaMock.mockReset();
  runToolMock.mockReset();
});

describe('streamChat', () => {
  it('streams pure prose from Gemma when no tool call', async () => {
    loadGemmaMock.mockResolvedValue(fakeStream(['Hello there friend, how can I help today?']));
    const out: string[] = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'hi' }] })) {
      if (chunk.type === 'text') out.push(chunk.delta);
    }
    expect(out.join('')).toContain('Hello there friend');
  });

  it('detects a tool call, dispatches, re-prompts, returns final prose', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        if (callIdx++ === 0) {
          yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"magnolia"}}' } }] };
        } else {
          yield { choices: [{ delta: { content: 'Found Magnolia grandiflora in the seeded list.' } }] };
        }
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [{ scientific_name: 'Magnolia grandiflora' }] });

    const events: Array<{ type: string; delta?: string; tool?: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'find magnolia' }] })) {
      events.push(chunk);
    }
    expect(events.find(e => e.type === 'tool_call')?.tool).toBe('find_species');
    expect(events.filter(e => e.type === 'text').map(e => e.delta).join('')).toContain('Magnolia');
  });

  it('supports multi-round tool chains up to MAX_TOOL_ROUNDS', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        if (callIdx === 0) {
          callIdx++;
          yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"magnolia"}}' } }] };
        } else if (callIdx === 1) {
          callIdx++;
          yield { choices: [{ delta: { content: '{"tool":"find_observations","args":{"p_filters":{},"p_limit":5}}' } }] };
        } else if (callIdx === 2) {
          callIdx++;
          yield { choices: [{ delta: { content: '{"tool":"find_projects","args":{"p_query":"conservation"}}' } }] };
        } else {
          callIdx++;
          yield { choices: [{ delta: { content: 'Found all species, observations, and projects.' } }] };
        }
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string; round?: number }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'find species chains' }] })) {
      events.push(chunk);
    }
    const toolCalls = events.filter(e => e.type === 'tool_call');
    // 3 rounds allowed
    expect(toolCalls.length).toBeGreaterThanOrEqual(3);
    // rounds are indexed
    expect(toolCalls[0].round).toBe(0);
    expect(toolCalls[1].round).toBe(1);
    expect(toolCalls[2].round).toBe(2);
    // final prose
    expect(events.filter(e => e.type === 'text').map((e: any) => e.delta).join('')).toContain('Found');
  });

  it('tool_call and tool_result events include round index', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        if (callIdx++ === 0) {
          yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"oak"}}' } }] };
        } else {
          yield { choices: [{ delta: { content: 'Oak found.' } }] };
        }
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string; round?: number }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'find oak' }] })) {
      events.push(chunk);
    }
    const toolCall = events.find(e => e.type === 'tool_call');
    const toolResult = events.find(e => e.type === 'tool_result');
    expect(toolCall?.round).toBe(0);
    expect(toolResult?.round).toBe(0);
  });

  it('circuit breaker stops repeated similar tool calls', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        // Always emit the same tool with identical args — triggers circuit breaker on 2nd call
        callIdx++;
        yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"samequery"}}' } }] };
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'loop' }] })) {
      events.push(chunk);
    }
    // Only 1 tool_call before circuit break
    expect(events.filter(e => e.type === 'tool_call')).toHaveLength(1);
    expect(events.some(e => e.type === 'circuit_break')).toBe(true);
  });

  it('token budget stops tool loop after prose exceeds threshold', async () => {
    let callIdx = 0;
    const bigText = 'x'.repeat(5000); // exceeds TOKEN_BUDGET_CHARS=4000
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        if (callIdx++ === 0) {
          // First call: emit big prose (not a tool call)
          yield { choices: [{ delta: { content: bigText } }] };
        } else {
          yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"after"}}' } }] };
        }
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'big response' }] })) {
      events.push(chunk);
    }
    // No tool calls — budget was already consumed by the big prose
    expect(events.filter(e => e.type === 'tool_call')).toHaveLength(0);
  });

  it('falls back to Llama when Gemma load fails', async () => {
    loadGemmaMock.mockRejectedValue(new Error('webgpu init failed'));
    loadLlamaMock.mockResolvedValue({
      chat: {
        completions: {
          create: async () => ({
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: 'fallback response from llama as backup engine' } }] };
            },
          }),
        },
      },
    });

    const events: Array<{ type: string; delta?: string; engine?: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'x' }] })) {
      events.push(chunk);
    }
    expect(events.find(e => e.type === 'engine_fallback')?.engine).toBe('llama');
    expect(events.filter(e => e.type === 'text').map(e => e.delta).join('')).toContain('fallback');
  });
});
