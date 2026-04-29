import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectKind } from './anthropic-validate.ts';

Deno.test('detectKind: API key prefix', () => {
  assertEquals(detectKind('sk-ant-api03-' + 'TEST_FIXTURE_NOT_A_REAL_SECRET'), 'api_key');
});

Deno.test('detectKind: OAT prefix', () => {
  assertEquals(detectKind('sk-ant-oat01-' + 'TEST_FIXTURE_NOT_A_REAL_SECRET'), 'oauth_token');
});

Deno.test('detectKind: unknown prefix → null', () => {
  assertEquals(detectKind('Bearer foo'), null);
});

Deno.test('detectKind: empty string → null', () => {
  assertEquals(detectKind(''), null);
});
