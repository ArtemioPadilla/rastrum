/**
 * make-drop-target.ts — Shared drag & drop utility (issue #790).
 *
 * Extracts the drag-and-drop wiring logic from DropZone.astro into a
 * reusable function so ObsManagePanel, QuickObserveSheet, and BatchImporter
 * can all get the same UX without duplicating event-listener boilerplate.
 *
 * Usage:
 *   import { makeDropTarget } from '../lib/make-drop-target';
 *   makeDropTarget(myElement, (files) => handleFiles(files));
 *
 * The element receives:
 *   - dragenter / dragleave: adds/removes a CSS class for visual feedback
 *   - drop: calls onFiles with the dropped File array
 *
 * The optional `overlayEl` or `overlaySelector` points to a child element
 * that is shown/hidden during drag-over (mirrors DropZone's #dz-dragover).
 */

export interface DropTargetOptions {
  /** CSS class applied to `element` during drag-over. Default: 'drag-over' */
  activeClass?: string;
  /**
   * A child overlay element to show/hide during drag-over.
   * Pass either a reference or a CSS selector relative to `element`.
   */
  overlayEl?: HTMLElement;
  /** Selector for a child overlay element to show/hide. Optional. */
  overlaySelector?: string;
  /** Accept only these MIME type prefixes. Empty = accept all. */
  accept?: string[];
}

/**
 * Wire drag-and-drop behaviour onto `element`.
 *
 * @param element  The DOM element to use as a drop target.
 * @param onFiles  Called with the array of dropped (and optionally filtered) files.
 * @param options  Optional configuration.
 * @returns        A cleanup function that removes all added listeners.
 */
export function makeDropTarget(
  element: HTMLElement,
  onFiles: (files: File[]) => void,
  options: DropTargetOptions = {},
): () => void {
  const { activeClass = 'drag-over', accept = [] } = options;

  // Resolve overlay element: direct reference takes priority over selector.
  const overlay: HTMLElement | null =
    options.overlayEl ??
    (options.overlaySelector
      ? (element.querySelector(options.overlaySelector) as HTMLElement | null)
      : null);

  function showOverlay(): void {
    overlay?.classList.remove('hidden');
    element.classList.add(activeClass);
  }

  function hideOverlay(): void {
    overlay?.classList.add('hidden');
    element.classList.remove(activeClass);
  }

  function filterFiles(files: File[]): File[] {
    if (!accept.length) return files;
    return files.filter((f) =>
      accept.some((mime) => f.type.startsWith(mime)),
    );
  }

  function onDragEnter(e: DragEvent): void {
    e.preventDefault();
    showOverlay();
  }

  function onDragLeave(e: DragEvent): void {
    // Only hide if leaving the element itself, not a child.
    if (!element.contains(e.relatedTarget as Node | null)) {
      hideOverlay();
    }
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    hideOverlay();
    const files = filterFiles(Array.from(e.dataTransfer?.files ?? []));
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
