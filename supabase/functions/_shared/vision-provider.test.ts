import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildProvider, parseModelJson, parseBedrockSecret, toVisionResult } from './vision-provider.ts';
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

Deno.test('defaultModelFor — non-empty for every kind', () => {
  const kinds = ['api_key', 'oauth_token', 'bedrock', 'openai_api_key', 'azure_openai', 'gemini_api_key', 'vertex_ai'] as const;
  for (const k of kinds) {
    const m = defaultModelFor(k);
    if (!m || m.length === 0) throw new Error(`empty default model for ${k}`);
  }
});
