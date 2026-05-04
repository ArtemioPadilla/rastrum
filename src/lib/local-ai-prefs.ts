/**
 * Local-AI bandwidth opt-in pref (#583).
 *
 * Extracted from sync.ts so multiple cascade call sites share the same
 * gate without duplicating localStorage logic.
 *
 * WebLLM (Phi-3.5-vision) is ON by default (issue #12 — privacy-first,
 * offline-capable). Users can opt OUT in profile settings if bandwidth
 * is a concern.
 */

const LOCAL_AI_OPTIN = 'rastrum.localAiOptIn';
const LOCAL_AI_DOWNLOAD_WARNED = 'rastrum.localAiDownloadWarned';

export function isLocalAIEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  if (localStorage.getItem(LOCAL_AI_OPTIN) === 'true') return true;
  return localStorage.getItem(LOCAL_AI_OPTIN) !== 'false';
}

export function hasShownLocalAIDownloadWarning(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCAL_AI_DOWNLOAD_WARNED) === 'true';
}

export function markLocalAIDownloadWarningShown(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_AI_DOWNLOAD_WARNED, 'true');
  }
}
