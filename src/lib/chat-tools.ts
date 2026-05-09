/**
 * Typed JSON tool layer for chat. Each tool wraps one Supabase RPC and
 * exposes a hand-rolled validator (no Zod dependency). The model emits
 * `{"tool": "<name>", "args": { ... }}`; the runtime parses, validates,
 * dispatches, and feeds the result back to the model as a tool message.
 *
 * Errors returned (never thrown):
 *   { error: 'unknown_tool' }   — name not in the registry
 *   { error: 'invalid_args' }   — failed validateArgs(); detail in `detail`
 *   { error: 'network' }        — supabase returned an error
 *   { error: 'offline' }        — fetch threw (network down)
 */
import { getSupabase } from './supabase';

export type ToolResult =
  | { ok: true; data: unknown }
  | { error: 'unknown_tool' }
  | { error: 'invalid_args'; detail: string }
  | { error: 'network'; detail: string }
  | { error: 'offline'; detail: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON schema-ish description for the system prompt. */
  args_schema: Record<string, string>;
  validateArgs(args: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };
  run(args: Record<string, unknown>): Promise<unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function rpcCall(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await getSupabase().rpc(fn, args);
  if (r.error) throw new Error('NETWORK:' + r.error.message);
  return r.data;
}

const findObservations: ToolDef = {
  name: 'find_observations',
  description: 'Search observations the signed-in user can see, with optional filters.',
  args_schema: {
    'p_filters': 'object — { owner?: "me", primary_taxon_id?: uuid, project_id?: uuid, near_observation_id?: uuid, radius_km?: number, research_grade?: boolean }',
    'p_limit':   'number — 1..50, default 10',
  },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    const { p_filters, p_limit } = args;
    if (p_filters !== undefined && !isObject(p_filters)) return { ok: false, reason: 'p_filters must be an object' };
    if (p_filters && isObject(p_filters)) {
      if ('radius_km' in p_filters && typeof p_filters.radius_km !== 'number') {
        return { ok: false, reason: 'radius_km must be a number' };
      }
      if ('research_grade' in p_filters && typeof p_filters.research_grade !== 'boolean') {
        return { ok: false, reason: 'research_grade must be a boolean' };
      }
    }
    if (p_limit !== undefined && typeof p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_filters: p_filters ?? {}, p_limit: (p_limit as number) ?? 10 } };
  },
  run(args) {
    return rpcCall('chat_find_observations', args);
  },
};

const findSpecies: ToolDef = {
  name: 'find_species',
  description: 'Search the taxonomy by canonical/scientific/common name.',
  args_schema: { p_query: 'string', p_limit: 'number — 1..50, default 10' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_query !== 'string' || !args.p_query.trim()) return { ok: false, reason: 'p_query must be a non-empty string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_query: args.p_query, p_limit: (args.p_limit as number) ?? 10 } };
  },
  run(args) { return rpcCall('chat_find_species', args); },
};

const findProjects: ToolDef = {
  name: 'find_projects',
  description: 'Search projects by name or slug.',
  args_schema: { p_query: 'string', p_limit: 'number — 1..50, default 10' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_query !== 'string' || !args.p_query.trim()) return { ok: false, reason: 'p_query must be a non-empty string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_query: args.p_query, p_limit: (args.p_limit as number) ?? 10 } };
  },
  run(args) { return rpcCall('chat_find_projects', args); },
};

const findCameraStations: ToolDef = {
  name: 'find_camera_stations',
  description: 'List camera stations for a given project id.',
  args_schema: { p_project_id: 'uuid', p_limit: 'number — 1..50, default 20' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_project_id !== 'string') return { ok: false, reason: 'p_project_id must be a uuid string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_project_id: args.p_project_id, p_limit: (args.p_limit as number) ?? 20 } };
  },
  run(args) { return rpcCall('chat_find_camera_stations', args); },
};

const findObservers: ToolDef = {
  name: 'find_observers',
  description: 'Search observers by username or display name (public profiles only).',
  args_schema: { p_query: 'string', p_limit: 'number — 1..50, default 10' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_query !== 'string' || !args.p_query.trim()) return { ok: false, reason: 'p_query must be a non-empty string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_query: args.p_query, p_limit: (args.p_limit as number) ?? 10 } };
  },
  run(args) { return rpcCall('chat_find_observers', args); },
};

const REGISTRY: Record<string, ToolDef> = {
  find_observations:    findObservations,
  find_species:         findSpecies,
  find_projects:        findProjects,
  find_camera_stations: findCameraStations,
  find_observers:       findObservers,
};

export function listTools(): ToolDef[] {
  return Object.values(REGISTRY);
}

/** Stringified tool catalogue suitable for inclusion in the system prompt. */
export function toolDefinitions(): string {
  return JSON.stringify(
    listTools().map(t => ({ name: t.name, description: t.description, args: t.args_schema })),
    null,
    2,
  );
}

export async function runTool(call: { name: string; args: unknown }): Promise<ToolResult> {
  const def = REGISTRY[call.name];
  if (!def) return { error: 'unknown_tool' };
  const v = def.validateArgs(call.args);
  if (!v.ok) return { error: 'invalid_args', detail: v.reason };
  try {
    const data = await def.run(v.value);
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('NETWORK:')) return { error: 'network', detail: msg.slice(8) };
    return { error: 'offline', detail: msg };
  }
}
