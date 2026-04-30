/**
 * Shared Open Graph card layout — used by both the build-time PNG
 * generator (`scripts/generate-og.ts`) and the client-side observation
 * renderer (`src/lib/og-card.ts`). Returns a satori-compatible React
 * element tree.
 *
 * Why share: the visual must stay in lockstep across the two render
 * paths. Edit here once → both paths produce identical cards.
 *
 * Output target: 1200×630, the universal social-card aspect (Twitter
 * `summary_large_image`, Facebook OG, LinkedIn).
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type StaticCardInput = {
  kind: 'static';
  title: string;
  subtitle?: string;
  /** One-word section accent — emerald (default), teal, sky, stone, orange, amber, slate. */
  accent?: 'emerald' | 'teal' | 'sky' | 'stone' | 'orange' | 'amber' | 'slate';
};

export type ObservationCardInput = {
  kind: 'observation';
  /** Italic primary line, e.g. "Quercus oleoides" */
  scientificName: string;
  /** Optional human-readable line, e.g. "Encino blanco" */
  commonName?: string | null;
  /** ISO date string */
  observedAt?: string | null;
  /** "Oaxaca · Bosque seco" composed by caller */
  meta?: string | null;
  /** Public photo URL (already R2-hosted). Embedded as <img>. */
  photoUrl?: string | null;
  /** "@username" or display name */
  observer?: string | null;
};

export type ProfileCardInput = {
  kind: 'profile';
  displayName: string;
  username?: string | null;
  observationsCount?: number;
  speciesCount?: number;
  region?: string | null;
};

export type OgInput = StaticCardInput | ObservationCardInput | ProfileCardInput;

const ACCENT = {
  emerald: { fg: '#10b981', dark: '#064e3b' },
  teal:    { fg: '#14b8a6', dark: '#134e4a' },
  sky:     { fg: '#0ea5e9', dark: '#0c4a6e' },
  stone:   { fg: '#a8a29e', dark: '#1c1917' },
  orange:  { fg: '#f97316', dark: '#7c2d12' },
  amber:   { fg: '#f59e0b', dark: '#78350f' },
  slate:   { fg: '#64748b', dark: '#0f172a' },
} as const;

