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
  | 'explore_species_recent'
  | 'falta_dex_missing'
  | 'contextual_species_chips'
  | 'profile_percentile_cards'
  | 'active_observers_today'
  | 'home_recent_nearby';

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
  falta_dex_missing: {
    headline: {
      en: 'Why am I seeing these missing species?',
      es: '¿Por qué veo estas especies faltantes?',
    },
    summary: {
      en: 'Species you have not yet logged, sorted by rarity bucket so the rarest gaps surface first.',
      es: 'Especies que aún no registras, ordenadas por bucket de rareza para que las más raras aparezcan primero.',
    },
    copy: {
      en: {
        inputs: [
          'Rarity bucket of each missing species (rare → common)',
          'Region pool for your country (your profile country, set in Edit profile)',
          'Your existing pokédex (only species you have NOT yet observed are included)',
          'No personalisation beyond country — same pool regardless of who is signed in',
        ],
        window: 'Snapshot of the current region pool — refreshed when the page loads',
        settings_label: 'Edit profile (change country)',
      },
      es: {
        inputs: [
          'Bucket de rareza de cada especie faltante (raro → común)',
          'Pool regional de tu país (tu país de perfil, configurable en Editar perfil)',
          'Tu pokédex actual (solo se incluyen especies que aún NO has observado)',
          'Sin personalización más allá del país — el mismo pool para cualquiera que inicie sesión',
        ],
        window: 'Instantánea del pool regional actual — refresca al cargar la página',
        settings_label: 'Editar perfil (cambiar país)',
      },
    },
    settings_path: {
      en: routes.profileEdit.en,
      es: routes.profileEdit.es,
    },
  },
  contextual_species_chips: {
    headline: {
      en: 'Why am I seeing these probable species?',
      es: '¿Por qué veo estas especies probables?',
    },
    summary: {
      en: 'A density estimate from public observations near the location and month of the photo you are about to log.',
      es: 'Una estimación de densidad a partir de observaciones públicas cercanas a la ubicación y al mes de la foto que vas a registrar.',
    },
    copy: {
      en: {
        inputs: [
          'Approximate location (geohash-5 cell, ≈ ±2.4 km) of the photo or your device',
          'Current calendar month (seasonality)',
          'Count of public community observations matching that cell + month, descending',
          'Distance to the closest matching observation (tiebreaker)',
          'No model, no curated baseline — these are real community sightings only',
        ],
        window: 'Public observations within the same geohash-5 cell, in the current month, all years',
        settings_label: 'Edit profile (location & defaults)',
      },
      es: {
        inputs: [
          'Ubicación aproximada (celda geohash-5, ≈ ±2.4 km) de la foto o tu dispositivo',
          'Mes calendario actual (estacionalidad)',
          'Conteo de observaciones públicas de la comunidad en esa celda + mes, descendente',
          'Distancia a la observación coincidente más cercana (desempate)',
          'Sin modelo, sin baseline curado — solo son observaciones reales de la comunidad',
        ],
        window: 'Observaciones públicas dentro de la misma celda geohash-5, en el mes actual, todos los años',
        settings_label: 'Editar perfil (ubicación y predeterminados)',
      },
    },
    settings_path: {
      en: routes.profileEdit.en,
      es: routes.profileEdit.es,
    },
  },
  profile_percentile_cards: {
    headline: {
      en: 'Why am I seeing these percentiles?',
      es: '¿Por qué veo estos percentiles?',
    },
    summary: {
      en: 'A private comparison against an anonymous cohort of active MX observers — only you see this card.',
      es: 'Una comparación privada contra una cohorte anónima de observadores activos en MX — solo tú la ves.',
    },
    copy: {
      en: {
        inputs: [
          'Cohort definition: users with ≥ 5 observations in the last 90 days, country MX',
          'Your four metrics: Shannon diversity, distinct habitats, validations cast, geographic spread (km²)',
          'Each percentile is your rank within the cohort for that one metric',
          'Hidden when the cohort is too small (n < 50) — no rank shown until the comparison is meaningful',
          'No public leaderboard — these numbers never leave your screen',
        ],
        window: 'Last 90 days for the cohort; metrics are recomputed on each page visit',
        settings_label: 'Privacy & leaderboards settings',
      },
      es: {
        inputs: [
          'Definición de cohorte: usuarios con ≥ 5 observaciones en los últimos 90 días, país MX',
          'Tus cuatro métricas: diversidad de Shannon, hábitats distintos, validaciones, alcance geográfico (km²)',
          'Cada percentil es tu rango dentro de la cohorte para esa única métrica',
          'Se oculta si la cohorte es muy pequeña (n < 50) — no se muestra rango hasta que la comparación sea significativa',
          'Sin tabla pública — estos números no salen de tu pantalla',
        ],
        window: 'Últimos 90 días para la cohorte; las métricas se recalculan en cada visita a la página',
        settings_label: 'Privacidad y leaderboards',
      },
    },
    settings_path: {
      en: routes.profileSettingsPrivacy.en,
      es: routes.profileSettingsPrivacy.es,
    },
  },
  active_observers_today: {
    headline: {
      en: 'Why am I seeing this banner?',
      es: '¿Por qué veo este banner?',
    },
    summary: {
      en: 'A non-personal count of distinct observers in your country who have synced at least one observation today.',
      es: 'Un conteo no personalizado de observadores distintos en tu país que han sincronizado al menos una observación hoy.',
    },
    copy: {
      en: {
        inputs: [
          'Country code from your profile (or inferred from your most-used region)',
          'Distinct count of observers who synced ≥ 1 public observation since 00:00 UTC today',
          'Aggregate only — no observer IDs, names, or locations are surfaced',
          'Banner is hidden entirely when no profile country is set (never shows "in NULL")',
        ],
        window: 'Today (UTC) — resets at 00:00 UTC each day',
        settings_label: 'Edit profile (country)',
      },
      es: {
        inputs: [
          'Código de país de tu perfil (o inferido de tu región más usada)',
          'Conteo distinto de observadores que sincronizaron ≥ 1 observación pública desde las 00:00 UTC de hoy',
          'Solo agregado — no se exponen IDs, nombres ni ubicaciones de observadores',
          'El banner se oculta cuando no hay país en el perfil (nunca muestra "en NULL")',
        ],
        window: 'Hoy (UTC) — reinicia a las 00:00 UTC cada día',
        settings_label: 'Editar perfil (país)',
      },
    },
    settings_path: {
      en: routes.profileEdit.en,
      es: routes.profileEdit.es,
    },
  },
  home_recent_nearby: {
    headline: {
      en: 'Why am I seeing these observations?',
      es: '¿Por qué veo estas observaciones?',
    },
    summary: {
      en: 'Most recent observations from observers in your country, with a global fallback if there are fewer than 3.',
      es: 'Observaciones más recientes de personas en tu país, con respaldo global si hay menos de 3.',
    },
    copy: {
      en: {
        inputs: [
          'Sync timestamp (most recent first)',
          'Country code from your profile (used to scope to nearby observers)',
          'Public visibility (private observations are excluded)',
          'No engagement signals — order does not depend on likes, IDs, or follows',
        ],
        window: 'Top 3 most recent synced public observations',
        settings_label: 'Profile country & privacy settings',
      },
      es: {
        inputs: [
          'Marca de tiempo de sincronización (más recientes primero)',
          'Código de país de tu perfil (se usa para limitar a personas cercanas)',
          'Visibilidad pública (las observaciones privadas se excluyen)',
          'Sin señales de engagement — el orden no depende de likes, IDs ni seguidores',
        ],
        window: 'Las 3 observaciones públicas sincronizadas más recientes',
        settings_label: 'País del perfil y privacidad',
      },
    },
    settings_path: {
      en: routes.profileEdit.en,
      es: routes.profileEdit.es,
    },
  },
};

export function getAlgorithm(id: AlgorithmId): AlgorithmEntry {
  return ALGORITHMS[id];
}
