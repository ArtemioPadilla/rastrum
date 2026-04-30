/**
 * Promise-based wrapper around the global PhotoCropModal. The modal
 * lives in `BaseLayout.astro` and listens for `rastrum:cropmodal-open`;
 * it emits `rastrum:cropmodal-result` when the user resolves it.
 */

export type CropResult =
  | { kind: 'use'; file: File }
  | { kind: 'skip'; file: File }
  | { kind: 'cancel' };

/**
 * Open the global crop modal for `file`. Resolves once the user
 * confirms ("use"), keeps the original ("skip"), or backs out
 * ("cancel"). Resolves immediately with `{ kind: 'skip', file }` when
 * the modal isn't mounted (graceful fallback for SSR / missing
 * BaseLayout).
 */
export function openCropModal(file: File): Promise<CropResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ kind: 'skip', file });
      return;
    }
    const modal = document.getElementById('rastrum-crop-modal');
    if (!modal) {
      resolve({ kind: 'skip', file });
      return;
    }

    let settled = false;
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ kind: 'use' | 'skip' | 'cancel'; file?: File }>;
      const detail = e.detail;
      if (!detail) return;
      // Multiple events may fire on skip (one without file, one with);
      // ignore subsequent ones once we've settled.
      if (settled) return;
      settled = true;
      window.removeEventListener('rastrum:cropmodal-result', handler);
      if (detail.kind === 'use' && detail.file) {
        resolve({ kind: 'use', file: detail.file });
      } else if (detail.kind === 'skip') {
        resolve({ kind: 'skip', file: detail.file ?? file });
      } else {
        resolve({ kind: 'cancel' });
      }
    };
    window.addEventListener('rastrum:cropmodal-result', handler);
    window.dispatchEvent(new CustomEvent('rastrum:cropmodal-open', { detail: { file } }));
  });
}
