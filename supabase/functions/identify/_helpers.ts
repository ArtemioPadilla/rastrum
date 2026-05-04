/**
 * Pure helpers for the identify EF — extracted so Vitest (Node runtime)
 * can import them without resolving Deno URL specifiers in `index.ts`.
 */

/**
 * Unified gate for whether to attempt the PlantNet runner. Single source of
 * truth — both the cascade and default-race paths must agree, otherwise
 * identical input produces different runner sets depending on which client
 * path called the EF (#580).
 *
 * `unknown` is treated as plant-like since it's the safe default for users
 * who don't tag their photo. PlantNet returns nothing for animal photos
 * (no harm) but catches plant cases the user didn't classify.
 */
export function isPlantLikeHint(hint?: string): boolean {
  return !hint || hint === 'plant' || hint === 'fungi' || hint === 'unknown';
}
