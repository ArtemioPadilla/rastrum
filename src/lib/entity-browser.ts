/**
 * entity-browser.ts — runtime helper used by ConsoleEntityBrowser.astro.
 *
 * Each PR16 entity browser (Identifications, Notifications, Media, Follows,
 * Watchlists, Projects) instantiates an EntityBrowser with a config object
 * describing its columns, filters, and the supabase table to query.
 *
 * Design contract:
 *   - SELECT only the listed columns (never *).
 *   - Server-side pagination via .range(start, end), 50 rows / page default.
 *   - count: 'exact' on filter changes only; cached between page flips.
 *   - URL-driven filter state via console-filter-state helpers.
 *   - Drill-down expansion is lazy: details fetched on click.
 *   - Auto-populated dropdowns over the last 90 days, capped at 2000.
 */
import { getSupabase } from './supabase';
import { escapeHtml } from './escape';
import { readFilterState, writeFilterState } from './console-filter-state';

export type FilterKind = 'text' | 'select' | 'date' | 'autocomplete' | 'segmented';

export interface FilterSpec {
  /** URL parameter key + form element id suffix */
  key: string;
  /** Human label (already-translated) */
  label: string;
  kind: FilterKind;
  /** For 'select' kind: static options; auto-populated dropdowns leave undefined and set autoPopulate */
  options?: Array<{ value: string; label: string }>;
  /**
   * For autoPopulate: read distinct values of this column over the last 90 days.
   * Capped at 2000 rows.
   */
  autoPopulateColumn?: string;
  /**
   * For 'autocomplete': remote lookup function returning matching values.
   */
  resolve?: (input: string) => Promise<string | undefined>;
  placeholder?: string;
  /**
   * supabase-js predicate builder — receives the running query and the
   * current filter value (string), returns the modified query.
   * Predicates short-circuit to an empty rowset by returning null.
   */
  apply: (query: SupabaseQuery, value: string) => Promise<SupabaseQuery | null> | (SupabaseQuery | null);
}

/** Render-side type for one column. `render` returns a trusted HTML fragment (escape your inputs). */
export interface ColumnSpec<Row> {
  key: string;
  label: string;
  /** Right-align numeric columns */
  align?: 'left' | 'right';
  /** CSS class name applied to the <th> + <td> for width control */
  cellClass?: string;
  render: (row: Row, ctx: RenderContext) => string;
}

/** Resolved foreign-key context (users by id, taxa by id) cached across renders. */
export interface RenderContext {
  users: Record<string, { username: string | null; display_name: string | null }>;
  taxa: Record<string, { scientific_name: string | null }>;
  lang: 'en' | 'es';
}

export interface BrowserConfig<Row extends { id?: string; [k: string]: unknown }> {
  /** DOM id-prefix scoping all elements in this browser (required, must be unique per page) */
  prefix: string;
  /** supabase table name (or view) */
  tableName: string;
  /** Comma-separated SELECT clause (only columns the table renders + lookups) */
  selectClause: string;
  /** Column to order by, descending */
  orderBy: string;
  /** Per-page row count. Defaults to 50. */
  pageSize?: number;
  /** Column specs */
  columns: ColumnSpec<Row>[];
  /** Filter specs */
  filters: FilterSpec[];
  /** Resolve user id → display fields (username/display_name). Optional if browser doesn't render users. */
  resolveUsersFromRow?: (row: Row) => string[];
  /** Resolve taxon id → scientific_name. Optional. */
  resolveTaxaFromRow?: (row: Row) => string[];
  /** Renders the drill-down panel for a row. */
  renderDrilldown?: (row: Row, ctx: RenderContext) => string;
  /**
   * For tables with composite primary keys (e.g. `follows` keyed on
   * (follower_id, followee_id)), synthesise a stable per-row id so the
   * EntityBrowser's drill-down expansion state survives re-renders.
   * Falls back to `row.id` when omitted.
   */
  rowIdFromRow?: (row: Row) => string;
  /** Empty-state text. */
  emptyText: string;
  /** Loading-state text. */
  loadingText: string;
  /** Locale (en | es). */
  lang: 'en' | 'es';
}

