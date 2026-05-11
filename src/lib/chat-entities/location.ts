import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const locationSpec: EntitySpec = {
  kind: 'location',
  icon: '📍',
  label: { en: 'Location', es: 'Lugar' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'location',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_location', 'find_observations'],
};
