import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const projectSpec: EntitySpec = {
  kind: 'project',
  icon: '🗺️',
  label: { en: 'Project', es: 'Proyecto' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'project',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_camera_stations'],
};
