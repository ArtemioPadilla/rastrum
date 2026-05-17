/**
 * Pure HTML template for one plugin card on the AI settings tab.
 *
 * Returns a string ready to be joined with siblings into the
 * registry list's innerHTML. Keeps all class names + element IDs
 * compatible with the existing on-device download JS in
 * ProfileEditForm.astro (vision-download, birdnet-status, etc.) so
 * wireOnDeviceControls(rootEl) can bind to them after innerHTML is
 * set.
 *
 * Element IDs that downstream JS expects (do NOT rename):
 *   webllm_phi35_vision     → vision-download / vision-delete / vision-status / vision-progress / phi-vision-enable
 *   onnx_gemma4_vision      → gemma-vision-{download,delete,status,progress,enable}
 *   birdnet_lite            → birdnet-{download,delete,status,progress}
 *   onnx_efficientnet_lite0 → onnx-base-{download,delete,status,progress}
 *   camera_trap_megadetector → megadetector-{download,delete,status,progress}
 *   speciesnet_distilled    → speciesnet-{download,delete,status,progress}
 */
import type { Identifier } from './identifiers/types';
import type { ModelCacheStatus } from './local-ai';
import type { CardState } from './identifier-state';

/**
 * Registry plugin id → DOM id prefix for its download/delete/status/
 * progress controls. The single source of truth for the
 * `${prefix}-download` contract. `DownloadChooser`'s `prefixByTarget`
 * map drives the curated chooser's clicks against these ids; the
 * `tests/unit/download-chooser-prefix-sync.test.ts` guard fails the
 * build if the two ever drift (a silent no-op otherwise — #1127).
 */
export const ON_DEVICE_DL_PREFIX: Readonly<Record<string, string>> = {
  webllm_phi35_vision: 'vision',
  onnx_gemma4_vision: 'gemma-vision',
  birdnet_lite: 'birdnet',
  onnx_efficientnet_lite0: 'onnx-base',
  camera_trap_megadetector: 'megadetector',
  speciesnet_distilled: 'speciesnet',
};

export interface ActiveSponsorship {
  sponsor_handle: string;
  daily_limit: number | null;
  used_today: number | null;
}

export interface PlantNetQuota {
  used_today: number;
  daily_limit: number;
  reset_at?: string;
}

/**
 * Props for a unified plugin card on the AI settings tab.
 *
 * @see docs/superpowers/specs/2026-05-07-ai-tab-redesign-design.md
 *
 * NOTE (#719): The spec originally listed `availability: AvailabilityResult`
 * here. During implementation this was refined to `state: CardState` (pre-
 * derived via `deriveCardState()` in identifier-state.ts) so the same logic
 * is shared between the card renderer and the cascade gates. The spec has
 * been updated to match.
 */
export interface PluginCardProps {
  lang: 'en' | 'es';
  plugin: Identifier;
  state: CardState;
  isDisabled: boolean;
  cacheStatus: ModelCacheStatus | null;
  /** Map of keySpec.name → present-and-non-empty? */
  byoKeysSet: Record<string, boolean>;
  /** Only meaningful for plugin.id === 'claude_haiku'. */
  sponsorship: ActiveSponsorship | null;
  /** Only meaningful for plugin.id === 'plantnet'. */
  plantnetQuota?: PlantNetQuota | null;
}

function escape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]!));
}

