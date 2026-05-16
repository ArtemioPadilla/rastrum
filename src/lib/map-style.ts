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

/**
 * Minimal shape of the MapLibre `Map` methods this module touches.
 * Avoids importing maplibre-gl's types into a unit-testable module.
 */
interface SpriteFallbackMap {
  on(type: 'styleimagemissing', listener: (e: { id: string }) => void): unknown;
  hasImage(id: string): boolean;
  addImage(
    id: string,
    image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  ): void;
}

/**
 * #1113 — the hosted OpenFreeMap `liberty` / `dark` styles ship a `sprite`
 * URL and POI symbol layers that reference Maki icons (`circle-11`, …).
 * When that external sprite is slow or fails to load (first paint can take
 * ~10 s) MapLibre raises a `styleimagemissing` event and logs a noisy
 * console warning for every missing icon. We don't control that sprite, so
 * the idiomatic fix is to register a 1×1 transparent fallback for any icon
 * the style asks for that isn't present. Our own observation layers are
 * `circle`-type paint layers and never hit this path — this only silences
 * the basemap's POI-icon warnings while keeping markers rendering.
 *
 * Idempotent: skips ids already registered (e.g. once the real sprite
 * eventually loads, MapLibre won't ask again, but a re-fire is harmless).
 */
export function installSpriteFallback(map: SpriteFallbackMap): void {
  map.on('styleimagemissing', (e) => {
    const id = e?.id;
    if (!id || map.hasImage(id)) return;
    map.addImage(id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  });
}
