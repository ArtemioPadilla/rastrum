import type { EntityKind } from './chat-entities/types';

const KINDS: ReadonlySet<EntityKind> = new Set([
  'observation', 'species', 'project', 'camera_station', 'observer', 'self_profile',
]);

export function parseAttachQuerystring(value: string | null): { kind: EntityKind; id: string } | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon <= 0 || colon === value.length - 1) return null;
  const kind = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (!KINDS.has(kind as EntityKind)) return null;
  if (!id) return null;
  return { kind: kind as EntityKind, id };
}
