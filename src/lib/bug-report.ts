/**
 * buildBugReportUrl — builds a pre-filled GitHub issue URL with client telemetry.
 *
 * Uses field-ID query params that match the `id` attributes in
 * `.github/ISSUE_TEMPLATE/bug.yml` so GitHub Issue Forms actually
 * pre-populate the fields (the old `?body=` param is silently ignored
 * by .yml-based templates).
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
const MAX_CONSOLE_ITEMS = 8;

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

  // ── description field — what happened ──────────────────────────────────────
  const descriptionLines = [
    errorMsg ? `**Error:** \`${errorMsg.slice(0, 200)}\`` : '',
    obsId    ? `**Observation ID:** ${obsId}` : '',
    obsName  ? `**Species:** ${obsName}` : '',
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

  const envLines = Object.entries(envData)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  // Pull captured diagnostics from the global capture installed by ReportIssueButton
  const diag = (window as unknown as Record<string, unknown>).__rastrum_diag as
    | { console: Array<{ ts: string; level: string; msg: string }>; network: Array<{ ts: string; method: string; url: string; status: number; statusText: string }>; errors: Array<{ ts: string; msg: string; src: string }> }
    | undefined;

  let consoleBlock = '';
  if (diag) {
    const items = [...diag.console, ...diag.errors]
      .sort((a, b) => (a.ts < b.ts ? -1 : 1))
      .slice(-MAX_CONSOLE_ITEMS);
    if (items.length) {
      consoleBlock = '\n\nConsole errors:\n' + items.map(e => {
        const prefix = 'level' in e ? `[${e.level}]` : '[error]';
        const src = 'src' in e && e.src ? ` (${e.src})` : '';
        return `${e.ts} ${prefix} ${e.msg}${src}`;
      }).join('\n---\n');
    }
  }

  let networkBlock = '';
  if (diag && diag.network.length) {
    const recent = diag.network.slice(-MAX_CONSOLE_ITEMS);
    networkBlock = '\n\nFailed requests:\n' + recent.map(e =>
      `${e.ts} ${e.method} ${e.url} → ${e.status || 'ERR'} ${e.statusText}`
    ).join('\n');
  }

  const environmentBlock = envLines + consoleBlock + networkBlock;

  // GitHub Issue Forms: field values are passed as ?field_id=value
  // matching the `id` attributes in .github/ISSUE_TEMPLATE/bug.yml
  const params = new URLSearchParams({
    template:    'bug.yml',
    title:       `[Bug]: ${title}`,
    description: descriptionLines,
    environment: environmentBlock,
  });

  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
