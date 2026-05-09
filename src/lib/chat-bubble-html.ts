/**
 * Bubble-rendering helpers for ChatView. Pure string templates; no DOM
 * access, no listeners. Keeps ChatView's main script focused on
 * orchestration; allows entity chips and bubble bodies to be tested
 * independently.
 *
 * The parent does .innerHTML and then attaches listeners via
 * querySelectorAll() against `[data-chat-bubble]` / `[data-chip-detach]`.
 */

import type { EntityKind } from './chat-entities/types';

export function escapeHtml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&#39;','"':'&quot;'}[c]!));
}

export function entityChipHtml(opts: {
  kind: EntityKind; id: string; label: string; icon: string; lang: 'en' | 'es';
}): string {
  const url = canonicalEntityUrl(opts.kind, opts.id, opts.lang);
  return `<div data-chat-entity-chip class="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/10 p-2 text-sm">
    <span class="text-base flex-shrink-0">${escapeHtml(opts.icon)}</span>
    <a href="${url}" target="_blank" rel="noopener" class="flex-1 min-w-0 truncate font-medium text-emerald-900 dark:text-emerald-100 hover:underline">${escapeHtml(opts.label)}</a>
    <button data-chip-detach type="button" aria-label="Remove" class="w-6 h-6 rounded-full bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 text-xs flex items-center justify-center hover:bg-emerald-300">×</button>
  </div>`;
}

export function canonicalEntityUrl(kind: EntityKind, id: string, lang: 'en' | 'es'): string {
  switch (kind) {
    case 'observation':    return `/share/obs/?id=${encodeURIComponent(id)}`;
    case 'species':        return `/${lang}/${lang === 'es' ? 'especie' : 'species'}/${encodeURIComponent(id)}/`;
    case 'project':        return `/${lang}/${lang === 'es' ? 'proyectos' : 'projects'}/detail/?slug=${encodeURIComponent(id)}`;
    case 'observer':       return `/${lang}/${lang === 'es' ? 'perfil' : 'profile'}/u/${encodeURIComponent(id)}/`;
    case 'self_profile':   return `/${lang}/${lang === 'es' ? 'perfil' : 'profile'}/`;
    case 'camera_station': return '#';
    default:               return '#';
  }
}
