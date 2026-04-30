/**
 * installConsoleKeybindings — g-prefix navigation shortcuts for the admin console.
 *
 * Pattern: track the last keypress with a 500ms window. If the previous key
 * was "g" and the next key matches a binding, navigate. Key events are
 * suppressed when focus is inside an input, textarea, or select to avoid
 * hijacking search box typing.
 *
 * Bindings:
 *   g a → /console/audit/
 *   g u → /console/users/
 *   g o → /console/observations/
 *   g r → /console/flag-queue/
 *   g c → /console/comments/
 *   g b → /console/bans/
 *   g x → /console/experts/  (x because PR15 reclaimed `e` for errors)
 *   g s → /console/sync/
 *   g k → /console/api/   (k for "kuotas" — q is reserved for search)
 *   g h → /console/health/
 *   g e → /console/errors/
 *
 *   ?   → opens help overlay
 *   Esc → closes any open slide-over (already handled in ConsoleSlideOver;
 *         this also closes the help overlay)
 *
 * The console base path is locale-aware. We read the current pathname prefix
 * (e.g. /en/console or /es/consola) and build routes relative to it.
 *
 * Note: "g g" (double-g) is deliberately NOT bound. That chord navigates to
 * page top in Vim and many browser extensions — we respect that convention.
 */

type Binding = { key: string; path: string; labelKey: string };

const BINDINGS: Binding[] = [
  { key: 'a', path: 'audit',       labelKey: 'kb_nav_audit'       },
  { key: 'u', path: 'users',       labelKey: 'kb_nav_users'       },
  { key: 'o', path: 'observations',labelKey: 'kb_nav_observations'},
  { key: 'r', path: 'flag-queue',  labelKey: 'kb_nav_flag_queue'  },
  { key: 'c', path: 'comments',    labelKey: 'kb_nav_comments'    },
  { key: 'b', path: 'bans',        labelKey: 'kb_nav_bans'        },
  { key: 'x', path: 'experts',     labelKey: 'kb_nav_experts'     },
  { key: 's', path: 'sync',        labelKey: 'kb_nav_sync'        },
  { key: 'k', path: 'api',         labelKey: 'kb_nav_api'         },
  { key: 'h', path: 'health',      labelKey: 'kb_nav_health'      },
  { key: 'e', path: 'errors',      labelKey: 'kb_nav_errors'      },
];

function isInTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function resolveConsolePath(subPath: string): string {
  // pathname looks like /en/console/audit/ or /es/consola/users/
  // Split on the 3rd segment to get the base console root
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return `/${subPath}/`;
  const base = `/${parts[0]}/${parts[1]}`;
  return `${base}/${subPath}/`;
}

function buildHelpOverlay(labels: Record<string, string>): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'console-kb-help';
  overlay.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/40';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', labels['kb_help_title'] ?? 'Keyboard shortcuts');

  const panel = document.createElement('div');
  panel.className = 'bg-white dark:bg-zinc-950 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 w-full max-w-sm';

  const heading = document.createElement('h2');
  heading.className = 'text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4';
  heading.textContent = labels['kb_help_title'] ?? 'Keyboard shortcuts';

  const navSection = document.createElement('div');
  navSection.className = 'mb-4';
  const navHeading = document.createElement('p');
  navHeading.className = 'text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2';
  navHeading.textContent = labels['kb_help_navigation'] ?? 'Navigation';
  navSection.appendChild(navHeading);

  const navList = document.createElement('dl');
  navList.className = 'space-y-1';

  BINDINGS.forEach(b => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 text-sm';

    const dt = document.createElement('dt');
    dt.className = 'font-mono text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 w-8 text-center';
    dt.textContent = `g ${b.key}`;

    const dd = document.createElement('dd');
    dd.className = 'text-zinc-600 dark:text-zinc-400';
    dd.textContent = labels[b.labelKey] ?? b.path;

    row.appendChild(dt);
    row.appendChild(dd);
    navList.appendChild(row);
  });

  navSection.appendChild(navList);

  const actionsSection = document.createElement('div');
  actionsSection.className = 'mb-4';
  const actHeading = document.createElement('p');
  actHeading.className = 'text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2';
  actHeading.textContent = labels['kb_help_actions'] ?? 'Actions';
  actionsSection.appendChild(actHeading);

  const actList = document.createElement('dl');
  actList.className = 'space-y-1';

  const actions = [
    { chord: '?',   labelKey: 'kb_question_help'  },
    { chord: 'Esc', labelKey: 'kb_escape_close'   },
  ];
  actions.forEach(a => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 text-sm';
    const dt = document.createElement('dt');
    dt.className = 'font-mono text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 w-8 text-center';
    dt.textContent = a.chord;
    const dd = document.createElement('dd');
    dd.className = 'text-zinc-600 dark:text-zinc-400';
    dd.textContent = labels[a.labelKey] ?? a.chord;
    row.appendChild(dt);
    row.appendChild(dd);
    actList.appendChild(row);
  });

  actionsSection.appendChild(actList);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mt-2 w-full px-3 py-2 rounded bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700';
  closeBtn.textContent = labels['kb_help_close'] ?? 'Close';
  closeBtn.addEventListener('click', closeHelp);

  panel.appendChild(heading);
  panel.appendChild(navSection);
  panel.appendChild(actionsSection);
  panel.appendChild(closeBtn);
  overlay.appendChild(panel);

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeHelp();
  });

  return overlay;
}

function closeHelp() {
  document.getElementById('console-kb-help')?.remove();
}

export function installConsoleKeybindings(labels: Record<string, string>): () => void {
  let lastKey = '';
  let lastKeyTime = 0;
  const WINDOW_MS = 500;

  function onKeyDown(ev: KeyboardEvent) {
    if (isInTextInput(document.activeElement)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const key = ev.key;
    const now = Date.now();

    if (key === 'Escape') {
      closeHelp();
      return;
    }

    if (key === '?') {
      ev.preventDefault();
      if (!document.getElementById('console-kb-help')) {
        document.body.appendChild(buildHelpOverlay(labels));
      } else {
        closeHelp();
      }
      lastKey = '';
      return;
    }

    if (key === 'g' && (now - lastKeyTime > WINDOW_MS || lastKey !== 'g')) {
      lastKey = 'g';
      lastKeyTime = now;
      return;
    }

    if (lastKey === 'g' && now - lastKeyTime <= WINDOW_MS) {
      const binding = BINDINGS.find(b => b.key === key);
      if (binding) {
        ev.preventDefault();
        window.location.href = resolveConsolePath(binding.path);
      }
    }

    lastKey = key;
    lastKeyTime = now;
  }

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
