/**
 * Pure helper for the OnboardingTour first_observation_demo step.
 *
 * Picks a regional sample species for the cascade demo so observers from
 * Latin America don't see Quercus robur (an European oak) as their first
 * impression. Detection is from `navigator.language` / `Intl.Locale().region`
 * — explicitly NOT from the Geolocation API (would require a permission
 * prompt on first visit, hostile UX).
 *
 * Returns null when no override is appropriate; the caller falls back to
 * the i18n-provided default. Locale-specific picks are scoped per language
 * so an `en-MX` user still gets an English common name.
 */

export type DemoSpecies = {
  scientific: string;
  common: string;
};

const ES_BY_REGION: Record<string, DemoSpecies> = {
  MX: { scientific: 'Crotophaga sulcirostris', common: 'Garrapatero pijuy' },
  CO: { scientific: 'Tangara cyanicollis', common: 'Tángara real' },
  PE: { scientific: 'Vultur gryphus', common: 'Cóndor andino' },
  AR: { scientific: 'Megaceryle torquata', common: 'Martín pescador grande' },
  CL: { scientific: 'Vultur gryphus', common: 'Cóndor andino' },
};

const EN_BY_REGION: Record<string, DemoSpecies> = {
  US: { scientific: 'Cardinalis cardinalis', common: 'Northern Cardinal' },
  CA: { scientific: 'Cardinalis cardinalis', common: 'Northern Cardinal' },
  MX: { scientific: 'Crotophaga sulcirostris', common: 'Groove-billed Ani' },
};

const ES_DEFAULT: DemoSpecies = {
  scientific: 'Quercus rugosa',
  common: 'Encino',
};

const EN_DEFAULT: DemoSpecies = {
  scientific: 'Quercus robur',
  common: 'English Oak',
};

export function parseNavigatorLocale(raw: string | undefined | null): { lang: string; region: string | null } {
  if (!raw) return { lang: 'en', region: null };
  const tag = String(raw);
  try {
    // Modern Intl.Locale exposes region/language cleanly. Falls back below
    // when the runtime is too old or the tag is malformed.
    const loc = new Intl.Locale(tag);
    return {
      lang: (loc.language ?? 'en').toLowerCase(),
      region: loc.region ? loc.region.toUpperCase() : null,
    };
  } catch {
    // Best-effort manual parse for malformed tags like "es_MX" or "ES".
    const parts = tag.replace('_', '-').split('-');
    const lang = (parts[0] ?? 'en').toLowerCase();
    const region = parts[1] ? parts[1].toUpperCase() : null;
    return { lang, region };
  }
}

export function pickDemoSpecies(
  navigatorLanguage: string | undefined | null,
  fallback?: { scientific: string; common: string } | null,
): DemoSpecies {
  const { lang, region } = parseNavigatorLocale(navigatorLanguage);
  if (lang === 'es') {
    if (region && ES_BY_REGION[region]) return ES_BY_REGION[region];
    return fallback?.scientific && fallback?.common
      ? { scientific: fallback.scientific, common: fallback.common }
      : ES_DEFAULT;
  }
  if (lang === 'en') {
    if (region && EN_BY_REGION[region]) return EN_BY_REGION[region];
    return fallback?.scientific && fallback?.common
      ? { scientific: fallback.scientific, common: fallback.common }
      : EN_DEFAULT;
  }
  return fallback?.scientific && fallback?.common
    ? { scientific: fallback.scientific, common: fallback.common }
    : EN_DEFAULT;
}

export function formatDemoSpeciesLabel(s: DemoSpecies): string {
  return `${s.scientific} — ${s.common}`;
}
