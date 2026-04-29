import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { pickAuthHeader, pickThreshold } from './sponsorship.ts';

Deno.test('pickAuthHeader: api_key uses x-api-key', () => {
  const fixture = 'sk-ant-api03-' + 'TEST_FIXTURE_NOT_A_REAL_SECRET';
  const h = pickAuthHeader('api_key', fixture) as Record<string, string>;
  assertEquals(h['x-api-key'], fixture);
  assertEquals(h['Authorization'], undefined);
});

Deno.test('pickAuthHeader: oauth_token uses Bearer', () => {
  const fixture = 'sk-ant-oat01-' + 'TEST_FIXTURE_NOT_A_REAL_SECRET';
  const h = pickAuthHeader('oauth_token', fixture) as Record<string, string>;
  assertEquals(h['Authorization'], 'Bearer ' + fixture);
  assertEquals(h['x-api-key'], undefined);
});

Deno.test('pickAuthHeader: includes anthropic-version', () => {
  const h = pickAuthHeader('api_key', 'x') as Record<string, string>;
  assertEquals(h['anthropic-version'], '2023-06-01');
});

Deno.test('pickThreshold: under 0.80 → null', () => {
  assertEquals(pickThreshold(0), null);
  assertEquals(pickThreshold(0.5), null);
  assertEquals(pickThreshold(0.79), null);
});

Deno.test('pickThreshold: 0.80–0.99 → 80', () => {
  assertEquals(pickThreshold(0.80), 80);
  assertEquals(pickThreshold(0.85), 80);
  assertEquals(pickThreshold(0.99), 80);
});

Deno.test('pickThreshold: ≥ 1.0 → 100', () => {
  assertEquals(pickThreshold(1.00), 100);
  assertEquals(pickThreshold(1.50), 100);
});
