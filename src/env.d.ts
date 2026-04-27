/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_R2_MEDIA_URL?: string;
  readonly PUBLIC_R2_TILES_URL?: string;
  readonly PUBLIC_BIRDNET_WEIGHTS_URL?: string;
  readonly PUBLIC_ONNX_BASE_URL?: string;
  readonly PUBLIC_PMTILES_MX_URL?: string;
  readonly PUBLIC_MEGADETECTOR_ENDPOINT?: string;
  readonly PUBLIC_PLANTNET_KEY?: string;
  readonly PUBLIC_ANTHROPIC_KEY?: string;
  readonly PUBLIC_VAPID_PUBLIC_KEY?: string;
  readonly PUBLIC_BUILD_SHA?: string;
  /**
   * Stable per-deploy version string. Used as a CORS preflight cache
   * buster (sent as `x-rastrum-build` on `get-upload-url` calls). Set
   * in CI from the deploy SHA; falls back to today's ISO date when
   * unset (good enough for local dev).
   */
  readonly PUBLIC_BUILD_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
