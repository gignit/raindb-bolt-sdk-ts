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
// Shape contract:
//
//   1. `SqlResult.rows` is `Array<Record<string, unknown>>` (named
//      rows) -- each row is a column-keyed object, IDENTICAL to what
//      the GraphQL `executeSQL` resolver returns (it zips the duckdb
//      positional rows into `map[string]any` in sqlResultToGQL).
//      ctx.sql.query and executeSQL are parity surfaces, so a bolt
//      reads `row[column]` the same way on both. (An earlier SDK
//      iteration typed this positional `unknown[][]` on the mistaken
//      belief that executeSQL was positional too; the substrate has
//      since been aligned so BOTH return named objects.)
//
//   2. `SqlFreshnessRow` (the entries of `SqlResult.latest`) mirrors the
//      substrate's `FormationLatest` shape field-for-field: the seven bookmark
//      fields plus the server-computed `freshnessStatus` verdict. It is
//      populated LIVE when `withFreshness: true` -- the lightning executor
//      builds it via the same shared `periscope.BuildFormationLatest` the
//      GraphQL `executeSQL` resolver calls, so the two surfaces are byte
//      parity. `latest` is present only when non-empty.
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
   * Ask the substrate to populate the result's `latest[]` freshness bookmark
   * (one {@link SqlFreshnessRow} per formation the query touches). LIVE: the
   * lightning SQL executor builds the bookmark via the same shared
   * `periscope.BuildFormationLatest` the GraphQL `executeSQL` resolver uses, so
   * `ctx.sql.query({ withFreshness: true })` returns the identical bookmark the
   * `ctx.fetch->/graphql executeSQL` route does. Omit or pass `false` and
   * `latest` is left off the result entirely.
   */
  withFreshness?: boolean;
}

/**
 * The server-computed drift verdict for one formation's SQL snapshot versus its
 * live writes. Read {@link SqlFreshnessRow.freshnessStatus} and switch on it --
 * do NOT re-derive drift from the cursors yourself (re-deriving is how clients
 * get the cold-current guard wrong and report false drift). The four states are
 * actionably distinct:
 *
 *   - `CURRENT`     -- snapshot covers the newest write; harvest nothing.
 *   - `BEHIND`      -- live writes exist past the snapshot; harvest the tail.
 *   - `UNKNOWN`     -- the current-side pointer could not be observed; drift is
 *                      undetermined, so decide whether to harvest conservatively.
 *   - `UNAVAILABLE` -- the formation declares no by-update index; there is no
 *                      freshness bridge, so reconciliation is unsupported.
 */
export type FreshnessStatus = 'CURRENT' | 'BEHIND' | 'UNKNOWN' | 'UNAVAILABLE';

/**
 * One row of `SqlResult.latest`. The CANONICAL freshness bookmark -- IDENTICAL
 * to the GraphQL `executeSQL` `FormationLatest` type, so a bolt migrating
 * between the `ctx.sql.query` and the `ctx.fetch->/graphql executeSQL` surfaces
 * reads the bookmark unchanged.
 *
 * The SQL (periscope) plane is eventually consistent: the columnar snapshot
 * lags live droplet writes. This bookmark pairs WHERE THE SNAPSHOT IS
 * (`snapshot*`) with WHERE THE FORMATION ACTUALLY IS (`current*`), and the
 * server distills the two into {@link freshnessStatus} so you never compare the
 * cursors yourself. When behind, harvest the tail:
 * `listKeys({ prefix: indexPrefix, after: snapshotDropletId })` -> `readDroplet`
 * each -> merge into the SQL rows (newest wins).
 */
export interface SqlFreshnessRow {
  /** Formation the bookmark describes. */
  formationId: string;
  /**
   * lex-max dropletId reflected in the SQL view snapshot (the periscope
   * tier manifest cursor as of the most recent committed pool). "" = no
   * committed snapshot.
   */
  snapshotDropletId: string;
  /** Pointer-index key (a scope key) for snapshotDropletId. */
  snapshotKey: string;
  /**
   * Snapshot commit time in Unix milliseconds. Optional -- absent when there
   * is no committed snapshot. Mirrors the GraphQL FormationLatest.snapshotAt.
   */
  snapshotAt?: number;
  /**
   * lex-max dropletId in the formation right now, from the formation-wide
   * meta latest pointer. "" = the current side could not be observed (see
   * {@link freshnessStatus} === 'UNKNOWN'). Prefer {@link freshnessStatus}
   * over comparing this to snapshotDropletId yourself.
   */
  currentDropletId: string;
  /** Entity/droplet path for currentDropletId. */
  currentKey: string;
  /**
   * by-update index prefix to ASC-scan for the harvest. "" = the formation
   * declares no by-update index (see {@link freshnessStatus} === 'UNAVAILABLE').
   */
  indexPrefix: string;
  /**
   * The server-computed drift verdict -- read THIS to decide whether to
   * harvest, rather than comparing snapshotDropletId vs currentDropletId
   * yourself. See {@link FreshnessStatus}, or the {@link isBehind} /
   * {@link isFresh} / {@link needsHarvest} helpers.
   */
  freshnessStatus: FreshnessStatus;
}

