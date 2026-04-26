/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_R2_MEDIA_URL?: string;
  readonly PUBLIC_R2_TILES_URL?: string;
  readonly PUBLIC_BIRDNET_WEIGHTS_URL?: string;
  readonly PUBLIC_ONNX_BASE_URL?: string;
  readonly PUBLIC_BUILD_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
