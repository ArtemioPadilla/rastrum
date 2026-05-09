import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const observationSpec: EntitySpec = {
  kind: 'observation',
  icon: '🔍',
  label: { en: 'Observation', es: 'Observación' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'observation',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_species'],
};
