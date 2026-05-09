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

  it('caps tool calls at 1 round per turn', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        const tool = `{"tool":"find_species","args":{"p_query":"x${callIdx++}"}}`;
        yield { choices: [{ delta: { content: tool } }] };
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'x' }] })) {
      events.push(chunk);
    }
    const toolEvents = events.filter(e => e.type === 'tool_call');
    expect(toolEvents).toHaveLength(1);
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
