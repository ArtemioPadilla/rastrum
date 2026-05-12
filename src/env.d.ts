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
  // PUBLIC_PLANTNET_KEY removed — key is server-side only (Edge Function env var).
  // See fix/plantnet-key-cleanup PR.
  readonly PUBLIC_ANTHROPIC_KEY?: string;
  readonly PUBLIC_VAPID_PUBLIC_KEY?: string;
  readonly PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
  readonly PUBLIC_POSTHOG_HOST?: string;
  readonly PUBLIC_BUILD_SHA?: string;
  /**
   * App version string (year.month.N format, e.g. "2026.5.0").
   * Set from package.json in CI; falls back to "dev" locally.
   */
  readonly PUBLIC_VERSION?: string;
  /**
   * Stable per-deploy version string. Used as a CORS preflight cache
   * buster (sent as `x-rastrum-build` on `get-upload-url` calls). Set
   * in CI from the deploy SHA; falls back to today's ISO date when
   * unset (good enough for local dev).
   */
  readonly PUBLIC_BUILD_VERSION?: string;
  /**
   * Set to '1' to use the legacy SVG DAG pipeline graph instead of the
   * new linear PipelineStepper (PR4 of #942). Remove after 30 days without
   * incident reports.
   */
  /**
   * Set to '1' to use the legacy SVG DAG pipeline graph instead of the
   * new linear PipelineStepper (PR4 of #942). Remove after 30 days without
   * incident reports.
   *
   * ⚠️  This is a BUILD-TIME flag (Astro reads it at SSG/SSR build, not runtime).
   * Changing it requires a full redeploy — a hot env-var update is not enough.
   * To rollback without a code change, set the flag in your deployment env
   * (Cloudflare Pages / Firebase Hosting env vars) and trigger a redeploy.
   */
  readonly PUBLIC_OBSERVE_PIPELINE_GRAPH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface PostHog {
  __loaded?: boolean;
  capture(event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown, properties?: Record<string, unknown>): void;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  reset(): void;
}

interface Window {
  posthog?: PostHog;
}
