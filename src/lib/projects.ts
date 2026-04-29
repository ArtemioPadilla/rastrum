/**
 * Client helpers for the M29 Projects module. Reads use the
 * `projects_with_geojson` view (RLS-respecting). Writes use the
 * `upsert_project` RPC because PostgREST can't encode WKB geography
 * back from a JSON payload.
 */
import { getSupabase } from './supabase';

export type ProjectVisibility = 'public' | 'private';

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  name_es: string | null;
  description: string | null;
  description_es: string | null;
  visibility: ProjectVisibility;
  owner_user_id: string;
  polygon_geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  area_km2: number;
  created_at: string;
  updated_at: string;
}

export async function listProjects(opts: { ownerUserId?: string } = {}): Promise<ProjectRow[]> {
  const sb = getSupabase();
  let q = sb.from('projects_with_geojson').select('*').order('updated_at', { ascending: false });
  if (opts.ownerUserId) q = q.eq('owner_user_id', opts.ownerUserId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectRow[];
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('projects_with_geojson')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProjectRow | null) ?? null;
}

export interface UpsertProjectInput {
  slug: string;
  name: string;
  name_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  visibility: ProjectVisibility;
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export async function upsertProject(input: UpsertProjectInput): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('upsert_project', {
    p_slug: input.slug,
    p_name: input.name,
    p_name_es: input.name_es ?? null,
    p_description: input.description ?? null,
    p_description_es: input.description_es ?? null,
    p_visibility: input.visibility,
    p_polygon_geojson: input.polygon as unknown as Record<string, unknown>,
  });
  if (error) {
    if (error.code === '23505') throw new Error('slug_taken');
    if (error.code === '22023') throw new Error('invalid_polygon');
    throw new Error(error.message);
  }
  return data as string;
}

export async function countProjectObservations(projectId: string): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb
    .from('observations')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Validate a parsed JSON object as a GeoJSON Polygon or MultiPolygon.
 * Pure helper — exported for unit testing without Supabase.
 */
export function validatePolygonGeoJSON(input: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as { type?: unknown; coordinates?: unknown };
  if (o.type !== 'Polygon' && o.type !== 'MultiPolygon') return null;
  if (!Array.isArray(o.coordinates) || o.coordinates.length === 0) return null;
  if (o.type === 'Polygon') {
    const ring = (o.coordinates as unknown[])[0];
    if (!Array.isArray(ring) || ring.length < 4) return null;
  } else {
    const poly = (o.coordinates as unknown[])[0];
    if (!Array.isArray(poly) || poly.length === 0) return null;
  }
  return input as GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/**
 * Slug regex matching the SQL CHECK constraint:
 *   ^[a-z0-9][a-z0-9-]{1,63}$
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(slug);
}
