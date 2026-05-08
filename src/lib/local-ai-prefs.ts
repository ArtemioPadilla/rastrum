/**
 * Local-AI download-warning pref (#583).
 *
 * Tracks whether the user has already seen the bandwidth warning so
 * the UI doesn't nag repeatedly.
 */

const LOCAL_AI_DOWNLOAD_WARNED = 'rastrum.localAiDownloadWarned';

export function hasShownLocalAIDownloadWarning(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCAL_AI_DOWNLOAD_WARNED) === 'true';
}

export function markLocalAIDownloadWarningShown(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_AI_DOWNLOAD_WARNED, 'true');
  }
}
