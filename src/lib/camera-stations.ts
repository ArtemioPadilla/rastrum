/**
 * Client helpers for the M31 camera-stations module.
 * RLS gates writes to project owners (see schema policies).
 */
import { getSupabase } from './supabase';

export interface CameraStationRow {
  id: string;
  project_id: string;
  station_key: string;
  name: string;
  name_es: string | null;
  habitat: string | null;
  camera_model: string | null;
  notes: string | null;
  created_at: string;
}

export interface CameraStationPeriodRow {
  id: string;
  station_id: string;
  start_date: string;       // YYYY-MM-DD
  end_date: string | null;  // NULL = "still active"
  notes: string | null;
}

export async function listProjectStations(projectId: string): Promise<CameraStationRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('camera_stations')
    .select('id, project_id, station_key, name, name_es, habitat, camera_model, notes, created_at')
    .eq('project_id', projectId)
    .order('station_key', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CameraStationRow[];
}

export async function listStationPeriods(stationId: string): Promise<CameraStationPeriodRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('camera_station_periods')
    .select('id, station_id, start_date, end_date, notes')
    .eq('station_id', stationId)
    .order('start_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CameraStationPeriodRow[];
}

export interface CreateStationInput {
  project_id: string;
  station_key: string;
  name: string;
  name_es?: string | null;
  lat: number;
  lng: number;
  habitat?: string | null;
  camera_model?: string | null;
  notes?: string | null;
}

export async function createStation(input: CreateStationInput): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('camera_stations')
    .insert({
      project_id:   input.project_id,
      station_key:  input.station_key,
      name:         input.name,
      name_es:      input.name_es ?? null,
      coords:       `SRID=4326;POINT(${input.lng} ${input.lat})`,
      habitat:      input.habitat ?? null,
      camera_model: input.camera_model ?? null,
      notes:        input.notes ?? null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('station_key_taken');
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

export async function createPeriod(input: {
  station_id: string;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
}): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('camera_station_periods')
    .insert({
      station_id: input.station_id,
      start_date: input.start_date,
      end_date:   input.end_date ?? null,
      notes:      input.notes ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function closePeriod(periodId: string, end_date: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from('camera_station_periods')
    .update({ end_date })
    .eq('id', periodId);
  if (error) throw new Error(error.message);
}

/**
 * Server-side trap-night count via the SQL helper. Returns 0 when
 * the station has no periods or the RPC fails.
 */
export async function trapNights(stationId: string, opts: { from?: string; to?: string } = {}): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('station_trap_nights', {
    p_station_id: stationId,
    p_from: opts.from ?? null,
    p_to:   opts.to   ?? null,
  });
  if (error) return 0;
  return Number(data ?? 0);
}

/** station_key regex matching the spec — same shape as project slug. */
export function isValidStationKey(key: string): boolean {
  return key.length >= 1 && key.length <= 64 && /^[A-Za-z0-9_-]+$/.test(key);
}
