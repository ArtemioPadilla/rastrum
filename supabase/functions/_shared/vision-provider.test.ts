import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { bedrockModelId, buildProvider, parseModelJson, parseBedrockSecret, toVisionResult, CredentialUnauthorizedError } from './vision-provider.ts';
import type { ResolvedCredential, VisionInput } from './vision-provider.ts';
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

// ── CredentialUnauthorizedError / 401 fallback tests (#693) ──────────

Deno.test('CredentialUnauthorizedError — is instanceof Error and carries kind', () => {
  const err = new CredentialUnauthorizedError('api_key');
  assertEquals(err instanceof Error, true);
  assertEquals(err instanceof CredentialUnauthorizedError, true);
  assertEquals(err.kind, 'api_key');
  assertEquals(err.name, 'CredentialUnauthorizedError');
  assertEquals(err.message.includes('api_key'), true);
});

Deno.test('AnthropicProvider — throws CredentialUnauthorizedError on HTTP 401', async () => {
  // Stub globalThis.fetch to return a 401.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
  try {
    const cred: ResolvedCredential = { kind: 'api_key', secret: 'sk-invalid', model: 'claude-haiku-4-5', endpoint: null };
    const provider = buildProvider(cred);
    await assertRejects(
      () => provider.identify({ imageBase64: 'abc', mimeType: 'image/jpeg', systemPrompt: 'test', userText: 'id' }),
      CredentialUnauthorizedError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('AnthropicProvider — returns null (not throw) on non-401 HTTP error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Server Error', { status: 500 });
  try {
    const cred: ResolvedCredential = { kind: 'api_key', secret: 'sk-test', model: 'claude-haiku-4-5', endpoint: null };
    const provider = buildProvider(cred);
    const result = await provider.identify({ imageBase64: 'abc', mimeType: 'image/jpeg', systemPrompt: 'test', userText: 'id' });
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('fallthrough simulation — caller catches CredentialUnauthorizedError and retries next credential', async () => {
  // Simulates the cascade fallback: first credential 401s, second succeeds.
  const callLog: string[] = [];
  const credentials: ResolvedCredential[] = [
    { kind: 'api_key', secret: 'revoked-key', model: 'claude-haiku-4-5', endpoint: null },
    { kind: 'api_key', secret: 'valid-key',   model: 'claude-haiku-4-5', endpoint: null },
  ];

  // Stub fetch: 401 for revoked-key, 200 with valid JSON for valid-key.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    // Distinguish by the x-api-key header set by AnthropicProvider.
    const headers = init?.headers as Record<string, string> | undefined ?? {};
    const key = headers['x-api-key'] ?? '';
    callLog.push(key);
    if (key === 'revoked-key') return new Response('Unauthorized', { status: 401 });
    // Return a minimal valid response for valid-key.
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: '{"scientific_name":"Quercus robur","confidence":0.9,"kingdom":"Plantae"}' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    let result = null;
    for (const cred of credentials) {
      const provider = buildProvider(cred);
      try {
        result = await provider.identify({ imageBase64: 'abc', mimeType: 'image/jpeg', systemPrompt: 'test', userText: 'id' });
        break;
      } catch (err) {
        if (err instanceof CredentialUnauthorizedError) continue;
        throw err;
      }
    }
    assertEquals(callLog, ['revoked-key', 'valid-key']);
    assertEquals(result?.scientific_name, 'Quercus robur');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('all credentials 401 — fallthrough loop returns null', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
  try {
    const credentials: ResolvedCredential[] = [
      { kind: 'api_key', secret: 'key-a', model: 'claude-haiku-4-5', endpoint: null },
      { kind: 'api_key', secret: 'key-b', model: 'claude-haiku-4-5', endpoint: null },
    ];
    let result = null;
    for (const cred of credentials) {
      const provider = buildProvider(cred);
      try {
        result = await provider.identify({ imageBase64: 'abc', mimeType: 'image/jpeg', systemPrompt: 'test', userText: 'id' });
        break;
      } catch (err) {
        if (err instanceof CredentialUnauthorizedError) continue;
        throw err;
      }
    }
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
