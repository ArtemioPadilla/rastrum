/**
 * makeDropTarget — attach drag & drop file handling to any element.
 *
 * Extracted from DropZone.astro so all multimedia upload surfaces can
 * share the same UX without duplicating event-handler boilerplate.
 *
 * Usage:
 *   const cleanup = makeDropTarget(el, (files) => handleFiles(files), {
 *     accept: ['image/'],          // MIME prefix filter (optional)
 *     overlayEl: myOverlayDiv,     // shown on dragenter, hidden on drop/leave
 *     label: 'Drop to add photos', // accessible aria-label on overlay (optional)
 *   });
 *   // later: cleanup() to remove all listeners
 *
 * Refs #790
 */

export interface DropTargetOptions {
  /** MIME type prefixes to accept. E.g. ['image/', 'audio/']. Undefined = accept all. */
  accept?: string[];
  /** Optional overlay element to show while a drag is active. */
  overlayEl?: HTMLElement | null;
  /** If true, prevent the drop zone from activating when the drag originates
   *  from inside the same element (e.g. reordering thumbnails). Default false. */
  rejectInternal?: boolean;
}

export function makeDropTarget(
  element: HTMLElement,
  onFiles: (files: File[]) => void,
  options: DropTargetOptions = {},
): () => void {
  const { accept, overlayEl, rejectInternal = false } = options;
  let dragDepth = 0; // track nested dragenter/dragleave pairs

  function filterFiles(list: FileList | null): File[] {
    if (!list) return [];
    const files = Array.from(list);
    if (!accept?.length) return files;
    return files.filter(f => f && accept.some(prefix => f.type?.startsWith(prefix)));
  }

  function showOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.remove('hidden');
    overlayEl.classList.add('flex');
  }

  function hideOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.add('hidden');
    overlayEl.classList.remove('flex');
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    if (rejectInternal && element.contains(e.relatedTarget as Node)) return;
    dragDepth++;
    if (dragDepth === 1) showOverlay();
  }

  function onDragLeave(e: DragEvent) {
    if (rejectInternal && element.contains(e.relatedTarget as Node)) return;
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; hideOverlay(); }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    hideOverlay();
    const files = filterFiles(e.dataTransfer?.files ?? null);
    if (files.length) onFiles(files);
  }

  element.addEventListener('dragenter', onDragEnter);
  element.addEventListener('dragleave', onDragLeave);
  element.addEventListener('dragover', onDragOver);
  element.addEventListener('drop', onDrop);

  return () => {
    element.removeEventListener('dragenter', onDragEnter);
    element.removeEventListener('dragleave', onDragLeave);
    element.removeEventListener('dragover', onDragOver);
    element.removeEventListener('drop', onDrop);
  };
}
