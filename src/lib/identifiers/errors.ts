/**
 * Cascade-aware error types.
 *
 * Most plugin failures fall into "try the next one" — network timeout,
 * model said "not confident", etc. A few are "stop the cascade entirely":
 * the photo has no animal in it, or the user explicitly cancelled. Those
 * throw a typed error the cascade engine recognises and short-circuits on.
 */

/**
 * Thrown by camera-trap MegaDetector when the highest-confidence detection
 * is empty / human / vehicle — i.e. there is no animal to identify. The
 * cascade engine catches this, stops trying further plugins (saving cloud
 * quota), and the caller marks the row `status='needs_review'` with the
 * filtered_label preserved in raw_response.
 */
export class FilteredFrameError extends Error {
  readonly name = 'FilteredFrameError';
  readonly filtered_label: 'empty' | 'human' | 'vehicle';
  readonly raw: unknown;
  readonly source: string;
  constructor(opts: {
    filtered_label: 'empty' | 'human' | 'vehicle';
    source: string;
    raw?: unknown;
  }) {
    super(`Frame filtered as ${opts.filtered_label} by ${opts.source}`);
    this.filtered_label = opts.filtered_label;
    this.source = opts.source;
    this.raw = opts.raw;
  }
}

export function isFilteredFrameError(err: unknown): err is FilteredFrameError {
  return err instanceof Error && err.name === 'FilteredFrameError';
}
