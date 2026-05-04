/**
 * Identifier plugin user preferences (#583).
 *
 * Single source of truth for which plugins the user has explicitly disabled
 * in the registry UI (/profile/settings/ai/). Extracted from ProfileEditForm
 * so every cascade call site can honor the toggle uniformly.
 *
 * Storage key kept as `rastrum.pipeline.disabled` for backwards compat with
 * existing user preferences.
 */

const STORAGE_KEY = 'rastrum.pipeline.disabled';

export function getDisabledPlugins(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setDisabledPlugins(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function togglePluginDisabled(id: string): string[] {
  const list = getDisabledPlugins();
  const idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1); else list.push(id);
  setDisabledPlugins(list);
  return list;
}
