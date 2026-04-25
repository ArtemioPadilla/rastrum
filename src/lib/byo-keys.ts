/**
 * BYO API key store — pure client-side, localStorage-backed.
 *
 * Layout: a single localStorage entry under STORAGE_KEY holds a JSON
 * map keyed by `pluginId.keyName`. Flat to keep migrations simple.
 *
 *   {
 *     "claude_haiku.anthropic": "sk-ant-...",
 *     "plantnet.plantnet":      "2b10..."
 *   }
 *
 * Privacy invariants:
 *   - Keys never leave localStorage except to be forwarded per-call to
 *     the Edge Function for a single identify request.
 *   - We never sync them to Supabase, never log them, never include them
 *     in URLs or query strings (always request body).
 *   - Clearing the browser's storage clears every key. There is no
 *     copy on our server.
 */

const STORAGE_KEY = 'rastrum.byoKeys';
const LEGACY_ANTHROPIC_KEY = 'rastrum.byoAnthropicKey';

type KeyMap = Record<string, string>;   // 'pluginId.keyName' → value

function path(pluginId: string, keyName: string): string {
  return `${pluginId}.${keyName}`;
}

function readMap(): KeyMap {
  if (typeof localStorage === 'undefined') return {};
  // One-time migration of the legacy single-key storage.
  const legacy = localStorage.getItem(LEGACY_ANTHROPIC_KEY);
  if (legacy) {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as KeyMap;
    if (!existing['claude_haiku.anthropic']) {
      existing['claude_haiku.anthropic'] = legacy;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    }
    localStorage.removeItem(LEGACY_ANTHROPIC_KEY);
  }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as KeyMap;
  } catch {
    return {};
  }
}

function writeMap(m: KeyMap): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
}

/** Get a single key. Returns undefined when not set. */
export function getKey(pluginId: string, keyName: string): string | undefined {
  const m = readMap();
  const v = m[path(pluginId, keyName)];
  return v && v.trim() !== '' ? v : undefined;
}

/** Set or clear a key. Empty/whitespace removes the entry. */
export function setKey(pluginId: string, keyName: string, value: string): void {
  const m = readMap();
  const trimmed = value.trim();
  const p = path(pluginId, keyName);
  if (trimmed === '') delete m[p];
  else m[p] = trimmed;
  writeMap(m);
}

/** Remove a single key. */
export function clearKey(pluginId: string, keyName: string): void {
  const m = readMap();
  delete m[path(pluginId, keyName)];
  writeMap(m);
}

/** Get every key for a plugin, useful for forwarding to identify(). */
export function getAllKeysForPlugin(pluginId: string): Record<string, string> {
  const m = readMap();
  const out: Record<string, string> = {};
  const prefix = pluginId + '.';
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith(prefix)) {
      out[k.slice(prefix.length)] = v;
    }
  }
  return out;
}

/** Wipe every BYO key on this device. */
export function clearAllKeys(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_ANTHROPIC_KEY);
}

/** Returns true when at least one key is set for this plugin. */
export function hasKeysForPlugin(pluginId: string): boolean {
  return Object.keys(getAllKeysForPlugin(pluginId)).length > 0;
}
