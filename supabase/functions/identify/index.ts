/**
 * /functions/v1/identify — PlantNet → Claude Haiku cascade.
 *
 * See docs/specs/modules/01-photo-id.md for the cascade logic. This function
 * runs on Supabase Edge (Deno runtime). Invoke it from the PWA with a signed
 * media URL; this function re-fetches the image server-side so the client
 * never ships the Anthropic / PlantNet keys.
 *
 * Required env vars (set via `supabase secrets set`):
 *   ANTHROPIC_API_KEY       Claude Haiku 4.5 vision calls
 *   PLANTNET_API_KEY        PlantNet v2 API
 *   SUPABASE_SERVICE_ROLE_KEY  Write-path for identifications rows
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type IdentifyRequest = {
  observation_id: string;
  image_url: string;           // signed/public URL of the uploaded photo
  user_hint?: 'plant' | 'animal' | 'fungi' | 'unknown';
  location?: { lat: number; lng: number };
  /**
   * Bring-your-own keys keyed by provider name. The function uses each
   * key only for this single call; nothing is logged or persisted
   * server-side. Server env vars (ANTHROPIC_API_KEY, PLANTNET_API_KEY)
   * are the fallback when a client key isn't provided.
   *
   * Supported names today: 'anthropic', 'plantnet'.
   */
  client_keys?: Record<string, string>;
  /**
   * Legacy field — same effect as client_keys.anthropic. Kept for
   * backwards compat with older clients that haven't migrated yet.
   */
  client_anthropic_key?: string;
  /**
   * Force a specific provider — used by the client cascade engine when it
   * wants to call exactly one server-side identifier (skip the default
   * PlantNet → Claude waterfall). Values: 'plantnet' | 'claude_haiku'.
   */
  force_provider?: 'plantnet' | 'claude_haiku';
};

type IDResult = {
  scientific_name: string;
  common_name_es: string | null;
  common_name_en: string | null;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Chromista' | 'Bacteria' | 'Unknown';
  family: string | null;
  confidence: number;
  source: 'plantnet' | 'claude_haiku';
  raw: unknown;
};

const PLANTNET_THRESHOLD = 0.7;

