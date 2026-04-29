// Single source of truth for the option arrays + bilingual labels shared
// between the create form (ObservationForm.astro) and the obs detail
// Manage panel (ObsManagePanel.astro). Edit only here; the consumers
// import.

export const HABITATS = [
  'forest_pine_oak','forest_oak','forest_pine',
  'tropical_evergreen','tropical_subevergreen',
  'cloud_forest','tropical_dry_forest',
  'xerophytic','scrubland',
  'riparian','wetland','grassland',
  'agricultural','urban','coastal','reef','cave',
] as const;
export type Habitat = (typeof HABITATS)[number];

export const WEATHERS = [
  'sunny','cloudy','overcast','light_rain','heavy_rain','fog','storm',
] as const;
export type Weather = (typeof WEATHERS)[number];

export const ESTABLISHMENT_MEANS = [
  'wild','cultivated','captive','uncertain',
] as const;
export type EstablishmentMeans = (typeof ESTABLISHMENT_MEANS)[number];

/** Pull the bilingual label for a given key family. The label tree
 *  lives in i18n; this is just a typed accessor so consumers don't need
 *  the awful inline `Record<…>` cast that breaks Astro JSX. */
export function labelFor(
  tree: unknown,
  family: 'habitat_options' | 'weather_options' | 'establishment_means_options',
  key: string,
): string {
  if (tree && typeof tree === 'object') {
    const fam = (tree as Record<string, unknown>)[family];
    if (fam && typeof fam === 'object') {
      const v = (fam as Record<string, unknown>)[key];
      if (typeof v === 'string') return v;
    }
  }
  return key.replace(/_/g, ' ');
}
