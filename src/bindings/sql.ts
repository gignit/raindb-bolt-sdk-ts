// bindings/sql.ts -- typed wrapper for ctx.sql.query.
//
// LIVE since v0.2.0 -- substrate landed the native binding in
// phoenix commit af5e9eb. The goja installer is in
// `pkg/lightning/engines/goja/bindings.go::installSQLBinding`;
// the SDK contract is the `SDKSQL` interface in
// `pkg/lightning/runtime/engine.go` (~lines 632-700).
//
// Calling convention: the goja binding takes positional args
// `(sql, [opts])` where opts is a plain JS object with
// `{ formationId?, timeoutMs?, withFreshness? }`. The wrapper
// preserves the named-args object surface bolts already expect
// from the v0.1 stub (no breaking change to handler call-sites)
// while threading the opts through to the native binding.
//
// Two shape divergences from the v0.1 stub, called out in the
// CHANGELOG:
//
//   1. `SqlResult.rows` is `unknown[][]` (positional rows) -- the
//      substrate returns `[][]any` per the GraphQL SQLResult shape
//      that `executeSQL` projects. The v0.1 stub typed it as
//      `Array<Record<string, unknown>>` (named rows) which did not
//      match the substrate. Field lookups are positional via
//      `result.columns.indexOf(name)`.
//
//   2. `SqlFreshnessRow` (the entries of `SqlResult.latest`) now
//      mirrors the substrate's `FormationLatest` shape:
//      `{ formationId, snapshotCursor, currentLatest, stale }`.
//      The v0.1 stub guessed a different shape; the substrate
//      wins. Tier 1 currently returns `latest` only when non-empty,
//      and `withFreshness: true` still returns nil latest (deferred
//      to v0.3+, per substrate brain doc decision 4).
//
// Capability gate: bolt-level `sql-read` (declared as
// `capabilities.raindb.sqlRead: true` in bolt.json). Distinct from
// formation-level read because SQL queries span formations.
//
// Audit reference: §H (Gap 3).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BindingNotInstalled } from '../errors/classes.js';
import { BINDING } from '../internal/constants.js';

/**
 * Input shape for {@link sql.query}. The wrapper repacks this
 * into the goja binding's positional convention `(sql, opts)`.
 */
export interface SqlQueryInput {
  /** The SQL statement to execute against the periscope plane. */
  sql: string;
  /**
   * Optional formation hint -- the periscope prelude ensures the
   * named formation's view is registered before execution. When
   * unset the query runs without prelude scoping (matches the
   * api resolver behavior when the optional hint is omitted).
   */
  formationId?: string;
  /**
   * Per-query timeout in milliseconds. <=0 or undefined uses the
   * substrate default (30 seconds today, sourced from the duckdb
   * config used by the api server).
   */
  timeoutMs?: number;
  /**
   * Ask the wrapper to populate the result's `latest[]` freshness
   * bookmark per formation referenced in the query. Deferred --
   * the Tier 1 substrate cut returns nil `latest` regardless of
   * this flag (per substrate brain doc decision 4); a typed
   * warning lands in a v0.3+ swap.
   */
  withFreshness?: boolean;
}

/**
 * One row of `SqlResult.latest`. Mirrors the substrate's
 * `runtime.FormationLatest` shape exactly. Currently unused in
 * the Tier 1 substrate cut; the shape is declared so the wrapper
 * is forward-compatible when the freshness bookmark wires up.
 */
export interface SqlFreshnessRow {
  /** Formation the bookmark describes. */
  formationId: string;
  /**
   * Periscope snapshot cursor at query execution time.
   * Opaque string suitable for replay.
   */
  snapshotCursor: string;
  /**
   * Latest known live cursor on the formation. Compare with
   * snapshotCursor to detect drift.
   */
  currentLatest: string;
  /**
   * True when the snapshot is behind the live latest -- the
   * caller may want to re-run after a refresh.
   */
  stale: boolean;
}

/**
 * Result of {@link sql.query}. Mirrors the substrate's
 * `runtime.SQLResult` projection.
 *
 * `rows` is POSITIONAL (`unknown[][]`) -- each row is an array
 * aligned with the `columns[]` order. To look up a named column,
 * compute `columns.indexOf(name)` once and index each row by the
 * resulting position. This matches the GraphQL `SQLResult.rows`
 * shape so the bolt-side wrapper is a drop-in replacement for the
 * `ctx.fetch->/graphql` route.
 */
