/**
 * Pure helpers for the WebLLM text features (translate, auto-narrative,
 * chat). Kept side-effect free so they can be unit-tested without spinning
 * up an MLC engine. The actual inference lives in `local-ai.ts`.
 */

export type Locale = 'en' | 'es';

/** Detect EN/ES from the document, with a hard fallback to English. */
export function detectLocaleFromDoc(doc: Document | null | undefined = typeof document !== 'undefined' ? document : null): Locale {
  const raw = (doc?.documentElement?.lang ?? 'en').toLowerCase();
  return raw.startsWith('es') ? 'es' : 'en';
}

/** The opposite locale — used by the Translate button to flip languages. */
export function flipLocale(l: Locale): Locale {
  return l === 'en' ? 'es' : 'en';
}

/** Human-readable language name for the prompt. */
export function languageName(l: Locale): string {
  return l === 'es' ? 'Spanish' : 'English';
}

/**
 * Builds the translation prompt. Latin species names are preserved verbatim
 * because translating them would break Darwin Core export downstream.
 */
export function buildTranslatePrompt(source: Locale, target: Locale): string {
  return [
    `Translate the following observation note from ${languageName(source)} to ${languageName(target)}.`,
    'Keep species names in their original Latin form.',
    'Return only the translation, no preamble.',
  ].join(' ');
}

/** Inputs the auto-narrative button collects from the form. */
export interface NarrativeFields {
  species_guess?: string | null;
  location_obscured?: string | null;
  location_raw?: { lat: number; lng: number } | null;
  time?: string | null;
  behavior_tags?: string[] | null;
  count?: number | null;
  habitat?: string | null;
  weather?: string | null;
  evidence_type?: string | null;
}

/** Drops null/undefined/empty fields so the model isn't asked to invent context. */
export function compactFields(fields: NarrativeFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Builds the auto-narrative prompt. */
export function buildNarrativePrompt(locale: Locale, fields: NarrativeFields): string {
  const json = JSON.stringify(compactFields(fields));
  const lang = languageName(locale);
  return [
    'You are a field naturalist.',
    `Write a 1–2 sentence observation note in ${lang} based on the following structured data: ${json}.`,
    'Be specific and factual. Do not invent details not present.',
  ].join(' ');
}

/** System prompt for the general chat page. Held in code so it stays in sync with i18n strings. */
export const CHAT_SYSTEM_PROMPT =
  'You are a helpful biodiversity assistant for Rastrum. Answer concisely. ' +
  'The user may ask in English or Spanish — reply in whichever language they used.';

/** Detects iOS Safari for the PWA install fallback. */
export function isIOS(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  if (!ua) return false;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ identifies as Mac with touch points.
  if (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

/** True when the user agent is Firefox (any platform). */
export function isFirefox(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  // Firefox identifies as "Firefox/<ver>"; Gecko-based forks also match.
  // Excludes Edge (which used to ship "FxiOS" on iOS — Apple still
  // forces WebKit, so iOS Firefox can't install PWAs anyway).
  return /Firefox\/|FxiOS\//.test(ua);
}

/** True when running on an Android device. */
export function isAndroid(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Android/.test(ua);
}

/** True when the page is running as an installed PWA (display-mode standalone). */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // Safari iOS exposes navigator.standalone.
  const navStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return navStandalone === true;
}

/**
 * True when the navigation came from an Android app intent
 * (e.g. the user tapped a link inside the installed Rastrum PWA on
 * Android Chrome and landed back in a browser tab). This is a strong
 * signal the PWA is installed even when display-mode is 'browser' and
 * `getInstalledRelatedApps()` hasn't yet populated.
 */
export function isFromAndroidIntent(referrer: string = typeof document !== 'undefined' ? document.referrer : ''): boolean {
  return typeof referrer === 'string' && referrer.startsWith('android-app://');
}

const PWA_INSTALLED_KEY = 'rastrum.pwaInstalled';

/**
 * True when we have any signal that the PWA has been installed on this
 * device — combines:
 *   1. display-mode: standalone (we're running INSIDE the installed app)
 *   2. localStorage memo (set on the `appinstalled` event last time)
 *   3. navigator.getInstalledRelatedApps() (Chrome only; needs
 *      manifest related_applications) — async, so not used here; the
 *      `markInstalledIfRelatedAppsKnown()` helper polls it on first
 *      load and writes the localStorage memo for subsequent visits.
 *
 * This catches the "user installed yesterday, today opens
 * rastrum.org in a regular Chrome tab" case where display-mode is
 * 'browser' but the app IS installed — without this, the banner
 * re-appears in browser-tab context.
 */
export function isPwaInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandaloneDisplayMode()) return true;
  if (isFromAndroidIntent()) {
    markPwaInstalled();
    return true;
  }
  try { return localStorage.getItem(PWA_INSTALLED_KEY) === 'true'; }
  catch { return false; }
}

/** Persist the "installed on this device" memo. Idempotent. */
export function markPwaInstalled(): void {
  try { localStorage.setItem(PWA_INSTALLED_KEY, 'true'); } catch { /* full storage */ }
}

/**
 * Async probe via Chrome's `getInstalledRelatedApps()`. When it
 * confirms our PWA is installed, write the localStorage memo so
 * subsequent loads short-circuit synchronously via `isPwaInstalled()`.
 * Safe no-op on browsers that don't support the API.
 */
export async function markInstalledIfRelatedAppsKnown(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform: string; url?: string; id?: string }>>;
  };
  if (typeof nav.getInstalledRelatedApps !== 'function') return;
  try {
    const apps = await nav.getInstalledRelatedApps();
    if (apps.length > 0) markPwaInstalled();
  } catch { /* permissions or feature gated — ignore */ }
}