// Minimal supabase-js PostgrestFilterBuilder slice — typed as `unknown` so this
// file doesn't depend on a specific supabase-js version. Each FilterSpec.apply
// implementation casts to the right shape internally.
export type SupabaseQuery = {
  eq: (column: string, value: unknown) => SupabaseQuery;
  ilike: (column: string, pattern: string) => SupabaseQuery;
  gte: (column: string, value: unknown) => SupabaseQuery;
  lte: (column: string, value: unknown) => SupabaseQuery;
  in: (column: string, values: unknown[]) => SupabaseQuery;
  is: (column: string, value: unknown) => SupabaseQuery;
  not: (column: string, op: string, value: unknown) => SupabaseQuery;
  range: (from: number, to: number) => SupabaseQuery;
  order: (column: string, opts?: { ascending?: boolean }) => SupabaseQuery;
  limit: (n: number) => SupabaseQuery;
};

/**
 * Filter-to-supabase-query translator. Pure — takes an empty query, applies
 * each filter that has a non-empty value, returns the resulting query.
 * Used by EntityBrowser internally and exported for unit-testing.
 */
export async function applyFilters(
  query: SupabaseQuery,
  filters: FilterSpec[],
  values: Record<string, string>,
): Promise<SupabaseQuery | null> {
  let q: SupabaseQuery | null = query;
  for (const f of filters) {
    const v = values[f.key];
    if (!v || v === '') continue;
    q = await f.apply(q, v);
    if (q === null) return null;
  }
  return q;
}

/** Common filter primitives for use in FilterSpec.apply callbacks. */
export const filterPredicates = {
  eq:
    (column: string) =>
    (q: SupabaseQuery, v: string): SupabaseQuery =>
      q.eq(column, v),
  ilike:
    (column: string) =>
    (q: SupabaseQuery, v: string): SupabaseQuery =>
      q.ilike(column, `%${v}%`),
  gteDate:
    (column: string) =>
    (q: SupabaseQuery, v: string): SupabaseQuery =>
      q.gte(column, v),
  lteDate:
    (column: string) =>
    (q: SupabaseQuery, v: string): SupabaseQuery =>
      q.lte(column, v),
  isNull:
    (column: string) =>
    (q: SupabaseQuery, _v?: string): SupabaseQuery =>
      q.is(column, null),
  isNotNull:
    (column: string) =>
    (q: SupabaseQuery, _v?: string): SupabaseQuery =>
      q.not(column, 'is', null),
};

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

export function renderUserPill(
  id: string | null,
  ctx: RenderContext,
): string {
  if (!id) return '<span class="text-zinc-400">—</span>';
  const meta = ctx.users[id];
  if (meta?.username) return `<span class="text-zinc-700 dark:text-zinc-300">@${escapeHtml(meta.username)}</span>`;
  if (meta?.display_name) return `<span class="text-zinc-700 dark:text-zinc-300">${escapeHtml(meta.display_name)}</span>`;
  return `<span class="font-mono text-[10px] text-zinc-500">${escapeHtml(id.slice(0, 8))}…</span>`;
}

export function renderTaxonPill(id: string | null, fallback: string | null, ctx: RenderContext): string {
  if (id && ctx.taxa[id]?.scientific_name) {
    return `<span class="italic">${escapeHtml(ctx.taxa[id].scientific_name!)}</span>`;
  }
  if (fallback) return `<span class="italic text-zinc-600">${escapeHtml(fallback)}</span>`;
  return '<span class="text-zinc-400">—</span>';
}

/** Format ISO timestamp for table display. */
export function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 19);
}

/** Format a numeric byte count to human-readable form. */
export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  let v = n;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

export function confidencePill(c: number | null): string {
  if (c === null) return '<span class="text-zinc-400">—</span>';
  let cls = 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300';
  if (c >= 0.8) cls = 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300';
  else if (c >= 0.5) cls = 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300';
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-mono ${cls}">${c.toFixed(2)}</span>`;
}

// ---------------------------------------------------------------------------
// Browser runtime
// ---------------------------------------------------------------------------

interface PaginationState {
  page: number; // 0-indexed
  totalCount: number | null;
  pageSize: number;
}

