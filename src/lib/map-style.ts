/**
 * Shared online basemap style for every MapLibre surface (ExploreMap,
 * MapPicker / share-obs, CommunityMapView).
 *
 * #1081: ExploreMap was theme-aware (OpenFreeMap `dark` in dark mode,
 * `liberty` in light) while MapPicker and CommunityMapView were hardcoded
 * to `liberty` — so in dark mode the explore map was dark but the
 * community / share maps stayed bright white. Centralising the choice
 * here keeps the three surfaces consistent and prevents future drift.
 *
 * ExploreMap's offline PMTiles archive path is intentionally separate and
 * is not affected by this helper.
 */

const STREET_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STREET_DARK = 'https://tiles.openfreemap.org/styles/dark';

/** True when the document is in dark mode (mirrors ExploreMap's check). */
export function isDarkTheme(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark');
}

/**
 * The OpenFreeMap vector style URL matching the current theme. Pass an
 * explicit `dark` to override the DOM check (e.g. in tests).
 */
export function basemapStyleUrl(dark: boolean = isDarkTheme()): string {
  return dark ? STREET_DARK : STREET_LIGHT;
}
