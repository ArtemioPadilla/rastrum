import { describe, expect, it } from 'vitest';
import {
  assertValidModel,
  VALID_MODELS,
  SKIP_MODEL_VALIDATION,
  bedrockModelId,
  type CredentialKind,
} from '../../supabase/functions/_shared/vision-provider';

// #669 — `preferred_model` was a free-text column; a typo or invalid id
// got persisted and only failed later at `consume_pool_slot()` /
// `buildProvider()`. `assertValidModel()` lifts the source-of-truth from
// the dispatcher into a const map so EF handlers can reject at the
// boundary with a 400 + the accepted list. These tests pin the
// per-provider accepted ids — adding a new provider model means
// extending VALID_MODELS *and* this suite.

describe('assertValidModel — accepted ids per provider', () => {
  it.each<[CredentialKind, string]>([
    ['api_key',         'claude-haiku-4-5'],
    ['api_key',         'claude-sonnet-4-6'],
    ['api_key',         'claude-opus-4-5'],
    ['oauth_token',     'claude-haiku-4-5'],
    ['oauth_token',     'claude-sonnet-4-5'],
    ['bedrock',         'claude-haiku-4-5'],
    ['bedrock',         'claude-sonnet-4-5'],
    ['bedrock',         'amazon.titan-text-express-v1'],
    ['openai_api_key',  'gpt-4o'],
    ['openai_api_key',  'gpt-4o-mini'],
    ['openai_api_key',  'gpt-5.4-mini'],
    ['gemini_api_key',  'gemini-2.0-flash'],
    ['gemini_api_key',  'gemini-1.5-pro'],
  ])('accepts %s / %s', (kind, model) => {
    expect(() => assertValidModel(kind, model)).not.toThrow();
  });
});

describe('assertValidModel — rejection shape', () => {
  it('rejects an invalid api_key model with helpful error', () => {
    expect.assertions(2);
    try {
      assertValidModel('api_key', 'not-a-real-model');
    } catch (e) {
      expect((e as Error).message).toContain('invalid_model');
      expect((e as Error & { valid?: string[] }).valid).toContain('claude-haiku-4-5');
    }
  });

  it('rejects an invalid bedrock model that is not pre-prefixed', () => {
    expect(() => assertValidModel('bedrock', 'gpt-4o')).toThrow(/invalid_model/);
  });

  it('rejects an invalid gemini model', () => {
    expect(() => assertValidModel('gemini_api_key', 'gemini-7.0-fictional')).toThrow(/invalid_model/);
  });

  it('attaches the valid list to the thrown error for the EF handler to echo', () => {
    expect.assertions(2);
    try {
      assertValidModel('openai_api_key', 'wrong');
    } catch (e) {
      const valid = (e as Error & { valid?: readonly string[] }).valid;
      expect(Array.isArray(valid)).toBe(true);
      expect(valid).toEqual(VALID_MODELS.openai_api_key);
    }
  });
});

describe('assertValidModel — null + empty are accepted (provider defaults apply)', () => {
  it('accepts null', () => {
    expect(() => assertValidModel('api_key', null)).not.toThrow();
  });
  it('accepts undefined', () => {
    expect(() => assertValidModel('bedrock', undefined)).not.toThrow();
  });
  it('accepts empty string', () => {
    expect(() => assertValidModel('gemini_api_key', '')).not.toThrow();
  });
});

describe('assertValidModel — bedrock pre-prefixed ids pass through', () => {
  // bedrockModelId() auto-translates the Anthropic shorthand. A
  // pre-prefixed regional id like `us.anthropic.claude-haiku-4-5-v1:0`
  // (or any string containing `:`) must NOT be rejected — operators
  // who paste the full Bedrock model id should be honoured.
  it('accepts a regional-prefixed id', () => {
    expect(() => assertValidModel('bedrock', 'us.anthropic.claude-haiku-4-5-v1:0')).not.toThrow();
  });
  it('accepts a Bedrock-style id with a colon', () => {
    expect(() => assertValidModel('bedrock', 'anthropic.claude-3-haiku-20240307-v1:0')).not.toThrow();
  });
  it('accepts an EU-prefixed id', () => {
    expect(() => assertValidModel('bedrock', 'eu.anthropic.claude-sonnet-4-5-v1:0')).not.toThrow();
  });
});

describe('assertValidModel — providers with intentionally-skipped validation', () => {
  // Azure deployment names are operator-defined; Vertex AI takes a
  // resource path. There is no authoritative list at the platform
  // level for either, so the EF stores whatever the operator sends.
  it('SKIP_MODEL_VALIDATION includes azure_openai and vertex_ai', () => {
    expect(SKIP_MODEL_VALIDATION.has('azure_openai')).toBe(true);
    expect(SKIP_MODEL_VALIDATION.has('vertex_ai')).toBe(true);
  });
  it('accepts any string for azure_openai', () => {
    expect(() => assertValidModel('azure_openai', 'my-custom-deployment-alias')).not.toThrow();
  });
  it('accepts any string for vertex_ai', () => {
    expect(() => assertValidModel('vertex_ai', 'projects/foo/locations/us-central1/publishers/google/models/gemini-bar')).not.toThrow();
  });
});

describe('bedrockModelId — translation map (regression guard)', () => {
  // Pinned because the bedrock VALID_MODELS list above includes
  // shorthand ids that bedrockModelId() must auto-translate. If the
  // map drifts, a sponsor that submitted `claude-haiku-4-5` would
  // pass validation but fail at invoke time.
  it('translates known Anthropic shorthand to Bedrock regional ids', () => {
    expect(bedrockModelId('claude-haiku-4-5')).toBe('us.anthropic.claude-haiku-4-5-v1:0');
    expect(bedrockModelId('claude-sonnet-4-5')).toBe('us.anthropic.claude-sonnet-4-5-v1:0');
  });
  it('passes pre-prefixed ids through unchanged', () => {
    expect(bedrockModelId('us.anthropic.claude-opus-4-v1:0')).toBe('us.anthropic.claude-opus-4-v1:0');
  });
});
