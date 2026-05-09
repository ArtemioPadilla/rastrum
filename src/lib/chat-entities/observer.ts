import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const observerSpec: EntitySpec = {
  kind: 'observer',
  icon: '👤',
  label: { en: 'Observer', es: 'Observador' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'observer',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_species'],
};
