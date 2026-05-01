/**
 * buildBugReportUrl — builds a pre-filled GitHub issue URL with client telemetry.
 *
 * Captures everything useful for debugging mobile issues where DevTools
 * aren't available: error details, app/SW version, network state,
 * recent console errors, and optional IndexedDB observation state.
 *
 * Usage:
 *   const url = await buildBugReportUrl({ title, errorMsg, obsId, obsName });
 *   window.open(url, '_blank');
 */

const REPO = 'ArtemioPadilla/rastrum';
const MAX_CONSOLE_ERRORS = 5;

// Capture console.error calls from page load so we have them at report time.
// Install this once at module load — harmless if called multiple times.
const _capturedErrors: string[] = [];
(function installConsoleCapture() {
  if (typeof window === 'undefined') return;
  if ((window as unknown as Record<string, unknown>).__rastrum_console_capture) return;
  (window as unknown as Record<string, unknown>).__rastrum_console_capture = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    _capturedErrors.push(
      args.map(a => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a))).join(' ')
    );
    if (_capturedErrors.length > 20) _capturedErrors.shift(); // rolling buffer
    orig(...args);
  };
})();

export interface BugReportOptions {
  /** Short title for the GitHub issue */
  title: string;
  /** The raw error message from IndexedDB / sync */
  errorMsg?: string;
  /** Observation ID (will be included anonymized) */
  obsId?: string;
  /** Species name for context */
  obsName?: string;
  /** Extra key/value pairs to include in the environment block */
  extra?: Record<string, string>;
}

export async function buildBugReportUrl(opts: BugReportOptions): Promise<string> {
  const { title, errorMsg, obsId, obsName, extra } = opts;

  // App version from meta tag (injected at build time)
  const appVersion =
    document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content ?? 'unknown';

  // Service worker version
  let swVersion = 'none';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active?.scriptURL) swVersion = reg.active.scriptURL.split('/').pop() ?? 'active';
  } catch {
    swVersion = 'unavailable';
  }

  // Recent console errors (last N captured)
  const recentErrors = _capturedErrors.slice(-MAX_CONSOLE_ERRORS);

  // ── description field — what happened ──────────────────────────────────────
  const descriptionLines = [
    errorMsg ? `**Error:** \`${errorMsg.slice(0, 200)}\`` : '',
    obsId    ? `**Observation ID:** ${obsId}` : '',
    obsName  ? `**Species:** ${obsName}` : '',
    '',
    recentErrors.length > 0
      ? `**Recent console errors:**\n\`\`\`\n${recentErrors.join('\n---\n').slice(0, 1000)}\n\`\`\``
      : '_No console errors captured._',
  ].filter(Boolean).join('\n');

  // ── environment field — telemetry table ────────────────────────────────────
  const envData: Record<string, string> = {
    URL:          location.href,
    'User Agent': navigator.userAgent,
    Locale:       navigator.language,
    Build:        appVersion,
    'SW version': swVersion,
    Online:       String(navigator.onLine),
    Viewport:     `${window.innerWidth}x${window.innerHeight}`,
    Time:         new Date().toISOString(),
    ...(extra ?? {}),
  };

  const environmentBlock = Object.entries(envData)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  // GitHub issue forms: field values are passed as ?field_id=value
  // When .yml templates exist, ?body= is ignored — must use field IDs.
  const params = new URLSearchParams({
    template:    'bug.yml',
    title:       `[Bug]: ${title}`,
    description: descriptionLines,
    environment: environmentBlock,
  });

  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
