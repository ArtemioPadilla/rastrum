import type { SupabaseClient } from '@supabase/supabase-js';

export interface PoolAnalytics {
  poolId: string;
  totalCap: number;
  used: number;
  pctUsed: number;
  uniqueUsers: number;
  topTaxa: Array<{
    scientific_name: string;
    common_name: string | null;
    kingdom: string;
    count: number;
  }>;
  dailyUsage: Array<{
    date: string;
    calls: number;
  }>;
}

/** Shape returned by the pool_top_taxa RPC. */
interface RpcTaxaRow {
  scientific_name: string;
  common_name: string | null;
  kingdom: string;
  count: number;
}

/** Shape returned by the pool_daily_usage RPC. */
interface RpcDailyRow {
  date: string;
  calls: number;
}

/** Shape returned by the pool_unique_users RPC. */
interface RpcUniqueUsersRow {
  unique_users: number;
}

/**
 * Fetch analytics for a single sponsor pool.
 *
 * Accepts a Supabase client so the caller controls auth context and the
 * function stays testable (no singleton import).
 */
export async function fetchPoolAnalytics(
  supabase: SupabaseClient,
  poolId: string,
): Promise<PoolAnalytics | null> {
  // Pool metadata
  const { data: pool } = await supabase
    .from('sponsor_pools')
    .select('id, total_cap, used')
    .eq('id', poolId)
    .single();

  if (!pool) return null;

  const typedPool = pool as { id: string; total_cap: number; used: number };

  // Top taxa detected via this pool
  const { data: taxa } = await supabase.rpc('pool_top_taxa', { p_pool_id: poolId });

  // Daily usage histogram
  const { data: daily } = await supabase.rpc('pool_daily_usage', { p_pool_id: poolId });

  // Unique beneficiary count
  const { data: usersData } = await supabase.rpc('pool_unique_users', { p_pool_id: poolId });

  const uniqueUsersRow = (usersData as RpcUniqueUsersRow[] | null)?.[0];
  const uniqueUsers = uniqueUsersRow?.unique_users ?? 0;

  const topTaxa: PoolAnalytics['topTaxa'] = ((taxa as RpcTaxaRow[] | null) ?? [])
    .slice(0, 10)
    .map((row) => ({
      scientific_name: row.scientific_name,
      common_name: row.common_name ?? null,
      kingdom: row.kingdom ?? '',
      count: row.count,
    }));

  const dailyUsage: PoolAnalytics['dailyUsage'] = ((daily as RpcDailyRow[] | null) ?? [])
    .map((row) => ({ date: row.date, calls: row.calls }));

  return {
    poolId: typedPool.id,
    totalCap: typedPool.total_cap,
    used: typedPool.used,
    pctUsed: typedPool.total_cap > 0
      ? (typedPool.used / typedPool.total_cap) * 100
      : 0,
    uniqueUsers,
    topTaxa,
    dailyUsage,
  };
}

/**
 * Pure helper: aggregate raw usage rows into daily buckets.
 * Exported for unit testing.
 */
export function aggregateDailyUsage(
  rows: ReadonlyArray<{ created_at: string }>,
): Array<{ date: string; calls: number }> {
  const dailyMap = new Map<string, number>();
  for (const row of rows) {
    const date = row.created_at.slice(0, 10);
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
  }
  return Array.from(dailyMap.entries())
    .map(([date, calls]) => ({ date, calls }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Pure helper: count unique values in a field.
 * Exported for unit testing.
 */
export function countUniqueUsers(
  rows: ReadonlyArray<{ beneficiary_id: string }>,
): number {
  return new Set(rows.map((r) => r.beneficiary_id)).size;
}