/**
 * True when the SQL snapshot is KNOWN to be behind the formation's live writes
 * (`freshnessStatus === 'BEHIND'`), i.e. there is a tail to harvest. False for
 * CURRENT, UNKNOWN, and UNAVAILABLE -- it never claims drift the server could
 * not substantiate.
 */
export function isBehind(row: SqlFreshnessRow): boolean {
  return row.freshnessStatus === 'BEHIND';
}

/**
 * True when the SQL snapshot is KNOWN to already cover the newest write
 * (`freshnessStatus === 'CURRENT'`), so there is nothing to harvest. False for
 * BEHIND, UNKNOWN, and UNAVAILABLE.
 */
export function isFresh(row: SqlFreshnessRow): boolean {
  return row.freshnessStatus === 'CURRENT';
}

/**
 * True when a client SHOULD harvest the tail to be safe: the snapshot is behind
 * (`BEHIND`) OR the current side is undetermined (`UNKNOWN`, where the server
 * could not confirm freshness). False only when the snapshot is confirmed
 * current (`CURRENT`) or freshness is unavailable for the formation
 * (`UNAVAILABLE`, no by-update index -- there is nothing to harvest against).
 */
export function needsHarvest(row: SqlFreshnessRow): boolean {
  return row.freshnessStatus === 'BEHIND' || row.freshnessStatus === 'UNKNOWN';
}

/**
 * Result of {@link sql.query}. Mirrors the substrate's
 * `runtime.SQLResult` projection.
 *
 * `rows` is NAMED (`Array<Record<string, unknown>>`) -- each row is
 * a column-keyed object, so you read `row[columnName]` directly.
 * This is IDENTICAL to the GraphQL `executeSQL` row shape, so the
 * bolt-side wrapper is a true drop-in replacement for the
 * `ctx.fetch->/graphql` route (a bolt migrating from one to the
 * other reads `row.<column>` unchanged). `columns[]` is still
 * provided for ordered iteration / header rendering.
 */
export interface SqlResult {
  /** Column names in declaration order. */
  columns: string[];
  /** Rows as column-keyed objects: `rows[i][columnName]` is the value. */
  rows: Array<Record<string, unknown>>;
  /** Substrate-reported row count (may exceed `rows.length` when truncated). */
  rowCount: number;
  /** Query execution wall time, milliseconds. */
  durationMs: number;
  /** True when the result set was truncated to a substrate-side limit. */
  truncated: boolean;
  /**
   * Freshness bookmark per formation the query touched -- the CANONICAL shape
   * identical to GraphQL executeSQL's FormationLatest (see
   * {@link SqlFreshnessRow}). Populated LIVE when `withFreshness: true` was
   * passed AND the formation declares a by-update index; `undefined` otherwise
   * (the substrate omits it when empty, so bolts discriminate on presence).
   * Read each row's {@link SqlFreshnessRow.freshnessStatus} to decide whether
   * to harvest.
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
      `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
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
 * Cross-validation: matches @raindb/agent's `sql_execute` tool shape (sql
 * input; columns/rows/rowCount/durationMs/truncated output) AND the `latest[]`
 * freshness bookmark, including the server-computed `freshnessStatus` verdict
 * -- all three surfaces (GraphQL, this bolt binding, MCP) return the identical
 * bookmark from the one shared `periscope.BuildFormationLatest`.
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
   * @example Freshness bookmark -- reconcile a stale SQL view
   * ```ts
   * import { sql, needsHarvest } from '@raindb/bolt-sdk';
   * const r = await sql.query({
   *   sql: 'SELECT * FROM entity."orders"',
   *   formationId: 'orders',
   *   withFreshness: true,
   * });
   * for (const bm of r.latest ?? []) {
   *   if (needsHarvest(bm)) {
   *     // listKeys({ prefix: bm.indexPrefix, after: bm.snapshotDropletId })
   *     // -> readDroplet each -> merge into r.rows (newest wins).
   *   }
   *   // bm.freshnessStatus is 'CURRENT' | 'BEHIND' | 'UNKNOWN' | 'UNAVAILABLE'
   * }
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