interface InternalState<Row> {
  rows: Row[];
  ctx: RenderContext;
  pagination: PaginationState;
  expandedRows: Set<string>;
  /** Last-known filter values; used to detect when to refresh count. */
  lastFilterFingerprint: string;
}

export class EntityBrowser<Row extends { id?: string; [k: string]: unknown }> {
  private cfg: BrowserConfig<Row>;
  private st: InternalState<Row>;

  constructor(cfg: BrowserConfig<Row>) {
    this.cfg = cfg;
    this.st = {
      rows: [],
      ctx: { users: {}, taxa: {}, lang: cfg.lang },
      pagination: {
        page: 0,
        totalCount: null,
        pageSize: cfg.pageSize ?? 50,
      },
      expandedRows: new Set<string>(),
      lastFilterFingerprint: '',
    };
  }

  /** Bootstrap — call once after the DOM mounts. */
  async init(): Promise<void> {
    this.restoreFiltersFromUrl();
    this.wireFilterChangeHandlers();
    this.wirePaginationHandlers();
    await this.populateAutoDropdowns();
    await this.refresh(true);
  }

  private id(suffix: string): string {
    return `${this.cfg.prefix}-${suffix}`;
  }

  private $(suffix: string): HTMLElement | null {
    return document.getElementById(this.id(suffix));
  }

  private show(suffix: string): void {
    this.$(suffix)?.classList.remove('hidden');
  }
  private hide(suffix: string): void {
    this.$(suffix)?.classList.add('hidden');
  }

