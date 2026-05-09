/**
 * Generic entity-context registry — mirrors src/lib/identifiers/types.ts.
 * One EntitySpec per kind; the runtime serializes a fetched card into a
 * system-prompt block and uses `related` pointers as tool args.
 */

export type EntityKind =
  | 'observation'
  | 'species'
  | 'project'
  | 'camera_station'
  | 'observer'
  | 'self_profile';

export interface EntityCard {
  kind: EntityKind;
  id: string;
  label: string;
  thumbnail?: string | null;
  summary_text: string;
  fields: Record<string, string | number | boolean | null>;
  suggested_questions: string[];
  related: {
    project_id?: string;
    primary_taxon_id?: string;
    location_id?: string;
    observer_id?: string;
  };
}

export interface EntitySpec {
  kind: EntityKind;
  /** Emoji or short brand icon shown in the chip. */
  icon: string;
  /** EN/ES short label for tabs/menus. */
  label: { en: string; es: string };
  /**
   * Fetch the canonical card for the given id. Implementations call
   * supabase.rpc('chat_entity_card', { p_kind, p_id }) and shape the
   * response. Throws on network error; returns null when the row is
   * missing or RLS hides it.
   */
  fetchCard(id: string): Promise<EntityCard | null>;
  /**
   * Tools this entity kind tends to need. Used to pre-prime the
   * tool list shown to the model in the system prompt.
   */
  suggestedTools: string[];
}

export interface ChatEntityRegistry {
  register(spec: EntitySpec): void;
  get(kind: EntityKind): EntitySpec | undefined;
  list(): EntitySpec[];
}
