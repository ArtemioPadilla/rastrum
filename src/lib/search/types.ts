export type SearchEntryType = 'action' | 'page' | 'doc' | 'observation' | 'species';

export interface SearchEntry {
  id: string;
  type: SearchEntryType;
  label: string;
  /** Alternate-locale label — enables cross-locale fuzzy matching. */
  labelAlt?: string;
  url: string;
  keywords?: string;
  description?: string;
  /** For action entries that trigger in-page side-effects rather than navigation. */
  action?: 'sign-out' | 'toggle-theme' | 'switch-lang';
}
