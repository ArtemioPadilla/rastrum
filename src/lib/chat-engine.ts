/**
 * Chat dispatch: Gemma 4 E2B by default, Llama-3.2-1B as fallback.
 * Implements a streaming + 1-round tool-call loop. Emits typed events
 * the UI consumes: text deltas, tool calls, tool results, engine fallbacks.
 *
 * The model is expected to either (a) emit prose, or (b) emit a single
 * JSON object `{"tool": "<name>", "args": { ... }}` with no surrounding
 * prose. We detect (b) by looking for a `{"tool":` substring at the start
 * of accumulated output. Anything else is treated as prose.
 */
import { runTool, toolDefinitions } from './chat-tools';
// NOTE: local-ai is dynamically imported below — a static import would
// drag the ~5.8 MB WebLLM bundle into the initial load graph. The
// static-import guard test enforces this.

export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'engine_fallback'; engine: 'llama'; reason: string }
  | { type: 'error'; message: string };

export interface StreamChatInput {
  messages: ChatMessage[];
  /** Optional override; default tries Gemma then Llama. */
  prefer?: 'gemma' | 'llama';
}

const TOOL_RE = /^\s*\{\s*"tool"\s*:/;
const MAX_TOOL_ROUNDS = 1;
const SYSTEM_TOOLS_PROMPT = `You may emit a JSON tool call to look up data. Tools available:\n%TOOLS%\nWhen calling a tool, respond with ONLY a JSON object: {"tool": "<name>", "args": { ... }}. Otherwise reply in prose. Use tools sparingly.`;

function withToolPrompt(messages: ChatMessage[]): ChatMessage[] {
  const sys = SYSTEM_TOOLS_PROMPT.replace('%TOOLS%', toolDefinitions());
  return [{ role: 'system', content: sys }, ...messages];
}

async function* streamGemma(messages: ChatMessage[]): AsyncIterable<{ delta?: string }> {
  const { loadGemmaTextEngine } = await import('./local-ai');
  const eng = await loadGemmaTextEngine(() => {});
  for await (const chunk of eng.generate(messages, { max_tokens: 512, stream: true })) {
    const c = chunk.choices?.[0];
    const delta = c?.delta?.content ?? c?.message?.content ?? '';
    if (delta) yield { delta };
  }
}

async function* streamLlama(messages: ChatMessage[]): AsyncIterable<{ delta?: string }> {
  const { loadTextEngine } = await import('./local-ai');
  const eng = await loadTextEngine(() => {});
  // Llama doesn't recognise the 'tool' role natively; flatten tool messages
  // into user-prefixed text so the conversation still parses.
  const flattened = messages.map(m => m.role === 'tool'
    ? { role: 'user' as const, content: `[tool_result]\n${m.content}` }
    : { role: m.role as 'system' | 'user' | 'assistant', content: m.content });
  const stream = await eng.chat.completions.create({
    messages: flattened,
    max_tokens: 512,
    stream: true,
  });
  for await (const chunk of stream as AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>) {
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (delta) yield { delta };
  }
}

async function* runOnce(
  messages: ChatMessage[],
  prefer: 'gemma' | 'llama' | undefined,
): AsyncIterable<StreamEvent> {
  if (prefer === 'llama') {
    for await (const c of streamLlama(messages)) {
      if (c.delta) yield { type: 'text', delta: c.delta };
    }
    return;
  }
  // Gemma path with Llama fallback on load error.
  try {
    for await (const c of streamGemma(messages)) {
      if (c.delta) yield { type: 'text', delta: c.delta };
    }
  } catch (e) {
    yield { type: 'engine_fallback', engine: 'llama', reason: e instanceof Error ? e.message : String(e) };
    for await (const c of streamLlama(messages)) {
      if (c.delta) yield { type: 'text', delta: c.delta };
    }
  }
}

/**
 * Streaming chat with a 1-round tool-call loop. Yields:
 *   { type: 'text', delta }            — model text deltas
 *   { type: 'tool_call', tool, args }  — when the model emitted a tool
 *   { type: 'tool_result', tool, … }   — after tool dispatch
 *   { type: 'engine_fallback', … }     — when Gemma fell back to Llama
 *   { type: 'error', message }         — terminal error
 */
export async function* streamChat(input: StreamChatInput): AsyncIterable<StreamEvent> {
  const messages = withToolPrompt(input.messages);
  let toolRounds = 0;

  while (true) {
    let accumulated = '';
    let toolCallText: string | null = null;
    const buffered: StreamEvent[] = [];

    for await (const ev of runOnce(messages, input.prefer)) {
      if (ev.type === 'text') {
        accumulated += ev.delta;
        if (toolCallText === null && accumulated.length >= 16 && !TOOL_RE.test(accumulated)) {
          // Definitely prose — flush buffered + this delta.
          for (const b of buffered) yield b;
          buffered.length = 0;
          yield ev;
        } else if (toolCallText === null) {
          // Still ambiguous — buffer.
          buffered.push(ev);
        }
        if (TOOL_RE.test(accumulated)) toolCallText = accumulated;
      } else {
        for (const b of buffered) yield b;
        buffered.length = 0;
        yield ev;
      }
    }

    if (toolCallText && toolRounds < MAX_TOOL_ROUNDS) {
      let parsed: { tool?: string; args?: unknown } | null = null;
      try { parsed = JSON.parse(toolCallText.trim()); } catch { /* fallthrough */ }
      if (!parsed?.tool) {
        for (const b of buffered) yield b;
        return;
      }
      yield { type: 'tool_call', tool: parsed.tool, args: parsed.args ?? {} };
      const result = await runTool({ name: parsed.tool, args: parsed.args ?? {} });
      yield { type: 'tool_result', tool: parsed.tool, result };
      toolRounds++;
      messages.push({ role: 'assistant', content: toolCallText });
      messages.push({ role: 'tool', content: JSON.stringify(result) });
      continue;
    }

    for (const b of buffered) yield b;
    return;
  }
}
