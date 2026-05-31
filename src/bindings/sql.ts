// bindings/sql.ts -- STUBBED ctx.sql.query surface.
// Audit §H (Gap 3).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface SqlQueryInput {
  sql: string;
  /**
   * Return a `latest[]` freshness bookmark per formation referenced
   * in the query. Lets the caller detect parquet-snapshot drift vs.
   * live writes.
   */
  withFreshness?: boolean;
  /** Per-query timeout in milliseconds. */
  timeoutMs?: number;
}

export interface SqlFreshnessRow {
  formationId: string;
  snapshotDropletId: string;
  snapshotKey: string;
  snapshotAt: string;
  currentDropletId: string;
  currentKey: string;
  indexPrefix?: string;
}

export interface SqlResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  latest?: SqlFreshnessRow[];
}

/**
 * Bolt-facing shape of `ctx.sql` -- raw goja surface (STUB).
 */
export interface SqlBinding {
  query?: (input: SqlQueryInput) => Promise<SqlResult>;
}

/**
 * STUB (audit §H Gap 3). Direct executeSQL access against the
 * periscope-backed analytical plane.
 *
 * Capability: requires `sql-read` declared on the bolt manifest's
 * `capabilities.raindb.sqlRead`.
 *
 * Cross-validation: matches @raindb/agent's `sql_execute` tool
 * shape (sql input, columns/rows/rowCount/durationMs/truncated
 * output) field-for-field.
 */
export const sql = {
  /**
   * STUB. Execute a SQL query.
   *
   * @throws BindingNotInstalled until substrate ships ctx.sql.query
   *
   * @example
   * ```ts
   * const result = await sql.query({
   *   sql: 'SELECT count(*) AS n FROM entity."continuum_memories"',
   *   withFreshness: true,
   * });
   * const n = (result.rows[0]?.['n'] as number) ?? 0;
   * ```
   */
  async query(input: SqlQueryInput): Promise<SqlResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<SqlResult>(
      BINDING.sql_query,
      () =>
        (ctx as unknown as { sql?: SqlBinding }).sql?.query,
      (fn) =>
        (fn as (i: SqlQueryInput) => Promise<SqlResult>)(input),
      { sql: input.sql.slice(0, 80), withFreshness: input.withFreshness },
    );
  },
};
