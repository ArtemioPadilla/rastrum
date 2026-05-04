import { describe, it, expect, vi } from 'vitest';
import { checkAnonRateLimit } from '../../supabase/functions/_shared/anon-rate-limit';

function fakeDb(rows: Array<{ ip: string; endpoint: string; ts: string }>): unknown {
  return {
    from: (table: string) => ({
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        let filtered = rows.filter(() => true);
        const chain = {
          eq(col: string, val: string) {
            filtered = filtered.filter(r => (r as Record<string, string>)[col] === val);
            return chain;
          },
          gte(col: string, val: string) {
            filtered = filtered.filter(r => (r as Record<string, string>)[col] >= val);
            return chain;
          },
          then(cb: (v: unknown) => void) {
            cb({ count: opts?.head ? filtered.length : undefined, error: null });
          },
        };
        return chain;
      },
      insert: (row: { ip: string; endpoint: string }) => {
        rows.push({ ...row, ts: new Date().toISOString() });
        return { error: null };
      },
    }),
  };
}

describe('checkAnonRateLimit (#581)', () => {
  it('allows the call when under limit and inserts a row', async () => {
    const rows: Array<{ ip: string; endpoint: string; ts: string }> = [];
    const db = fakeDb(rows) as Parameters<typeof checkAnonRateLimit>[0];
    const ok = await checkAnonRateLimit(db, '1.2.3.4', 'identify', 10, 3600);
    expect(ok).toBe(true);
    expect(rows.length).toBe(1);
  });

  it('denies when count is at limit', async () => {
    const now = new Date().toISOString();
    const rows = Array.from({ length: 10 }, () => ({ ip: '1.2.3.4', endpoint: 'identify', ts: now }));
    const db = fakeDb(rows) as Parameters<typeof checkAnonRateLimit>[0];
    const ok = await checkAnonRateLimit(db, '1.2.3.4', 'identify', 10, 3600);
    expect(ok).toBe(false);
  });

  it('different endpoint counters are independent', async () => {
    const now = new Date().toISOString();
    const rows = Array.from({ length: 10 }, () => ({ ip: '1.2.3.4', endpoint: 'identify', ts: now }));
    const db = fakeDb(rows) as Parameters<typeof checkAnonRateLimit>[0];
    const ok = await checkAnonRateLimit(db, '1.2.3.4', 'follow', 10, 3600);
    expect(ok).toBe(true);
  });

  it('different IPs are independent', async () => {
    const now = new Date().toISOString();
    const rows = Array.from({ length: 10 }, () => ({ ip: '1.2.3.4', endpoint: 'identify', ts: now }));
    const db = fakeDb(rows) as Parameters<typeof checkAnonRateLimit>[0];
    const ok = await checkAnonRateLimit(db, '5.6.7.8', 'identify', 10, 3600);
    expect(ok).toBe(true);
  });
});
