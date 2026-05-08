/**
 * Client-side PlantNet daily usage counter.
 *
 * PlantNet's rate-limit headers are not forwarded through the identify
 * Edge Function (supabase.functions.invoke strips HTTP metadata), so we
 * track usage locally: increment on each successful call and reset at
 * midnight UTC. The fixed daily_limit of 500 matches the free-tier quota.
 *
 * Storage key: 'rastrum.plantnet.quota'
 * Shape: { used: number; day: string; }   (day = YYYY-MM-DD UTC)
 */

export interface PlantNetQuota {
  used_today: number;
  daily_limit: number;
  reset_at?: string;
}

const KEY = 'rastrum.plantnet.quota';
const DAILY_LIMIT = 500;

interface Stored {
  used: number;
  day: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { used: 0, day: todayUtc() };
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'used' in parsed &&
      'day' in parsed &&
      typeof (parsed as Stored).used === 'number' &&
      typeof (parsed as Stored).day === 'string'
    ) {
      return parsed as Stored;
    }
  } catch { /* corrupt entry — start fresh */ }
  return { used: 0, day: todayUtc() };
}

function write(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage full — non-blocking */ }
}

export function getPlantNetQuota(): PlantNetQuota | null {
  try {
    const stored = read();
    const today = todayUtc();
    const used = stored.day === today ? stored.used : 0;
    const resetAt = `${today}T23:59:59Z`;
    return { used_today: used, daily_limit: DAILY_LIMIT, reset_at: resetAt };
  } catch {
    return null;
  }
}

export function incrementPlantNetQuota(): void {
  try {
    const today = todayUtc();
    const stored = read();
    const used = stored.day === today ? stored.used + 1 : 1;
    write({ used, day: today });
  } catch { /* non-blocking */ }
}
