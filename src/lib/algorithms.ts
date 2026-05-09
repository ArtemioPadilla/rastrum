/**
 * Algorithmic-disclosure catalog (M-Meta).
 *
 * Single source of truth for every "Why am I seeing this?" prompt.
 * Each entry describes the inputs the ranker uses, the time window
 * it considers, and where the user can change the relevant settings.
 *
 * Add a new entry whenever a new ranked surface ships. The
 * `<WhyAmISeeingThis>` component reads this catalog by id.
 */
import { routes } from '../i18n/utils';

export type AlgorithmId =
  | 'community_observers'
  | 'explore_recent'
  | 'explore_species_recent';

export interface AlgorithmCopy {
  /** Inputs the ranker consumes — one bullet per input. */
  inputs: string[];
  /** Human-readable time window. */
  window: string;
  /** Localized settings link label. */
  settings_label: string;
}

export interface AlgorithmEntry {
  /** Localized headline ("Why am I seeing this ranking?"). */
  headline: { en: string; es: string };
  /** Localized one-line summary describing the ranker. */
  summary: { en: string; es: string };
  /** Per-locale templated body. */
  copy: { en: AlgorithmCopy; es: AlgorithmCopy };
  /** Settings path the "How do I change this?" link points to. */
  settings_path: { en: string; es: string };
}

export const ALGORITHMS: Record<AlgorithmId, AlgorithmEntry> = {
  community_observers: {
    headline: {
      en: 'Why am I seeing this ranking?',
      es: '¿Por qué veo este ranking?',
    },
    summary: {
      en: 'Observers are ranked by activity within the filter you have selected.',
      es: 'Los observadores se ordenan por actividad dentro del filtro que elegiste.',
    },
    copy: {
      en: {
        inputs: [
          'The sort field you picked (observations, species, or recent activity)',
          'Country filter (your profile country, or the one in the URL)',
          'Taxon filter (when set, only observers active in that group count)',
          'Approximate centroid (only when "Nearby" is on and you are signed in)',
        ],
        window: 'Last 30 days for activity-based sorts (7-day option also available)',
        settings_label: 'Privacy & leaderboards settings',
      },
      es: {
        inputs: [
          'El campo de orden que elegiste (observaciones, especies o actividad reciente)',
          'Filtro de país (tu país de perfil, o el de la URL)',
          'Filtro taxonómico (cuando está activo, solo cuentan observadores en ese grupo)',
          'Centroide aproximado (solo si "Cerca" está activo y has iniciado sesión)',
        ],
        window: 'Últimos 30 días para los órdenes de actividad (también hay opción de 7 días)',
        settings_label: 'Privacidad y leaderboards',
      },
    },
    settings_path: {
      en: routes.profileSettingsPrivacy.en,
      es: routes.profileSettingsPrivacy.es,
    },
  },
  explore_recent: {
    headline: {
      en: 'Why am I seeing these observations?',
      es: '¿Por qué veo estas observaciones?',
    },
    summary: {
      en: 'A simple chronological feed — newest first, no personalization.',
      es: 'Un feed cronológico simple — más nuevas primero, sin personalización.',
    },
    copy: {
      en: {
        inputs: [
          'Public sync timestamp (most recent first)',
          'Public visibility (private observations are excluded)',
          'No engagement signals — order does not depend on likes, IDs, or follows',
        ],
        window: 'All public observations, paginated 20 at a time',
        settings_label: 'Visibility & privacy settings',
      },
      es: {
        inputs: [
          'Marca de tiempo de sincronización pública (más reciente primero)',
          'Visibilidad pública (las observaciones privadas se excluyen)',
          'Sin señales de engagement — el orden no depende de likes, IDs ni seguidores',
        ],
        window: 'Todas las observaciones públicas, paginadas de 20 en 20',
        settings_label: 'Visibilidad y privacidad',
      },
    },
    settings_path: {
      en: routes.profileSettingsPrivacy.en,
      es: routes.profileSettingsPrivacy.es,
    },
  },
  explore_species_recent: {
    headline: {
      en: 'Why am I seeing this species ordering?',
      es: '¿Por qué veo este orden de especies?',
    },
    summary: {
      en: 'Species are sorted by their most recent public observation.',
      es: 'Las especies se ordenan por su observación pública más reciente.',
    },
    copy: {
      en: {
        inputs: [
          'Most-recent public observation timestamp per species',
          'Species with at least one public observation are included',
          'Filter chips you have set (kingdom, conservation, endemic, etc.)',
        ],
        window: 'All-time pool, but the order key is the latest observation date',
        settings_label: 'Visibility & privacy settings',
      },
      es: {
        inputs: [
          'Marca de tiempo de la observación pública más reciente por especie',
          'Se incluyen especies con al menos una observación pública',
          'Los chips que activaste (reino, conservación, endémica, etc.)',
        ],
        window: 'Todo el histórico, pero la llave de orden es la fecha de la observación más reciente',
        settings_label: 'Visibilidad y privacidad',
      },
    },
    settings_path: {
      en: routes.profileSettingsPrivacy.en,
      es: routes.profileSettingsPrivacy.es,
    },
  },
};

export function getAlgorithm(id: AlgorithmId): AlgorithmEntry {
  return ALGORITHMS[id];
}