function bytesHuman(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

interface Strings {
  active: string; disabled: string; no_key: string; not_downloaded: string; unsupported: string;
  enable: string; disable: string; download: string; redownload: string; cancel: string; delete: string;
  add_key: string; use_own_key: string; use_sponsorship: string; via_sponsorship: string; sponsored_by: string; ids_today: string;
  configure: string; configure_edit: string; save: string; test: string; clear: string;
  validating: string; saved: string; save_anyway: string;
}

const STRINGS: Record<'en' | 'es', Strings> = {
  en: {
    active: 'Active', disabled: '⏸ Disabled', no_key: 'No key', not_downloaded: 'Not downloaded',
    unsupported: '⚠ Unsupported', enable: 'Enable', disable: 'Disable', download: 'Download',
    redownload: 'Re-download', cancel: 'Cancel',
    delete: 'Delete', add_key: 'Add key', use_own_key: 'Use my own key',
    use_sponsorship: 'Use sponsorship',
    via_sponsorship: 'via sponsorship', sponsored_by: 'sponsored by', ids_today: 'IDs today',
    configure: 'Configure', configure_edit: 'Configure · edit', save: 'Save', test: 'Test',
    clear: 'Clear', validating: 'Validating…', saved: '✓ Saved', save_anyway: 'Save without testing',
  },
  es: {
    active: 'Activo', disabled: '⏸ Desactivado', no_key: 'Sin API key', not_downloaded: 'Sin descargar',
    unsupported: '⚠ No soportado', enable: 'Activar', disable: 'Desactivar', download: 'Descargar',
    redownload: 'Volver a descargar', cancel: 'Cancelar',
    delete: 'Eliminar', add_key: 'Agregar API key', use_own_key: 'Usar tu propia API key',
    use_sponsorship: 'Usar patrocinio',
    via_sponsorship: 'vía patrocinio', sponsored_by: 'patrocinado por', ids_today: 'IDs hoy',
    configure: 'Configurar', configure_edit: 'Configurar · editar', save: 'Guardar', test: 'Probar',
    clear: 'Limpiar', validating: 'Validando…', saved: '✓ Guardado', save_anyway: 'Guardar sin probar',
  },
};

function pillFor(state: CardState, t: Strings): string {
  // Tailwind classes match existing patterns at ProfileEditForm.astro:1708.
  const baseClass = 'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded';
  switch (state.kind) {
    case 'active':
      return `<span class="${baseClass} bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">${t.active}</span>`;
    case 'disabled':
      return `<span class="${baseClass} bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">${t.disabled}</span>`;
    case 'no-key':
      return `<span class="${baseClass} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">${t.no_key}</span>`;
    case 'not-downloaded':
      return `<span class="${baseClass} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">${t.not_downloaded}</span>`;
    case 'downloading':
      return `<span class="${baseClass} bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">⏳ ${state.pct}%</span>`;
    case 'unsupported':
      return `<span class="${baseClass} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300">${t.unsupported}</span>`;
  }
}


function actionsFor(p: PluginCardProps, t: Strings): string {
  const id = escape(p.plugin.id);
  const dlPrefix = ON_DEVICE_DL_PREFIX[p.plugin.id];

  const primaryBtn = (label: string, dataAttr: string, value: string) =>
    `<button type="button" ${escape(dataAttr)}="${escape(value)}" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">${label}</button>`;

  const ghostBtn = (label: string, dataAttr: string, value: string) =>
    `<button type="button" ${escape(dataAttr)}="${escape(value)}" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">${label}</button>`;

  const dangerBtn = (label: string, dataAttr: string, value: string) =>
    `<button type="button" ${escape(dataAttr)}="${escape(value)}" class="rounded-lg border border-red-300 dark:border-red-900/50 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">${label}</button>`;

  const toggleBtn = (label: string) =>
    `<button type="button" data-toggle-plugin="${id}" class="rounded-lg border border-emerald-600/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-2 py-1 text-[10px] font-medium">${label}</button>`;

  switch (p.state.kind) {
    case 'active': {
      // Cloud plugin: edit-key + disable. On-device: re-download + delete + disable.
      if (p.plugin.capabilities.runtime === 'server') {
        const keyBtn = p.sponsorship
          ? ghostBtn(t.use_own_key, 'data-edit-key', id)
          : ghostBtn(t.add_key, 'data-edit-key', id);
        return `${keyBtn} ${toggleBtn(t.disable)}`;
      }
      const idBase = dlPrefix ?? '';
      return `
        <button type="button" id="${idBase}-download" class="rounded-lg border border-emerald-600/60 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">${t.redownload}</button>
        <button type="button" id="${idBase}-delete" class="rounded-lg border border-red-300 dark:border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">${t.delete}</button>
        ${toggleBtn(t.disable)}
      `;
    }
    case 'disabled': {
      if (p.plugin.capabilities.runtime === 'server') {
        return toggleBtn(t.enable);
      }
      const idBase = dlPrefix ?? '';
      return `${dangerBtn(t.delete, 'id', `${idBase}-delete`)} ${toggleBtn(t.enable)}`;
    }
    case 'no-key': {
      if (p.plugin.id === 'claude_haiku') {
        const sponsorshipSlug = p.lang === 'es' ? '/perfil/patrocinado-por/' : '/profile/sponsored-by/';
        const sponsorshipHref = `/${p.lang}${sponsorshipSlug}`;
        const sponsorshipLink = `<a href="${escape(sponsorshipHref)}" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">${t.use_sponsorship}</a>`;
        return `${sponsorshipLink} ${primaryBtn(t.add_key, 'data-add-key', id)}`;
      }
      return primaryBtn(t.add_key, 'data-add-key', id);
    }
    case 'not-downloaded': {
      const knownBytes = p.plugin.capabilities.approxDownloadBytes ?? p.cacheStatus?.approxBytes ?? 0;
      const sizeLabel = bytesHuman(knownBytes) || '?';
      const idBase = dlPrefix ?? '';
      return `<button type="button" id="${idBase}-download" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">${t.download} · ${escape(sizeLabel)}</button>`;
    }
    case 'downloading': {
      const idBase = dlPrefix ?? '';
      return `<button type="button" id="${idBase}-cancel" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px]">${t.cancel}</button>`;
    }
    case 'unsupported':
      return '';
  }
}

/**
 * Renders the inline key-configuration form for plugins with keySpec.
 * The <details> is collapsed by default. The data-add-key / data-edit-key
 * handler in ProfileEditForm.astro programmatically opens it and focuses
 * the first input instead of using window.prompt().
 *
 * Attributes used by ProfileEditForm.astro's delegated handlers:
 *   data-key-input[data-plugin]   — password input per key spec
 *   data-key-save[data-plugin]    — Save button (runs validation + persist)
 *   data-key-test[data-plugin]    — Test button (only when testConnection exists)
 *   data-key-clear[data-plugin]   — Clear / remove stored key
 *   data-key-status[data-plugin]  — Status pill updated by handlers
 *   data-key-form[data-plugin]    — The <details> element itself
 */
function keyForm(p: PluginCardProps, t: Strings, hasKey: boolean): string {
  if (!p.plugin.keySpec?.length) return '';
  const id = escape(p.plugin.id);
  const summaryLabel = hasKey ? escape(t.configure_edit) : escape(t.configure);
  const hasTestConnection = typeof (p.plugin as { testConnection?: unknown }).testConnection === 'function';

  const inputs = p.plugin.keySpec.map((spec) => {
    const current = ''; // value is always empty on render — filled by JS after open
    const hintHtml = spec.hint
      ? `<p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">${escape(spec.hint)}</p>`
      : '';
    const setupLink = p.plugin.setupSteps?.find((s) => s.link)?.link ?? '';
    const linkHtml = setupLink
      ? `<a href="${escape(setupLink)}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-emerald-600 dark:text-emerald-400 underline hover:no-underline">Get key ↗</a>`
      : '';
    return `
      <div class="flex flex-col gap-1">
        <label class="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 flex items-center justify-between">
          <span>${escape(spec.label)}</span>
          ${linkHtml}
        </label>
        <input
          type="password"
          data-key-input
          data-plugin="${id}"
          data-key-name="${escape(spec.name)}"
          value="${escape(current)}"
          placeholder="${escape(spec.placeholder ?? '')}"
          autocomplete="off"
          class="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        ${hintHtml}
      </div>
    `.trim();
  }).join('');

  const testBtn = hasTestConnection
    ? `<button type="button" data-key-test="${id}" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">${t.test}</button>`
    : '';

  return `
    <details data-key-form="${id}" class="mt-2">
      <summary class="cursor-pointer text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 select-none list-none flex items-center gap-1">
        <svg class="w-3 h-3 transition-transform [[open]_&]:rotate-90" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true"><path d="M2 0L8 6L2 12V0Z"/></svg>
        ${summaryLabel}
      </summary>
      <div class="mt-2 flex flex-col gap-2">
        ${inputs}
        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" data-key-save="${id}" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">${escape(t.save)}</button>
          ${testBtn}
          <button type="button" data-key-clear="${id}" class="rounded-lg border border-red-300 dark:border-red-900/50 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">${escape(t.clear)}</button>
          <span data-key-status="${id}" class="text-[10px] text-zinc-500 dark:text-zinc-400"></span>
        </div>
      </div>
    </details>
  `.trim();
}

function metaLine(p: PluginCardProps): string {
  const c = p.plugin.capabilities;
  const parts: string[] = [];
  parts.push(c.runtime === 'server' ? 'cloud' : 'on-device');
  parts.push(c.media.map((m) => ({ photo: '📷', audio: '🔊', video: '🎞' }[m] ?? m)).join(''));
  if (c.taxa.length) parts.push(c.taxa.join(', '));
  if (c.confidence_ceiling) parts.push(`cap ≤ ${c.confidence_ceiling.toFixed(2)}`);
  if (p.cacheStatus?.cached) parts.push(`${bytesHuman(p.cacheStatus.approxBytes)} cached`);
  return parts.join(' · ');
}

function sponsorshipLine(p: PluginCardProps, t: Strings): string {
  if (p.plugin.id !== 'claude_haiku' || !p.sponsorship) return '';
  const handle = `@${escape(p.sponsorship.sponsor_handle)}`;
  const usage = p.sponsorship.daily_limit !== null && p.sponsorship.used_today !== null
    ? ` · ${p.sponsorship.used_today} / ${p.sponsorship.daily_limit} ${t.ids_today}`
    : '';
  return `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 ml-1">${t.via_sponsorship}</span><div class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">${t.sponsored_by} ${handle}${usage}</div>`;
}

function plantnetQuotaChip(p: PluginCardProps, t: Strings): string {
  if (p.plugin.id !== 'plantnet' || !p.plantnetQuota) return '';
  const { used_today, daily_limit } = p.plantnetQuota;
  return `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 ml-1">${used_today} / ${daily_limit} ${t.ids_today}</span>`;
}

export function renderPluginCard(p: PluginCardProps): string {
  const t = STRINGS[p.lang];
  const liClass = p.state.kind === 'disabled'
    ? 'rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 opacity-60 p-3'
    : 'rounded-lg border border-zinc-200 dark:border-zinc-800 p-3';

  const message = p.state.kind === 'unsupported' && p.state.message
    ? `<p class="text-[10px] text-zinc-500 italic mt-1">${escape(p.state.message)}</p>`
    : '';

  const hasKey = p.plugin.keySpec?.some((s) => !!p.byoKeysSet[s.name]) ?? false;
  const form = keyForm(p, t, hasKey);

  return `
    <li class="${liClass}">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            ${p.plugin.brand ? `<span class="text-base">${escape(p.plugin.brand)}</span>` : ''}
            <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">${escape(p.plugin.name)}</p>
            ${pillFor(p.state, t)}
            ${sponsorshipLine(p, t)}
            ${plantnetQuotaChip(p, t)}
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${escape(p.plugin.description)}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 font-mono">${escape(metaLine(p))}</p>
          ${message}
          ${form}
        </div>
        <div class="flex flex-wrap gap-2 flex-none">
          ${actionsFor(p, t)}
        </div>
      </div>
    </li>
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────
// Local-data cards (Llama text helper, offline maps). Not in the
// identifier registry — separate helper to keep renderPluginCard
// focused on plugins. Replaces the `synthetic: true` Identifier flag
// considered in earlier drafts (review feedback from #673).
// ─────────────────────────────────────────────────────────────────────

export interface LocalDataCardProps {
  lang: 'en' | 'es';
  id: string;
  name: string;
  description: string;
  brand?: string;
  cacheStatus: ModelCacheStatus | null;
  /** Element id prefix the on-device JS expects ('text', 'pmtiles', etc.). */
  domIdPrefix: string;
  /** When true, renders a Cancel button instead of the Download button. */
  downloading?: boolean;
}

export function renderLocalDataCard(p: LocalDataCardProps): string {
  const t = STRINGS[p.lang];
  const cached = p.cacheStatus?.cached === true;
  const sizeLabel = cached ? bytesHuman(p.cacheStatus!.approxBytes) : '';

  const downloadBtn = p.downloading
    ? `<button type="button" id="${escape(p.domIdPrefix)}-cancel" class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[10px]">${t.cancel}</button>`
    : cached
      ? `<button type="button" id="${escape(p.domIdPrefix)}-download" class="rounded-lg border border-emerald-600/60 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">${t.redownload}</button>`
      : `<button type="button" id="${escape(p.domIdPrefix)}-download" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">${t.download}</button>`;

  const deleteBtn = cached && !p.downloading
    ? `<button type="button" id="${escape(p.domIdPrefix)}-delete" class="rounded-lg border border-red-300 dark:border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">${t.delete}</button>`
    : '';

  const status = cached ? `${sizeLabel} cached` : 'Not downloaded';

  return `
    <li class="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            ${p.brand ? `<span class="text-base">${escape(p.brand)}</span>` : ''}
            <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">${escape(p.name)}</p>
          </div>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${escape(p.description)}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 font-mono">${escape(status)}</p>
        </div>
        <div class="flex flex-wrap gap-2 flex-none">
          ${downloadBtn}
          ${deleteBtn}
        </div>
      </div>
    </li>
  `.trim();
}
