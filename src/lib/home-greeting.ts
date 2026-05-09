/**
 * Pure helpers for the home page greeting widget. No DOM, no DB — fully
 * unit-testable.
 */

export type GreetingBucket = 'madrugada' | 'morning' | 'afternoon' | 'evening';
export type Lang = 'en' | 'es';

/**
 * Hour-of-day → greeting bucket. Buckets follow the Spanish convention
 * because greetings are first-class in Spanish (Buenos días vs buenas tardes).
 *
 *   00:00–05:59 madrugada (late night)
 *   06:00–11:59 morning   (Buenos días / Good morning)
 *   12:00–18:59 afternoon (Buenas tardes / Good afternoon)
 *   19:00–23:59 evening   (Buenas noches / Good evening)
 */
export function bucketForHour(hour: number): GreetingBucket {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h < 6) return 'madrugada';
  if (h < 12) return 'morning';
  if (h < 19) return 'afternoon';
  return 'evening';
}

const PHRASES: Record<Lang, Record<GreetingBucket, string>> = {
  en: {
    madrugada: 'Up late',
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
  },
  es: {
    madrugada: 'Buenas madrugadas',
    morning: 'Buenos días',
    afternoon: 'Buenas tardes',
    evening: 'Buenas noches',
  },
};

/**
 * Build "Good morning, Maria" / "Buenos días, Maria". When the display name
 * is empty, returns the greeting alone (no comma). Optional weather appends
 * a localized condition phrase when kind and region are provided.
 */
export function buildGreeting(
  hour: number,
  lang: Lang,
  displayName: string | null | undefined,
  weather?: { kind: string | null; region?: string | null }
): string {
  const bucket = bucketForHour(hour);
  const phrase = PHRASES[lang][bucket];
  const name = (displayName ?? '').trim();
  return name ? `${phrase}, ${name}` : phrase;
}