  private readFilterValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const f of this.cfg.filters) {
      const el = this.$(`f-${f.key}`) as HTMLInputElement | HTMLSelectElement | null;
      if (el) values[f.key] = el.value.trim();
    }
    return values;
  }

  private restoreFiltersFromUrl(): void {
    const saved = readFilterState();
    for (const f of this.cfg.filters) {
      const el = this.$(`f-${f.key}`) as HTMLInputElement | HTMLSelectElement | null;
      const v = saved[f.key];
      if (el && v !== undefined && v !== '') {
        el.value = v;
      }
    }
    if (saved.page) {
      const p = parseInt(saved.page, 10);
      if (Number.isFinite(p) && p >= 0) this.st.pagination.page = p;
    }
  }

  private persistFiltersToUrl(): void {
    const state: Record<string, string> = {};
    for (const f of this.cfg.filters) {
      const el = this.$(`f-${f.key}`) as HTMLInputElement | HTMLSelectElement | null;
      if (el && el.value) state[f.key] = el.value;
    }
    if (this.st.pagination.page > 0) state.page = String(this.st.pagination.page);
    writeFilterState(state);
  }

  private wireFilterChangeHandlers(): void {
    let timer: number | null = null;
    const debouncedRefresh = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.st.pagination.page = 0; // filter changes reset pagination
        void this.refresh(true);
      }, 200);
    };
    for (const f of this.cfg.filters) {
      const el = this.$(`f-${f.key}`);
      if (!el) continue;
      const ev = el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'date'
        ? 'change'
        : 'input';
      el.addEventListener(ev, debouncedRefresh);
    }
    const clearBtn = this.$('clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        for (const f of this.cfg.filters) {
          const el = this.$(`f-${f.key}`) as HTMLInputElement | HTMLSelectElement | null;
          if (el) el.value = '';
        }
        this.st.pagination.page = 0;
        void this.refresh(true);
      });
    }
  }

  private wirePaginationHandlers(): void {
    const prev = this.$('prev');
    const next = this.$('next');
    prev?.addEventListener('click', () => {
      if (this.st.pagination.page > 0) {
        this.st.pagination.page -= 1;
        void this.refresh(false);
      }
    });
    next?.addEventListener('click', () => {
      const { page, pageSize, totalCount } = this.st.pagination;
      const lastPage = totalCount !== null ? Math.max(0, Math.ceil(totalCount / pageSize) - 1) : page + 1;
      if (page < lastPage) {
        this.st.pagination.page += 1;
        void this.refresh(false);
      }
    });
  }

  private async populateAutoDropdowns(): Promise<void> {
    const supabase = getSupabase();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Group filters by their auto-populate column to issue one query per column.
    const cols = new Map<string, FilterSpec[]>();
    for (const f of this.cfg.filters) {
      if (!f.autoPopulateColumn) continue;
      if (!cols.has(f.autoPopulateColumn)) cols.set(f.autoPopulateColumn, []);
      cols.get(f.autoPopulateColumn)!.push(f);
    }

    for (const [col, fs] of cols.entries()) {
      const { data } = await supabase
        .from(this.cfg.tableName)
        .select(col)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000);

      const distinct = new Set<string>();
      for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const v = r[col];
        if (typeof v === 'string' && v) distinct.add(v);
      }
      const sorted = [...distinct].sort();
      for (const f of fs) {
        const sel = this.$(`f-${f.key}`) as HTMLSelectElement | null;
        if (!sel) continue;
        for (const v of sorted) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          sel.appendChild(opt);
        }
      }
    }
  }

  private fingerprint(values: Record<string, string>): string {
    return Object.keys(values)
      .sort()
      .map(k => `${k}=${values[k]}`)
      .join('&');
  }

  /** Load a page of rows. If filtersChanged, also refresh the count. */
  async refresh(filtersChanged: boolean): Promise<void> {
    const supabase = getSupabase();
    this.persistFiltersToUrl();
    this.show('skeleton');
    this.hide('error');
    this.hide('empty');
    this.hide('rows');

    const values = this.readFilterValues();
    const fingerprint = this.fingerprint(values);
    if (fingerprint !== this.st.lastFilterFingerprint) {
      // Filter set changed; force count refresh and reset pagination.
      filtersChanged = true;
      this.st.pagination.page = 0;
      this.st.lastFilterFingerprint = fingerprint;
    }

    const { page, pageSize } = this.st.pagination;
    const start = page * pageSize;
    const end = start + pageSize - 1;

    try {
      let q: SupabaseQuery | null;
      if (filtersChanged) {
        const built = supabase
          .from(this.cfg.tableName)
          .select(this.cfg.selectClause, { count: 'exact' });
        q = built as unknown as SupabaseQuery;
      } else {
        const built = supabase.from(this.cfg.tableName).select(this.cfg.selectClause);
        q = built as unknown as SupabaseQuery;
      }
      q = q.order(this.cfg.orderBy, { ascending: false });
      q = await applyFilters(q, this.cfg.filters, values);
      if (q === null) {
        // Filter resolved to "no possible rows" (e.g. unknown username)
        this.hide('skeleton');
        this.show('empty');
        this.renderPagination();
        return;
      }
      // Defensive: a buggy FilterSpec.apply that doesn't return the running
      // query will silently strip .range() off `q`. Detect it loudly here
      // instead of throwing the cryptic minified `r.range is not a function`.
      if (typeof (q as { range?: unknown }).range !== 'function') {
        const offendingKeys = Object.keys(values).filter(k => values[k]);
        console.warn(
          `entity-browser[${this.cfg.prefix}]: a filter.apply returned a non-query value (likely missing return). Active filters:`,
          offendingKeys,
        );
        throw new Error('Filter chain produced an invalid query. Clear filters and retry.');
      }
      q = q.range(start, end);
      const result = (await (q as unknown as Promise<{
        data: Row[] | null;
        error: { message: string } | null;
        count?: number | null;
      }>));

      if (result.error) throw new Error(result.error.message);
      this.st.rows = result.data ?? [];
      if (filtersChanged && typeof result.count === 'number') {
        this.st.pagination.totalCount = result.count;
      }

      await this.resolveLookups();
      this.hide('skeleton');
      if (this.st.rows.length === 0) {
        this.show('empty');
        this.renderPagination();
        return;
      }
      this.renderRows();
      this.renderPagination();
      this.show('rows');
    } catch (err) {
      this.hide('skeleton');
      this.showError((err as Error).message);
    }
  }

  private async resolveLookups(): Promise<void> {
    const supabase = getSupabase();
    if (this.cfg.resolveUsersFromRow) {
      const ids = new Set<string>();
      for (const r of this.st.rows) {
        for (const id of this.cfg.resolveUsersFromRow(r)) {
          if (id && !this.st.ctx.users[id]) ids.add(id);
        }
      }
      if (ids.size > 0) {
        const { data } = await supabase
          .from('users')
          .select('id, username, display_name')
          .in('id', [...ids]);
        for (const u of (data ?? []) as Array<{ id: string; username: string | null; display_name: string | null }>) {
          this.st.ctx.users[u.id] = { username: u.username, display_name: u.display_name };
        }
      }
    }
    if (this.cfg.resolveTaxaFromRow) {
      const ids = new Set<string>();
      for (const r of this.st.rows) {
        for (const id of this.cfg.resolveTaxaFromRow(r)) {
          if (id && !this.st.ctx.taxa[id]) ids.add(id);
        }
      }
      if (ids.size > 0) {
        const { data } = await supabase.from('taxa').select('id, scientific_name').in('id', [...ids]);
        for (const t of (data ?? []) as Array<{ id: string; scientific_name: string | null }>) {
          this.st.ctx.taxa[t.id] = { scientific_name: t.scientific_name };
        }
      }
    }
  }

  private renderRows(): void {
    const tbody = this.$('tbody');
    if (!tbody) return;
    const rows = this.st.rows;
    const ctx = this.st.ctx;
    const html: string[] = [];
    for (const r of rows) {
      const rowId = this.cfg.rowIdFromRow ? this.cfg.rowIdFromRow(r) : (r as { id?: string }).id ?? '';
      const isExpanded = this.st.expandedRows.has(rowId);
      const cells = this.cfg.columns
        .map(col => {
          const cls = `${col.cellClass ?? ''} ${col.align === 'right' ? 'text-right' : ''} px-3 py-2`;
          return `<td class="${cls}">${col.render(r, ctx)}</td>`;
        })
        .join('');
      html.push(
        `<tr data-row-id="${escapeHtml(rowId)}" class="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 align-top">${cells}${
          this.cfg.renderDrilldown
            ? `<td class="px-3 py-2 text-right whitespace-nowrap"><button type="button" data-toggle-row="${escapeHtml(rowId)}" aria-expanded="${isExpanded}" class="text-emerald-700 dark:text-emerald-400 text-xs hover:underline">${isExpanded ? '−' : '+'}</button></td>`
            : ''
        }</tr>`,
      );
      if (this.cfg.renderDrilldown && isExpanded) {
        const drill = this.cfg.renderDrilldown(r, ctx);
        const colspan = this.cfg.columns.length + 1;
        html.push(
          `<tr data-drill-for="${escapeHtml(rowId)}"><td colspan="${colspan}" class="px-3 py-3 bg-zinc-50 dark:bg-zinc-900/40 text-xs">${drill}</td></tr>`,
        );
      }
    }
    tbody.innerHTML = html.join('');

    tbody.querySelectorAll<HTMLElement>('[data-toggle-row]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleRow!;
        if (this.st.expandedRows.has(id)) this.st.expandedRows.delete(id);
        else this.st.expandedRows.add(id);
        this.renderRows();
      });
    });
  }

  private renderPagination(): void {
    const { page, pageSize, totalCount } = this.st.pagination;
    const start = page * pageSize + 1;
    const end = Math.min(start + this.st.rows.length - 1, totalCount ?? start + this.st.rows.length - 1);
    const totalPages = totalCount !== null ? Math.max(1, Math.ceil(totalCount / pageSize)) : page + 1;
    const summary = this.$('pagination-summary');
    if (summary) {
      if (totalCount === null) {
        summary.textContent = `Page ${page + 1}`;
      } else if (totalCount === 0) {
        summary.textContent = `0 results`;
      } else {
        summary.textContent = `${start}–${end} of ${totalCount} (page ${page + 1} of ${totalPages})`;
      }
    }
    const prev = this.$('prev') as HTMLButtonElement | null;
    const next = this.$('next') as HTMLButtonElement | null;
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = totalCount !== null && page >= totalPages - 1;
  }

  showError(msg: string): void {
    const el = this.$('error');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  }
}
