export const RECENTS_VIEW_MODE_KEY = 'rastrum.recents.viewMode';

export type ViewMode = 'cards' | 'grid' | 'list' | 'map' | 'timeline';

export const DEFAULT_VIEW_MODE: ViewMode = 'cards';

export function isViewMode(v: unknown): v is ViewMode {
  return v === 'cards' || v === 'grid' || v === 'list' || v === 'map' || v === 'timeline';
}