/** Brand mark — vector SVG inlined so satori can render without an extra fetch. */
const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='80' height='80'><circle cx='12' cy='12' r='11' fill='#10b981'/><text x='12' y='17' text-anchor='middle' font-family='system-ui' font-size='14' font-weight='800' fill='white'>R</text></svg>`;

function brandStripe(accent: keyof typeof ACCENT) {
  const c = ACCENT[accent];
  return {
    type: 'div' as const,
    props: {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 8,
        background: `linear-gradient(90deg, ${c.fg} 0%, ${c.dark} 100%)`,
      },
    },
  };
}

function rastrumWordmark() {
  return {
    type: 'div' as const,
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'absolute',
        bottom: 40,
        left: 56,
        color: '#10b981',
        fontFamily: 'DM Sans',
        fontWeight: 700,
        fontSize: 32,
        letterSpacing: '0.02em',
      },
      children: [
        {
          type: 'img' as const,
          props: {
            src: `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_SVG)}`,
            width: 56,
            height: 56,
          },
        },
        { type: 'span' as const, props: { children: 'Rastrum' } },
      ],
    },
  };
}

function staticCard(input: StaticCardInput) {
  const accent = input.accent ?? 'emerald';
  return {
    type: 'div' as const,
    props: {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 80px',
        background: '#0a0e0d',
        color: '#e6f1ec',
        fontFamily: 'DM Sans',
        position: 'relative',
      },
      children: [
        brandStripe(accent),
        {
          type: 'div' as const,
          props: {
            style: { fontSize: 72, fontWeight: 700, lineHeight: 1.1, marginBottom: 16, color: ACCENT[accent].fg },
            children: input.title,
          },
        },
        input.subtitle && {
          type: 'div' as const,
          props: {
            style: { fontSize: 32, fontWeight: 400, color: '#a7c3b6', maxWidth: 1000, lineHeight: 1.3 },
            children: input.subtitle,
          },
        },
        rastrumWordmark(),
      ].filter(Boolean),
    },
  };
}

function observationCard(input: ObservationCardInput) {
  return {
    type: 'div' as const,
    props: {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: 'flex',
        flexDirection: 'row',
        background: '#0a0e0d',
        color: '#e6f1ec',
        fontFamily: 'DM Sans',
        position: 'relative',
      },
      children: [
        brandStripe('emerald'),
        // Photo half (left) — falls back to a solid block if no URL.
        {
          type: 'div' as const,
          props: {
            style: {
              display: 'flex',
              width: 540,
              height: OG_HEIGHT,
              background: '#06241b',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            },
            children: input.photoUrl
              ? [{
                  type: 'img' as const,
                  props: {
                    src: input.photoUrl,
                    style: { width: 540, height: OG_HEIGHT, objectFit: 'cover' },
                  },
                }]
              : [{
                  type: 'div' as const,
                  props: {
                    style: { fontSize: 96, color: '#10b981', fontWeight: 700 },
                    children: '🌿',
                  },
                }],
          },
        },
        // Text half (right)
        {
          type: 'div' as const,
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              padding: '60px 56px',
              flex: 1,
              justifyContent: 'center',
              gap: 12,
            },
            children: [
              {
                type: 'div' as const,
                props: {
                  style: { fontSize: 22, color: '#a7c3b6', textTransform: 'uppercase', letterSpacing: '0.2em' },
                  children: 'Observación',
                },
              },
              {
                type: 'div' as const,
                props: {
                  style: { fontSize: 56, fontWeight: 700, fontStyle: 'italic', color: '#10b981', lineHeight: 1.1 },
                  children: input.scientificName || 'Especie sin identificar',
                },
              },
              input.commonName && {
                type: 'div' as const,
                props: {
                  style: { fontSize: 28, color: '#e6f1ec' },
                  children: input.commonName,
                },
              },
              input.meta && {
                type: 'div' as const,
                props: {
                  style: { fontSize: 22, color: '#7a9889', marginTop: 12 },
                  children: input.meta,
                },
              },
              input.observer && {
                type: 'div' as const,
                props: {
                  style: { fontSize: 22, color: '#7a9889' },
                  children: `por ${input.observer}`,
                },
              },
            ].filter(Boolean),
          },
        },
        rastrumWordmark(),
      ],
    },
  };
}

function profileCard(input: ProfileCardInput) {
  return {
    type: 'div' as const,
    props: {
      style: {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 80px',
        background: '#0a0e0d',
        color: '#e6f1ec',
        fontFamily: 'DM Sans',
        position: 'relative',
      },
      children: [
        brandStripe('emerald'),
        {
          type: 'div' as const,
          props: {
            style: { fontSize: 24, color: '#a7c3b6', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 8 },
            children: 'Observador en Rastrum',
          },
        },
        {
          type: 'div' as const,
          props: {
            style: { fontSize: 80, fontWeight: 700, color: '#10b981', lineHeight: 1.1, marginBottom: 12 },
            children: input.displayName,
          },
        },
        input.username && {
          type: 'div' as const,
          props: {
            style: { fontSize: 28, color: '#a7c3b6', marginBottom: 32 },
            children: `@${input.username}`,
          },
        },
        {
          type: 'div' as const,
          props: {
            style: { display: 'flex', flexDirection: 'row', gap: 56, marginTop: 24 },
            children: [
              input.observationsCount !== undefined && statBlock(String(input.observationsCount), 'observaciones'),
              input.speciesCount !== undefined && statBlock(String(input.speciesCount), 'especies'),
              input.region && statBlock(input.region, 'región'),
            ].filter(Boolean),
          },
        },
        rastrumWordmark(),
      ].filter(Boolean),
    },
  };
}

function statBlock(value: string, label: string) {
  return {
    type: 'div' as const,
    props: {
      style: { display: 'flex', flexDirection: 'column' },
      children: [
        { type: 'div' as const, props: { style: { fontSize: 56, fontWeight: 700, color: '#e6f1ec' }, children: value } },
        { type: 'div' as const, props: { style: { fontSize: 20, color: '#7a9889', textTransform: 'uppercase', letterSpacing: '0.15em' }, children: label } },
      ],
    },
  };
}

/** Single entry point — returns the satori React-element tree for any card kind. */
export function buildOgTree(input: OgInput) {
  if (input.kind === 'static')      return staticCard(input);
  if (input.kind === 'observation') return observationCard(input);
  return profileCard(input);
}