export interface SqlResult {
  /** Column names in declaration order. */
  columns: string[];
  /** Rows in positional shape: `rows[i][j]` is column j of row i. */
  rows: unknown[][];
  /** Substrate-reported row count (may exceed `rows.length` when truncated). */
  rowCount: number;
  /** Query execution wall time, milliseconds. */
  durationMs: number;
  /** True when the result set was truncated to a substrate-side limit. */
  truncated: boolean;
  /**
   * Freshness bookmark per formation. Absent in the Tier 1
   * substrate cut (deferred to v0.3+ per substrate brain doc
   * decision 4); the field is optional to match.
   */
  latest?: SqlFreshnessRow[];
}

/**
 * Shape of `ctx.sql` as the goja sandbox installs it. LIVE since
 * v0.2.0.
 *
 * Calling convention: positional `(sql, opts)`. The wrapper hides
 * this; bolts call `sql.query({ sql, ...opts })`.
 */
export interface SqlBinding {
  query(
    sql: string,
    opts?: {
      formationId?: string;
      timeoutMs?: number;
      withFreshness?: boolean;
    },
  ): Promise<SqlResult>;
}

/** Internal: shared "namespace missing" error producer. */
function missingSql(input: unknown): never {
  throw new BindingNotInstalled(
    `${BINDING.sql_query} requires ctx.sql which is not installed in ` +
      `this bolt runtime. The @raindb/bolt-sdk wrapper is LIVE since ` +
      `v0.2.0; the substrate-side binding landed in phoenix commit ` +
      `af5e9eb. If you see this on a current lightning binary, ` +
      `capabilities.raindb.sqlRead is likely not set to true. See ` +
      `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md §H ` +
      `for the gap card that owns this surface.`,
    { binding: BINDING.sql_query, input },
  );
}

/**
 * The ctx.sql namespace -- LIVE wrapper over the substrate's
 * direct executeSQL access against the periscope-backed analytical
 * plane (DuckDB).
 *
 * Capability: requires `capabilities.raindb.sqlRead: true` on the
 * bolt manifest. The substrate enforces; the wrapper translates
 * rejection messages to {@link CapabilityDenied} via
 * `translateBindingError`.
 *
 * Audit §H (Gap 3). Substrate-side commit: af5e9eb.
 *
 * Cross-validation: matches @raindb/agent's `sql_execute` tool
 * shape (sql input; columns/rows/rowCount/durationMs/truncated
 * output) modulo the `latest[]` freshness bookmark (Tier 1
 * substrate cut returns it empty; deferred to v0.3+).
 */
export const sql = {
  /**
   * Execute a SQL query against the periscope-backed analytical
   * plane.
   *
   * LIVE binding.
   *
   * @requires capability: `sql-read` (bolt-level)
   * @throws CapabilityDenied when capabilities.raindb.sqlRead is
   *   not set to true
   * @throws BindingNotInstalled when running against a lightning
   *   binary that pre-dates phoenix commit af5e9eb
   *
   * @example
   * ```ts
   * import { sql } from '@raindb/bolt-sdk';
   * const r = await sql.query({
   *   sql: 'SELECT count(*) AS n FROM entity."continuum_memories"',
   * });
   * const nIdx = r.columns.indexOf('n');
   * const n = (r.rows[0]?.[nIdx] as number) ?? 0;
   * ```
   *
   * @example Freshness bookmark (currently deferred)
   * ```ts
   * const r = await sql.query({ sql: 'SELECT 1', withFreshness: true });
   * // r.latest === undefined in the Tier 1 substrate cut;
   * // populated in v0.3+ when the bookmark wires up.
   * ```
   */
  async query(input: SqlQueryInput): Promise<SqlResult> {
    const ctx = resolveCtx();
    if (ctx.sql === undefined) {
      missingSql({ sql: input.sql.slice(0, 80) });
    }
    // Repack the named-args input into the goja binding's
    // positional convention. Only forward defined fields so the
    // substrate sees an absent rather than zero-valued option.
    const opts: { formationId?: string; timeoutMs?: number; withFreshness?: boolean } = {};
    if (input.formationId !== undefined) opts.formationId = input.formationId;
    if (input.timeoutMs !== undefined) opts.timeoutMs = input.timeoutMs;
    if (input.withFreshness !== undefined) opts.withFreshness = input.withFreshness;
    try {
      const out = await ctx.sql.query(input.sql, opts);
      return out as SqlResult;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.sql_query,
        input: { sql: input.sql.slice(0, 80), withFreshness: input.withFreshness },
      });
    }
  },
};