async function fetchImageAsBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function callPlantNet(imageBytes: Uint8Array, clientKey?: string): Promise<IDResult | null> {
  const key = clientKey || Deno.env.get('PLANTNET_API_KEY');
  if (!key) return null;

  const form = new FormData();
  form.append('images', new Blob([imageBytes], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('organs', 'auto');

  const res = await fetch(
    `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&lang=es&nb-results=5`,
    { method: 'POST', body: form },
  );
  if (!res.ok) return null;
  const json = await res.json() as {
    results: Array<{
      score: number;
      species: {
        scientificNameWithoutAuthor: string;
        commonNames: string[];
        family: { scientificNameWithoutAuthor: string };
      };
    }>;
  };

  const top = json.results?.[0];
  if (!top) return null;

  return {
    scientific_name: top.species.scientificNameWithoutAuthor,
    common_name_es: top.species.commonNames?.[0] ?? null,
    common_name_en: null,
    kingdom: 'Plantae',
    family: top.species.family?.scientificNameWithoutAuthor ?? null,
    confidence: top.score,
    source: 'plantnet',
    raw: json,
  };
}

async function callClaudeHaiku(
  imageBytes: Uint8Array,
  mimeType: string,
  context: { lat?: number; lng?: number; plantnet_candidates?: string[]; client_key?: string },
): Promise<IDResult | null> {
  // Prefer the user-supplied key; fall back to server env var. Either path
  // routes through the same Anthropic SDK call, but server-set keys absorb
  // the cost while client-set keys are billed to the user's own account.
  const key = context.client_key || Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return null;

  // base64-encode the image
  let binary = '';
  for (let i = 0; i < imageBytes.length; i += 0x8000) {
    binary += String.fromCharCode(...imageBytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(binary);

  const systemPrompt = [
    'You are a field biologist assistant specializing in Mexican biodiversity.',
    'Identify the species in the photo. Respond ONLY with valid JSON matching the schema.',
    'If you cannot identify, set confidence to 0 and explain in notes.',
    'Focus on species found in Mexico, Central America, and the Caribbean.',
  ].join('\n');

  const userText = context.plantnet_candidates?.length
    ? `PlantNet suggests: ${context.plantnet_candidates.join(', ')}. Confirm or correct.`
    : (context.lat && context.lng)
      ? `Location: ${context.lat}, ${context.lng}. Identify this species.`
      : 'Identify this species.';

  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
        { type: 'text', text: userText + '\n\nRespond with JSON only: {"scientific_name": "", "common_name_es": "", "common_name_en": "", "family": "", "kingdom": "Plantae|Animalia|Fungi|Unknown", "confidence": 0.0, "nom_059_status": null, "notes": null, "alternative_species": []}' },
      ],
    }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;

  const json = await res.json() as { content: Array<{ type: string; text?: string }> };
  const textBlock = json.content?.find(c => c.type === 'text');
  if (!textBlock?.text) return null;

  // Strip any code fences Claude occasionally adds, then parse
  const cleaned = textBlock.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(cleaned) as {
    scientific_name: string;
    common_name_es: string | null;
    common_name_en: string | null;
    family: string | null;
    kingdom: IDResult['kingdom'];
    confidence: number;
  };

  return {
    scientific_name: parsed.scientific_name,
    common_name_es: parsed.common_name_es,
    common_name_en: parsed.common_name_en,
    kingdom: parsed.kingdom,
    family: parsed.family,
    confidence: parsed.confidence,
    source: 'claude_haiku',
    raw: json,
  };
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: IdentifyRequest;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.observation_id || !body.image_url) {
    return new Response('Missing observation_id or image_url', { status: 400 });
  }

  const imageBytes = await fetchImageAsBytes(body.image_url);
  const mimeType = 'image/jpeg';

  // Resolve BYO keys (new field wins; legacy field is the fallback)
  const byoPlantnet = body.client_keys?.plantnet;
  const byoAnthropic = body.client_keys?.anthropic ?? body.client_anthropic_key;

  let result: IDResult | null = null;

  if (body.force_provider === 'plantnet') {
    result = await callPlantNet(imageBytes, byoPlantnet);
  } else if (body.force_provider === 'claude_haiku') {
    result = await callClaudeHaiku(imageBytes, mimeType, {
      lat: body.location?.lat,
      lng: body.location?.lng,
      client_key: byoAnthropic,
    });
  } else {
    // Default cascade: PlantNet first if it's likely a plant, Claude otherwise
    const isPlant = body.user_hint === 'plant' || body.user_hint === 'fungi' || !body.user_hint;
    if (isPlant) {
      const pn = await callPlantNet(imageBytes, byoPlantnet);
      if (pn && pn.confidence >= PLANTNET_THRESHOLD) {
        result = pn;
      } else {
        result = await callClaudeHaiku(imageBytes, mimeType, {
          lat: body.location?.lat,
          lng: body.location?.lng,
          plantnet_candidates: pn ? [pn.scientific_name] : undefined,
          client_key: byoAnthropic,
        });
        if (!result && pn) result = pn;
      }
    } else {
      result = await callClaudeHaiku(imageBytes, mimeType, {
        lat: body.location?.lat,
        lng: body.location?.lng,
        client_key: byoAnthropic,
      });
    }
  }

  if (!result) {
    // Distinguish "no engine available" from "engine ran but failed" so the
    // client can route fallback paths (e.g. WebLLM Phi-3.5-vision opt-in).
    const hasAnyClaudeKey = !!(byoAnthropic || Deno.env.get('ANTHROPIC_API_KEY'));
    return new Response(JSON.stringify({
      error: hasAnyClaudeKey ? 'identification_failed' : 'no_id_engine_available',
      hint: hasAnyClaudeKey
        ? 'PlantNet returned nothing and Claude failed to parse the response.'
        : 'Configure ANTHROPIC_API_KEY (server) or supply client_anthropic_key, or enable on-device fallback.',
    }), {
      status: 200,   // not a server error — the call completed, just no ID landed
      headers: { 'content-type': 'application/json' },
    });
  }

  // Write identification back to the DB with service role.
  // Skip when the call was cascade-only (the client cascade engine handles
  // the DB write on its own after picking the best result across plugins).
  if (body.observation_id !== 'cascade-only') {
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (serviceRole && supabaseUrl) {
      const db = createClient(supabaseUrl, serviceRole);
      await db.from('identifications').insert({
        observation_id: body.observation_id,
        scientific_name: result.scientific_name,
        confidence: result.confidence,
        source: result.source,
        raw_response: result.raw as object,
        is_primary: true,
      });
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json' },
  });
});
