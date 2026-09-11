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
import { BindingNotInstalled, RainDBBoltError } from '../errors/classes.js';
import { BINDING } from '../internal/constants.js';
import { db } from './db.js';

/**
 * Tuning constants for the queryEntityRowsFresh tail harvest (PR 3, no magic
 * numbers in business logic). These bound the by-update tail walk the helper
 * performs via db.listSince:
 *
 * - HARVEST_PAGE_SIZE: droplets requested per listSince page. Sized to amortize
 *   the per-page round trip against memory (each page buffers full droplet
 *   payloads) for the not-yet-pooled tail, which is bounded by the periscope
 *   pool cadence, not the whole formation.
 * - HARVEST_MAX_PAGES: hard ceiling on pages per behind-formation. A tail longer
 *   than HARVEST_PAGE_SIZE * HARVEST_MAX_PAGES means the snapshot is too far
 *   behind to freshen cheaply; the helper fails loud (PR 5.3) rather than
 *   walking unboundedly, directing the caller to the platform bounded-current
 *   mode. The product (default 20 * 200 = 4000 rows) is a deliberate cap.
 */
const HARVEST_PAGE_SIZE = 200;
const HARVEST_MAX_PAGES = 20;

/**
 * Periscope query plan strategy for a single SQL query. Selects HOW the
 * answer-preserving read set is computed from the pinned snapshot:
 *
 * - `'range'` (the substrate default): manifest-summary reduction -- drops
 *   absorbed lower-tier manifests using the snapshot summaries alone.
 * - `'scan'`: native Iceberg file-level planning.
 *
 * Both strategies return IDENTICAL rows; they differ only in how the read set
 * is planned. Omit to use the formation's configured default
 * (`views.queryDefaults.planStrategy`, itself defaulting to `range`). The
 * substrate rejects any other value (empty string, `'standard'`, `'Scan'`,
 * `' scan'`) with a `bad_request`. LIVE on both engines since raindb-prime
 * commit 5fdd75fc (per-query override) and 507666a0 (range/scan selected by
 * planStrategy alone).
 */
