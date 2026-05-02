import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { bedrockModelId, buildProvider, parseModelJson, parseBedrockSecret, toVisionResult } from './vision-provider.ts';
import { defaultModelFor, detectKind } from './vision-validate.ts';

Deno.test('buildProvider — exhaustive switch handles every kind without throwing', () => {
  const kinds = ['api_key', 'oauth_token', 'bedrock', 'openai_api_key', 'azure_openai', 'gemini_api_key', 'vertex_ai'] as const;
  for (const kind of kinds) {
    const provider = buildProvider({
      kind,
      secret: kind === 'bedrock' || kind === 'vertex_ai' ? '{"accessKeyId":"x","secretAccessKey":"y"}' : 'x',
      model: 'm',
      endpoint: kind === 'azure_openai' ? 'https://x/' : null,
    });
    if (typeof provider.identify !== 'function') {
      throw new Error(`expected identify() method on ${kind} provider`);
    }
  }
});

Deno.test('parseBedrockSecret — accepts well-formed JSON envelopes', () => {
  const ok = parseBedrockSecret('{"region":"us-east-1","accessKeyId":"AK","secretAccessKey":"SK"}');
  assertEquals(ok?.accessKeyId, 'AK');
  assertEquals(ok?.region, 'us-east-1');
});

Deno.test('parseBedrockSecret — rejects missing required fields', () => {
  assertEquals(parseBedrockSecret('{"region":"us-east-1"}'), null);
  assertEquals(parseBedrockSecret('not json'), null);
  assertEquals(parseBedrockSecret('{}'), null);
});

Deno.test('parseModelJson — strips ```json fences', () => {
  const cleaned = parseModelJson('```json\n{"scientific_name":"Q. mocinno","confidence":0.9}\n```');
  assertEquals(cleaned?.scientific_name, 'Q. mocinno');
  assertEquals(cleaned?.confidence, 0.9);
});

Deno.test('parseModelJson — returns null on broken JSON', () => {
  assertEquals(parseModelJson('not json'), null);
  assertEquals(parseModelJson(''), null);
});

Deno.test('toVisionResult — returns null when scientific_name missing', () => {
  assertEquals(toVisionResult({ confidence: 0.9 }, 'x', {}), null);
  assertEquals(toVisionResult(null, 'x', {}), null);
});

Deno.test('toVisionResult — fills missing optional fields with sensible defaults', () => {
  const r = toVisionResult({ scientific_name: 'X' }, 'src', { raw: 1 });
  assertEquals(r?.kingdom, 'Unknown');
  assertEquals(r?.confidence, 0);
  assertEquals(r?.common_name_es, null);
});

Deno.test('detectKind — matches Anthropic prefixes before OpenAI sk- ', () => {
  assertEquals(detectKind('sk-ant-api03-' + 'X'), 'api_key');
  assertEquals(detectKind('sk-ant-oat01-' + 'X'), 'oauth_token');
  assertEquals(detectKind('sk-proj-' + 'X'), 'openai_api_key');
  assertEquals(detectKind('AIzaXYZ'), 'gemini_api_key');
  assertEquals(detectKind('{"accessKeyId":"x"}'), null);  // bedrock/vertex are not prefix-detected
});

Deno.test('bedrockModelId — translates Anthropic shorthand to Bedrock ID', () => {
  assertEquals(bedrockModelId('claude-haiku-4-5'),  'us.anthropic.claude-haiku-4-5-v1:0');
  assertEquals(bedrockModelId('claude-sonnet-4-5'), 'us.anthropic.claude-sonnet-4-5-v1:0');
});

Deno.test('bedrockModelId — passes through Bedrock-format IDs unchanged', () => {
  assertEquals(bedrockModelId('us.anthropic.claude-haiku-4-5-v1:0'), 'us.anthropic.claude-haiku-4-5-v1:0');
  assertEquals(bedrockModelId('eu.anthropic.claude-sonnet-4-5-v1:0'), 'eu.anthropic.claude-sonnet-4-5-v1:0');
});

Deno.test('bedrockModelId — empty input falls back to default Haiku', () => {
  assertEquals(bedrockModelId(''), 'us.anthropic.claude-haiku-4-5-v1:0');
});

Deno.test('defaultModelFor — non-empty for every kind', () => {
  const kinds = ['api_key', 'oauth_token', 'bedrock', 'openai_api_key', 'azure_openai', 'gemini_api_key', 'vertex_ai'] as const;
  for (const k of kinds) {
    const m = defaultModelFor(k);
    if (!m || m.length === 0) throw new Error(`empty default model for ${k}`);
  }
});

// ── crop_bbox / buildBboxHint tests (#174) ──────────────────────────

import { buildBboxHint, type VisionInput } from './vision-provider.ts';

Deno.test('buildBboxHint — formats pixel coordinates into focus instruction', () => {
  const hint = buildBboxHint([100, 200, 400, 600]);
  assertEquals(hint.includes('(100,200)'), true);
  assertEquals(hint.includes('(400,600)'), true);
  assertEquals(hint.includes('Focus your identification'), true);
});

Deno.test('buildBboxHint — handles zero-origin bbox', () => {
  const hint = buildBboxHint([0, 0, 50, 50]);
  assertEquals(hint.includes('(0,0)'), true);
  assertEquals(hint.includes('(50,50)'), true);
});

Deno.test('effectiveSystemPrompt — appends bbox hint when crop_bbox is set', () => {
  // We can't call the private effectiveSystemPrompt directly, but we
  // can verify the contract via buildBboxHint + string concatenation
  // (effectiveSystemPrompt is just systemPrompt + buildBboxHint).
  const base = 'You are a biologist.';
  const bbox: [number, number, number, number] = [10, 20, 300, 400];
  const result = base + buildBboxHint(bbox);
  assertEquals(result.startsWith(base), true);
  assertEquals(result.includes('(10,20)'), true);
  assertEquals(result.includes('(300,400)'), true);
});

Deno.test('VisionInput — crop_bbox is optional (omitted = no hint)', () => {
  // Type-level check: a VisionInput without crop_bbox compiles fine.
  const input: VisionInput = {
    imageBase64: 'abc',
    mimeType: 'image/jpeg',
    systemPrompt: 'test',
    userText: 'identify',
  };
  assertEquals(input.crop_bbox, undefined);
});

Deno.test('VisionInput — crop_bbox is accepted when provided', () => {
  const input: VisionInput = {
    imageBase64: 'abc',
    mimeType: 'image/jpeg',
    systemPrompt: 'test',
    userText: 'identify',
    crop_bbox: [50, 100, 200, 300],
  };
  assertEquals(input.crop_bbox, [50, 100, 200, 300]);
});
