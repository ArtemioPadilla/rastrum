import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const selfProfileSpec: EntitySpec = {
  kind: 'self_profile',
  icon: '🪪',
  label: { en: 'My profile', es: 'Mi perfil' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'self_profile',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations'],
};
