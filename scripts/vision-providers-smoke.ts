/**
 * Vision-providers end-to-end smoke probe (#158).
 *
 * For each provider whose secrets are present in env, calls
 * `validateCredential(kind, secret, opts)` against the real API and
 * prints PASS / FAIL on stdout. Exit code is set by the caller
 * workflow based on whether at least one provider passed.
 *
 * Run locally:
 *   ANTHROPIC_API_KEY=… deno run --allow-net --allow-env scripts/vision-providers-smoke.ts
 */

import { validateCredential } from '../supabase/functions/_shared/vision-validate.ts';
import type { CredentialKind } from '../supabase/functions/_shared/vision-provider.ts';

interface Probe {
  name: string;
  kind: CredentialKind;
  envKey: string;
  endpointEnvKey?: string;
  /** Optional model override; defaults via defaultModelFor() in the validator. */
  model?: string;
  /** Optional secret transformer (e.g. for Azure: pull from a different env). */
  resolveSecret?: (env: Record<string, string | undefined>) => string | null;
}

const probes: Probe[] = [
  { name: 'anthropic-direct (api_key)', kind: 'api_key',     envKey: 'ANTHROPIC_API_KEY' },
  { name: 'anthropic-direct (oat)',     kind: 'oauth_token', envKey: 'ANTHROPIC_OAT'     },
  { name: 'bedrock',                    kind: 'bedrock',     envKey: 'BEDROCK_JSON'      },
  { name: 'openai',                     kind: 'openai_api_key', envKey: 'OPENAI_API_KEY' },
  {
    name: 'azure-openai',
    kind: 'azure_openai',
    envKey: 'AZURE_OPENAI_KEY',
    endpointEnvKey: 'AZURE_OPENAI_ENDPOINT',
    resolveSecret: (env) => env['AZURE_OPENAI_KEY'] ?? null,
  },
  { name: 'gemini-direct',              kind: 'gemini_api_key', envKey: 'GEMINI_API_KEY' },
  { name: 'vertex-ai (sa-json)',        kind: 'vertex_ai',      envKey: 'VERTEX_SA_JSON' },
];

const env = Deno.env.toObject();
let anyPresent = false;

for (const p of probes) {
  const secret = (p.resolveSecret ? p.resolveSecret(env) : env[p.envKey]) ?? null;
  if (!secret) {
    console.log(`SKIP ${p.name} (env ${p.envKey} unset)`);
    continue;
  }
  anyPresent = true;
  const endpoint = p.endpointEnvKey ? env[p.endpointEnvKey] : undefined;
  try {
    const r = await validateCredential(p.kind, secret, { model: p.model, endpoint });
    if (r.valid) {
      console.log(`PASS ${p.name}`);
    } else {
      console.log(`FAIL ${p.name} (${r.error ?? 'unknown'})`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`FAIL ${p.name} (exception: ${msg})`);
  }
}

if (!anyPresent) {
  console.log('SKIP all (no provider secrets present in env)');
}
