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
import { runTool, toolDefinitions, buildUpdateNotesAction } from './chat-tools';
import type { ChatAction } from './chat-tools';
// NOTE: local-ai is dynamically imported below — a static import would
// drag the ~5.8 MB WebLLM bundle into the initial load graph. The
// static-import guard test enforces this.

export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; tool: string; args: unknown; round: number }
  | { type: 'tool_result'; tool: string; result: unknown; round: number }
  | { type: 'engine_fallback'; engine: 'llama'; reason: string }
  | { type: 'circuit_break'; reason: string }
  | { type: 'action_suggestion'; action: ChatAction }
  | { type: 'error'; message: string };

export interface StreamChatInput {
  messages: ChatMessage[];
  /** Optional override; default tries Gemma then Llama. */
  prefer?: 'gemma' | 'llama';
}

const TOOL_RE = /^\s*\{\s*"tool"\s*:/;
const ACTION_SUGGEST_RE = /^\s*\{\s*"suggest_action"\s*:/;
const MAX_TOOL_ROUNDS = 3;
const TOKEN_BUDGET_CHARS = 4000;
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

/** Levenshtein distance between two strings (capped at maxDist for speed). */
function levenshtein(a: string, b: string, maxDist = 100): number {
  if (a === b) return 0;
  if (a.length === 0) return Math.min(b.length, maxDist);
  if (b.length === 0) return Math.min(a.length, maxDist);
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Streaming chat with a multi-round tool-call loop. Yields:
 *   { type: 'text', delta }            — model text deltas
 *   { type: 'tool_call', tool, args }  — when the model emitted a tool
 *   { type: 'tool_result', tool, … }   — after tool dispatch
 *   { type: 'engine_fallback', … }     — when Gemma fell back to Llama
 *   { type: 'error', message }         — terminal error
 */
export async function* streamChat(input: StreamChatInput): AsyncIterable<StreamEvent> {
  const messages = withToolPrompt(input.messages);
  let toolRounds = 0;
  let accumulatedTextChars = 0;
  // Circuit breaker: track (toolName, stringifiedArgs) pairs called this turn.
  const calledTools: Array<{ tool: string; argsStr: string }> = [];

  while (true) {
    let accumulated = '';
    let toolCallText: string | null = null;
    const buffered: StreamEvent[] = [];

    for await (const ev of runOnce(messages, input.prefer)) {
      if (ev.type === 'text') {
        accumulated += ev.delta;
        if (toolCallText === null && accumulated.length >= 16 && !TOOL_RE.test(accumulated) && !ACTION_SUGGEST_RE.test(accumulated)) {
          // Definitely prose — flush buffered + this delta.
          for (const b of buffered) yield b;
          buffered.length = 0;
          yield ev;
          accumulatedTextChars += ev.delta.length;
        } else if (toolCallText === null) {
          // Still ambiguous — buffer.
          buffered.push(ev);
        }
        if (TOOL_RE.test(accumulated)) toolCallText = accumulated;
        if (ACTION_SUGGEST_RE.test(accumulated)) toolCallText = accumulated;
      } else {
        for (const b of buffered) yield b;
        buffered.length = 0;
        yield ev;
      }
    }

    // Per-turn token budget check.
    if (accumulatedTextChars >= TOKEN_BUDGET_CHARS) {
      for (const b of buffered) yield b;
      return;
    }

    if (toolCallText && toolRounds < MAX_TOOL_ROUNDS) {
      let parsed: { tool?: string; args?: unknown; suggest_action?: string; observation_id?: string; notes?: string } | null = null;
      try { parsed = JSON.parse(toolCallText.trim()); } catch { /* fallthrough */ }
      if (!parsed) {
        for (const b of buffered) yield b;
        return;
      }

      // Handle action suggestion (write op requiring confirmation)
      if (parsed.suggest_action === 'update_notes' && parsed.observation_id && parsed.notes) {
        const action = buildUpdateNotesAction(parsed.observation_id, parsed.notes);
        yield { type: 'action_suggestion', action };
        for (const b of buffered) yield b;
        return;
      }

      if (!parsed.tool) {
        for (const b of buffered) yield b;
        return;
      }

      // Circuit breaker: check if this tool+args combo is suspiciously similar
      // to a previous call in this turn.
      const argsStr = JSON.stringify(parsed.args ?? {});
      const isDuplicate = calledTools.some(prev => {
        if (prev.tool !== parsed!.tool) return false;
        const maxLen = Math.max(prev.argsStr.length, argsStr.length);
        if (maxLen === 0) return true;
        const dist = levenshtein(prev.argsStr, argsStr, Math.ceil(maxLen * 0.1) + 1);
        return dist < maxLen * 0.1;
      });

      if (isDuplicate) {
        yield { type: 'circuit_break', reason: `Tool '${parsed.tool}' called with similar args in same turn` };
        for (const b of buffered) yield b;
        return;
      }

      calledTools.push({ tool: parsed.tool, argsStr });
      yield { type: 'tool_call', tool: parsed.tool, args: parsed.args ?? {}, round: toolRounds };
      const result = await runTool({ name: parsed.tool, args: parsed.args ?? {} });
      yield { type: 'tool_result', tool: parsed.tool, result, round: toolRounds };
      toolRounds++;
      messages.push({ role: 'assistant', content: toolCallText });
      messages.push({ role: 'tool', content: JSON.stringify(result) });
      continue;
    }

    for (const b of buffered) yield b;
    return;
  }
}
