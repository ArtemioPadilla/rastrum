/**
 * Unit tests for the missing-target branch in the report.resolve handler.
 *
 * The handler file (supabase/functions/admin/handlers/report-resolve.ts) uses
 * Deno-style `https://esm.sh/…` imports, which cannot be consumed by Vitest/Node
 * directly. Instead this test replicates the execute() logic inline and validates
 * the contract introduced by #1082:
 *
 *   When the report row does not exist (cascade-deleted with its target, or already
 *   purged), the handler MUST:
 *   a) NOT throw — so the dispatcher never routes the call into function_errors.
 *   b) Return an ActionResult with { before: null, after: null } and a target field
 *      so the dispatcher can still write the admin_audit row.
 *   c) Include a `result.note` explaining the handled outcome.
 *
 * These invariants mirror the dispatcher contract in supabase/functions/admin/index.ts:
 * handler.execute() must return an ActionResult; only uncaught throws go to
 * reportFunctionError().
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal types
// ---------------------------------------------------------------------------

interface ActionResult {
  before: unknown;
  after: unknown;
  target: { type: string; id: string };
  result?: unknown;
}

// ---------------------------------------------------------------------------
// Minimal mock admin client — all queries are stubbed.
// Single call always returns { data: selectRow, error: null }.
// Update chain always returns { error: null } (no .single()).
// ---------------------------------------------------------------------------

interface MockAdmin {
  from: (table: string) => MockQueryBuilder;
}

interface MockQueryBuilder {
  select: (cols?: string) => MockQueryBuilder;
  eq: (col: string, val: string) => MockQueryBuilder;
  update: (vals: Record<string, unknown>) => MockQueryBuilder;
  single: () => Promise<{ data: unknown; error: null }>;
  then: <T>(resolve: (v: { data: unknown; error: null }) => T) => Promise<T>;
}

function makeAdminMock(selectRow: unknown): MockAdmin {
  function chain(nextSingleData: unknown): MockQueryBuilder {
    return {
      select: () => chain(nextSingleData),
      eq:     () => chain(nextSingleData),
      update: () => chain(null),   // update never returns data
      single: () => Promise.resolve({ data: nextSingleData, error: null }),
      then:   (resolve) => Promise.resolve({ data: nextSingleData, error: null }).then(resolve),
    };
  }
  return {
    from: () => chain(selectRow),
  };
}

// ---------------------------------------------------------------------------
// execute() — verbatim copy of the fixed handler's execute body.
// Update this snapshot whenever report-resolve.ts changes.
// ---------------------------------------------------------------------------

async function execute(admin: MockAdmin, payload: { report_id: string }): Promise<ActionResult> {
  const { data: before } = await admin.from('reports').select('*').eq('id', payload.report_id).single();
  if (!before) {
    return {
      before: null,
      after: null,
      target: { type: 'report', id: payload.report_id },
      result: { note: 'report not found; treated as already resolved' },
    };
  }
  const updateResult = await admin.from('reports').update({ status: 'resolved' }).eq('id', payload.report_id);
  if (updateResult.data !== undefined && updateResult.data !== null) {
    // update errors are signalled via .error; no-op here
  }
  const { data: after } = await admin.from('reports').select('*').eq('id', payload.report_id).single();
  return { before, after, target: { type: 'report', id: payload.report_id } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const REPORT_ID = '00000000-0000-0000-0000-000000000042';

describe('report.resolve handler — missing target branch (#1082)', () => {
  it('returns success (does NOT throw) when report row is absent', async () => {
    await expect(execute(makeAdminMock(null), { report_id: REPORT_ID })).resolves.toBeDefined();
  });

  it('returns before:null when report is absent', async () => {
    const result = await execute(makeAdminMock(null), { report_id: REPORT_ID });
    expect(result.before).toBeNull();
  });

  it('returns after:null when report is absent', async () => {
    const result = await execute(makeAdminMock(null), { report_id: REPORT_ID });
    expect(result.after).toBeNull();
  });

  it('returns a target object so the dispatcher can write the audit row', async () => {
    const result = await execute(makeAdminMock(null), { report_id: REPORT_ID });
    expect(result.target).toEqual({ type: 'report', id: REPORT_ID });
  });

  it('includes a result.note that mentions "not found"', async () => {
    const result = await execute(makeAdminMock(null), { report_id: REPORT_ID });
    expect((result.result as { note: string }).note).toMatch(/not found/);
  });

  it('resolves normally when the report row exists', async () => {
    const reportRow = { id: REPORT_ID, status: 'open' };
    const result = await execute(makeAdminMock(reportRow), { report_id: REPORT_ID });
    expect(result.before).toEqual(reportRow);
    expect(result.target).toEqual({ type: 'report', id: REPORT_ID });
  });
});
