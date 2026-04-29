/**
 * Feature flags seed data. The canonical runtime source of truth is the
 * `public.app_feature_flags` DB table (added in PR8). This module is the
 * seed manifest — values here are inserted on first db-apply and preserved
 * on replay (ON CONFLICT DO UPDATE skips the `value` column so live toggles
 * survive schema replays). Do NOT read this module at runtime for flag state;
 * query `app_feature_flags` from the DB instead.
 */
export interface FeatureFlag {
  key: string;
  name: string;
  value: boolean;
  description: string;
  category: 'identification' | 'media' | 'social' | 'admin' | 'pwa';
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'parallelCascade',
    name: 'Parallel cascade ID',
    value: true,
    description: 'Run identifier plugins concurrently rather than sequentially. Reduces median latency at the cost of slightly higher API spend.',
    category: 'identification',
  },
  {
    key: 'megadetectorPreflight',
    name: 'MegaDetector preflight',
    value: false,
    description: 'Run MegaDetector before PlantNet / iNaturalist to skip photos with no detectable animal or plant. Reduces wasted API calls on blank or human-only photos.',
    category: 'identification',
  },
  {
    key: 'pushNotifications',
    name: 'Push notifications',
    value: false,
    description: 'Web Push (VAPID) for follows, badge awards, and validation outcomes. Requires a service-worker registration and user permission grant.',
    category: 'pwa',
  },
  {
    key: 'localAiIdentification',
    name: 'Local AI identification (WebLLM)',
    value: false,
    description: 'On-device Phi-3.5-vision identification via WebLLM. Downloads a ~2 GB model on first use. Off by default — gated on explicit user opt-in.',
    category: 'identification',
  },
  {
    key: 'darwinCoreExport',
    name: 'Darwin Core Archive export',
    value: true,
    description: 'Allow authenticated users to download their observations as a DwC-A ZIP via the export-dwca Edge Function.',
    category: 'admin',
  },
  {
    key: 'socialGraph',
    name: 'Social graph (follows / reactions)',
    value: true,
    description: 'Module 26 social surfaces: follow/unfollow, notification bell, reactions strip on observation cards.',
    category: 'social',
  },
  {
    key: 'bioblitzEvents',
    name: 'Bioblitz events UI',
    value: false,
    description: 'Public listing and participation UI for bioblitz events. Ships when the first organizer requests an event.',
    category: 'admin',
  },
];