export type PlanStrategy = 'range' | 'scan';

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
   * Per-query periscope plan strategy override ({@link PlanStrategy}). Omit to
   * use the formation's configured default. Forwarded verbatim to the host,
   * which validates it (goja `extractSQLQueryOptions` / pod-channel
   * `handleSQLQuery` -> `runtime.SQLQueryOptions.PlanStrategy`); an invalid
   * value is rejected substrate-side, not silently dropped.
   */
  planStrategy?: PlanStrategy;
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
      planStrategy?: PlanStrategy;
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
    // substrate sees an absent rather than zero-valued option
    // (an omitted planStrategy => formation default; a defined one
    // is validated host-side, never dropped or defaulted in JS).
    const opts: {
      formationId?: string;
      timeoutMs?: number;
      withFreshness?: boolean;
      planStrategy?: PlanStrategy;
    } = {};
    if (input.formationId !== undefined) opts.formationId = input.formationId;
    if (input.timeoutMs !== undefined) opts.timeoutMs = input.timeoutMs;
    if (input.withFreshness !== undefined) opts.withFreshness = input.withFreshness;
    if (input.planStrategy !== undefined) opts.planStrategy = input.planStrategy;
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

  /**
   * Read-your-writes analytical ROW LIST: run an ENTITY-ROW SQL query, then merge
   * the not-yet-pooled tail so the result includes writes the columnar snapshot
   * has not rolled up yet. This is the one-call form of the freshness-merge every
   * analytical bolt otherwise hand-rolls (see the production shape in crexp's
   * server/index.js::runSQLFresh).
   *
   * How it works: run {@link query} with `withFreshness: true`; for each formation
   * bookmark that {@link needsHarvest}, poll the by-update tail after the snapshot
   * cursor via {@link db.listSince} (full payloads), project each late droplet onto
   * the query's columns, and merge NEWEST-FIRST, deduped by `scopeKey` (a late row
   * replaces a snapshot row for the same entity; late rows lead).
   *
   * STRICTLY FOR ENTITY-ROW QUERIES -- `SELECT <cols> FROM entity."<f>" ...` where
   * each row IS an entity. It is NOT valid for aggregates: you cannot merge a raw
   * late droplet into a GROUP BY / window / percentile / regression result (adding
   * a row does not re-aggregate). For an analytical CHART, run {@link query} over
   * the pooled data and show a freshness/"updating" indicator from the bookmark
   * instead of trying to freshen the aggregate.
   *
   * LIMITATION -- read before relying on this. The merge does NOT re-apply the
   * query's WHERE / ORDER BY / LIMIT over the combined (snapshot + late-tail) set:
   * late rows are projected onto the columns, deduped by `scopeKey`, and led in
   * newest-first, then the snapshot rows follow. So:
   *   - a late row that NO LONGER matches the WHERE can appear (the predicate is
   *     not re-evaluated on the tail);
   *   - the SQL ORDER BY is NOT re-imposed across the late rows (they lead by
   *     write order, not the query's sort);
   *   - a LIMIT is NOT re-applied, so the merged result can exceed it.
   * Correctly reconciling predicate/sort/limit over an eventually-consistent
   * snapshot is not supported by this helper. It merges an entity set without
   * parsing SQL. Use it for an unordered/unfiltered "did my writes land" set;
   * for ordered/filtered/limited current lists, sort+filter+slice the result
   * yourself over stable columns.
   *
   * FAIL-LOUD: this THROWS -- never silently returns the stale snapshot (a method
   * named `*Fresh` must not hand back stale data) -- when it cannot PROVE the
   * result is fresh:
   *   (a) the tail harvest errors;
   *   (b) NO freshness bookmark was returned (absence of evidence is not proof of
   *       CURRENT);
   *   (c) a bookmark is UNAVAILABLE (no by-update index -> nothing to harvest);
   *   (d) a BEHIND/UNKNOWN bookmark carries no snapshot cursor (coverage
   *       unprovable);
   *   (e) the tail walk does not cleanly reach end-of-index, does not advance to
   *       the current watermark (currentDropletId; dropletIds are UUIDv7 so the
   *       compare is chronological), gets stuck, or exceeds the harvest bound
   *       (HARVEST_MAX_PAGES * HARVEST_PAGE_SIZE) -- i.e. the tail is not proven
   *       complete;
   *   (f) a harvested tail row is missing the merge identity (a null-key row
   *       cannot be deduped against the snapshot).
   * It returns the base snapshot ONLY when a bookmark set is present and every
   * bookmark is genuinely CURRENT (there is nothing to harvest). The watermark
   * droplet itself need not appear in the tail: an expired/purged entity is a
   * tombstone that listSince skips during listing, so completeness is
   * proven by CURSOR coverage + clean end-of-index, not droplet presence.
   *
   * @param input.scopeKey the entity-identity column both the SQL rows and the late
   *   droplet payloads carry (e.g. `entryId`); used to dedupe the merge. Defaults
   *   to the first column when omitted.
   * @throws RainDBBoltError when the tail harvest fails
   * @requires capability: `sql-read` + `list` on the formation
   *
   * @example
   * ```ts
   * // Unordered read-your-writes entity SET (no reliance on ORDER BY/LIMIT):
   * const r = await sql.queryEntityRowsFresh({
   *   sql: 'SELECT entryId, title, status, updatedAt FROM entity."ff-journal"',
   *   formationId: 'ff-journal',
   *   scopeKey: 'entryId',
   * });
   * // r.rows includes entries written since the last pool -- read-your-writes.
   * // Impose order/limit yourself if needed:
   * const recent = [...r.rows]
   *   .sort((a, b) => String(b['updatedAt']).localeCompare(String(a['updatedAt'])))
   *   .slice(0, 50);
   * ```
   */
  async queryEntityRowsFresh(
    input: SqlQueryInput & { scopeKey?: string },
  ): Promise<SqlResult> {
    const base = await this.query({ ...input, withFreshness: true });
    const bookmarks = base.latest ?? [];

    // FAIL LOUD on a bookmark this helper cannot honestly freshen (R3). A
    // method named *Fresh must never silently hand back the stale snapshot:
    //   - UNAVAILABLE: the formation declares no by-update index, so there is
    //     no tail to harvest and freshness cannot be established. This is NOT a
    //     "nothing to do => return base" case; it is "cannot fulfil the *Fresh
    //     contract" => reject, so the caller uses plain query() knowingly.
    const unavailable = bookmarks.filter((bm) => bm.freshnessStatus === 'UNAVAILABLE');
    if (unavailable.length > 0) {
      throw new RainDBBoltError(
        `sql.queryEntityRowsFresh: cannot freshen -- ${unavailable
          .map((b) => b.formationId)
          .join(', ')} report freshnessStatus=UNAVAILABLE (no by-update index; ` +
          `no harvestable tail). Use sql.query() for an honest eventual read, ` +
          `or add a by-update index to the formation.`,
        { binding: 'ctx.sql.queryEntityRowsFresh', input: { sql: input.sql.slice(0, 80) } },
      );
    }

    // COVERAGE: withFreshness was requested, so an EMPTY bookmark set is the
    // server producing no freshness evidence -- absence of evidence, NOT proof
    // of CURRENT. A *Fresh method cannot honestly return base here (R3/PR 5.3).
    if (bookmarks.length === 0) {
      throw new RainDBBoltError(
        'sql.queryEntityRowsFresh: no freshness bookmark was returned, so ' +
          'freshness cannot be established. Absence of a bookmark is not proof ' +
          'the snapshot is current. Use sql.query() for an honest eventual read.',
        { binding: 'ctx.sql.queryEntityRowsFresh', input: { sql: input.sql.slice(0, 80) } },
      );
    }

    const behind = bookmarks.filter((bm) => needsHarvest(bm));
    // Every bookmark is CURRENT (the only remaining status after UNAVAILABLE and
    // BEHIND/UNKNOWN are excluded): the snapshot IS confirmed fresh -> return base.
    if (behind.length === 0) return base;

    const cols = base.columns.length
      ? base.columns
      : Object.keys(base.rows[0] ?? {});
    const key = input.scopeKey ?? cols[0];
    if (!key) {
      // Cannot establish merge identity: a harvested late row could not be
      // deduped against a snapshot row, so a merge would double-count or drop
      // rows. Reject rather than silently return the stale base (R3).
      throw new RainDBBoltError(
        'sql.queryEntityRowsFresh: cannot establish a merge key (no columns and ' +
          'no scopeKey supplied); pass scopeKey or select at least the identity ' +
          'column so late rows can dedupe against the snapshot.',
        { binding: 'ctx.sql.queryEntityRowsFresh', input: { sql: input.sql.slice(0, 80) } },
      );
    }

    // Harvest the not-yet-pooled tail for each behind formation (fail-loud).
    const late: Array<Record<string, unknown>> = [];
    for (const bm of behind) {
      // A BEHIND/UNKNOWN bookmark that carries no snapshot cursor cannot be
      // harvested from a known point -- freshness coverage is unprovable, so
      // reject rather than harvest from "" (which would re-read the whole
      // formation and still not prove coverage) (R3).
      if (!bm.snapshotDropletId) {
        throw new RainDBBoltError(
          `sql.queryEntityRowsFresh: ${bm.formationId} is ${bm.freshnessStatus} ` +
            `but carries no snapshot cursor; cannot harvest a bounded tail or ` +
            `prove freshness coverage.`,
          { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: bm.formationId } },
        );
      }
      // dropletIds are UUIDv7 -- lexicographic compare is chronological.
      // The by-update tail is ASC, so we
      // track the max dropletId observed and consider the harvest "caught up"
      // when the walk cleanly exhausts the index AND the cursor has advanced to
      // >= the current watermark. The watermark droplet itself may legitimately
      // NOT appear in the tail (its entity can be an expired/purged tombstone,
      // which listSince skips), so completeness is
      // proven by CURSOR coverage + clean exhaustion, not droplet presence.
      let cursor = bm.snapshotDropletId;
      let maxSeen = bm.snapshotDropletId;
      let exhausted = false;
      let pages = 0;
      for (;;) {
        if (pages >= HARVEST_MAX_PAGES) {
          // Too far behind to freshen within the bound: fail loud (PR 5.3),
          // never return a partially-harvested (still-stale) base.
          throw new RainDBBoltError(
            `sql.queryEntityRowsFresh: ${bm.formationId} tail exceeds ` +
              `${HARVEST_MAX_PAGES} pages of ${HARVEST_PAGE_SIZE}; the snapshot is ` +
              `too far behind to freshen. Await a pool cycle or use the platform ` +
              `bounded-current mode.`,
            { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: bm.formationId } },
          );
        }
        pages += 1;
        let page;
        try {
          page = await db.listSince({
            formationId: bm.formationId,
            sinceCursor: cursor,
            opts: { first: HARVEST_PAGE_SIZE },
          });
        } catch (err) {
          throw new RainDBBoltError(
            `sql.queryEntityRowsFresh: tail harvest failed for ${bm.formationId} ` +
              `after ${cursor}: ${err instanceof Error ? err.message : String(err)}`,
            { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: bm.formationId } },
          );
        }
        // listSince returns full droplets; the entity row is its payload.
        for (const d of page.droplets) {
          if (typeof d.dropletId === 'string' && d.dropletId > maxSeen) {
            maxSeen = d.dropletId;
          }
          if (d.payload) late.push(d.payload);
        }
        // Terminate ONLY on a real end-of-index signal: no more pages. An empty
        // page with hasMore:true may contain skipped expired entities -- continue
        // (the old code broke here on droplets.length===0 and returned stale).
        // hasMore is the producer's availability signal.
        // A resume cursor can also accompany the FINAL page,
        // including positions whose expired entities were skipped. It is
        // coverage evidence, not a replacement for the hasMore signal.
        if (typeof page.nextCursor === 'string' && page.nextCursor > maxSeen) {
          maxSeen = page.nextCursor;
        }
        if (page.hasMore === false) {
          exhausted = true;
          break;
        }
        if (page.hasMore !== true || typeof page.nextCursor !== 'string' ||
            page.nextCursor.length === 0 || page.nextCursor === cursor) {
          // No forward progress but hasMore is still set: the walk is stuck.
          // Fail loud rather than loop or accept an incomplete tail (PR 5.3).
          throw new RainDBBoltError(
            `sql.queryEntityRowsFresh: ${bm.formationId} tail cursor did not ` +
              `advance (${cursor}) with a valid hasMore signal; cannot prove freshness coverage.`,
            { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: bm.formationId } },
          );
        }
        cursor = page.nextCursor;
      }
      // COVERAGE PROOF: the walk must have cleanly exhausted the index AND, when
      // the current watermark is known (BEHIND carries a currentDropletId), the
      // observed tail must have advanced to at least it. Otherwise the tail is
      // incomplete and returning the merged rows would silently omit the newest
      // writes -- fail loud (R3/PR 5.3).
      if (!exhausted) {
        throw new RainDBBoltError(
          `sql.queryEntityRowsFresh: ${bm.formationId} tail did not reach ` +
            `end-of-index; freshness coverage is unproven.`,
          { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: bm.formationId } },
        );
      }
      if (bm.currentDropletId && maxSeen < bm.currentDropletId) {
        throw new RainDBBoltError(
          `sql.queryEntityRowsFresh: ${bm.formationId} harvest reached ${maxSeen} ` +
            `but the current watermark is ${bm.currentDropletId}; the tail did not ` +
            `catch up to the newest write, so the result would be stale.`,
          { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: bm.formationId } },
        );
      }
    }

    // Project a late droplet onto the query's columns (null-fill missing).
    const project = (obj: Record<string, unknown>): Record<string, unknown> => {
      const r: Record<string, unknown> = {};
      for (const c of cols) r[c] = c in obj ? obj[c] : null;
      return r;
    };

    // Validate each late row carries a NON-NULL logical identity BEFORE dedup: a
    // row missing the merge key projects to a null key, and merging unrelated
    // null-key rows would drop or combine distinct entities. Fail loud (R3).
    const projected = late.map(project);
    for (const row of projected) {
      if (row[key] === null || row[key] === undefined) {
        throw new RainDBBoltError(
          `sql.queryEntityRowsFresh: a harvested tail row is missing the merge ` +
            `identity ${JSON.stringify(key)}; cannot dedup an identity-less row ` +
            `against the snapshot.`,
          { binding: 'ctx.sql.queryEntityRowsFresh', input: { formationId: input.formationId, scopeKey: key } },
        );
      }
    }

    // Merge: late rows first (newest), then snapshot rows; first occurrence of a
    // scope key wins (a late row supersedes the stale snapshot row).
    const byKey = new Map<unknown, Record<string, unknown>>();
    const order: unknown[] = [];
    const add = (row: Record<string, unknown>): void => {
      const k = row[key];
      if (!byKey.has(k)) order.push(k);
      else return; // first (late) wins
      byKey.set(k, row);
    };
    // listSince is asc (oldest-first); reverse so newest late rows lead.
    for (const d of projected.reverse()) add(d);
    for (const row of base.rows) add(row);

    const merged = order.map((k) => byKey.get(k)!);
    return {
      columns: cols,
      rows: merged,
      rowCount: merged.length,
      durationMs: base.durationMs,
      truncated: base.truncated,
      ...(base.latest ? { latest: base.latest } : {}),
    };
  },
};
