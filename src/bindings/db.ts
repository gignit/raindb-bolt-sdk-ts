// bindings/db.ts -- typed wrappers for ctx.db.*.
//
// Two shapes coexist in this file:
//
//   1. `DbBinding` -- the type of `BoltContext.db`. Mirrors what the
//      goja sandbox actually installs: positional-args methods that
//      throw goja-shaped errors. Bolts can call `ctx.db.readLatest(
//      formationId, indexId, scopeValue)` directly as an escape
//      hatch, but the recommended path is the SDK's wrapper.
//
//   2. `db` (the const exported below) -- the ergonomic wrapper. Takes
//      named-args objects, throws typed RainDBBoltError subclasses,
//      and routes through `setCtx(ctx)` so the call site reads
//      cleanly without ctx threading.
//
// LIVE methods (audit §B / §G / §I / §L / §M; goja installer in
// `pkg/lightning/engines/goja/bindings.go::installDBBinding`):
//   - readLatest(formationId, indexId, scopeValue)
//   - readDroplet(formationId, dropletId)
//   - writeDroplet(formationId, payload)
//   - listDroplets(formationId, prefix?, pageSize?)
//   - listKeys(formationId, indexId, opts?)         [LIVE since v0.2.0]
//   - listSince(formationId, sinceCursor, opts?)    [LIVE since v0.2.0]
//   - tag(formationId, scopeValue, tags)            [LIVE since v0.3.0]
//   - untag(formationId, scopeValue, tagKeys)       [LIVE since v0.3.0]
//   - expire(formationId, scopeValue)               [LIVE since v0.3.0]
//   - expirationDays()                              [LIVE since v0.3.0]
//   - writeBatch(formationId, items, opts?)         [LIVE since v0.3.0]
//
// STUBBED methods (substrate-side pending; per-method JSDoc points
// at the audit gap card):
//   - readAt (audit §R Gap 13)
//   - readCurrent, resolveFormation (audit §S Gap 14)
//
// Cross-validation: input/output types match @raindb/agent's
// droplet_* tools field-for-field per handoff §J. The wrapper does
// no shape transformation -- pass-through with type narrowing.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BindingNotInstalled } from '../errors/classes.js';
import { BINDING } from '../internal/constants.js';
import type {
  Droplet,
  DropletEnvelope,
  DropletsPage,
  KeyPage,
  SincePage,
} from '../types/droplet.js';
import type { CursorPaginationOpts } from '../types/cursor.js';

// =====================================================================
// Input shapes -- these are SDK-level names, not goja-level.
// =====================================================================

export interface ReadLatestInput {
  formationId: string;
  indexId: string;
  scopeValue: string;
}

export interface ReadDropletInput {
  formationId: string;
  dropletId: string;
}

export interface VersionHistoryInput {
  formationId: string;
  /** The entity's scope value (its stable id). */
  scopeValue: string;
  /** Max revisions to return (walks pages up to this; default 200). */
  limit?: number;
}

/** One revision in an entity's version history (from its droplet chain). */
export interface Revision {
  /** The revision's dropletId. Read its exact bytes with db.readDroplet. */
  dropletId: string;
  /** Write time, Unix milliseconds. */
  ts: number;
  /** The entity payload AS IT WAS at this revision. */
  payload: Record<string, unknown> | null;
  /** Per-float metadata at this revision (present when the entity has floats). */
  floatMeta?: Record<string, unknown>[];
}

export interface WriteDropletInput {
  formationId: string;
  payload: Record<string, unknown>;
}

export interface ListDropletsInput {
  formationId: string;
  /**
     * Relay-style asc pagination (first/after) plus either semantic
     * `scopeValue` or raw physical `prefix` narrowing within the entity
     * namespace. The two narrowing fields are mutually exclusive.
     * listDroplets now returns a
   * {@link DropletsPage} so a bolt can walk a formation larger than one
   * page and detect truncation; previously it returned a bare array and
   * dropped the cursor, so only the first page was ever visible
   * (substrate H12 fix). `pageSize` is retained as a deprecated alias
   * for `opts.first` for source compatibility.
   */
  opts?: CursorPaginationOpts;
  /** @deprecated use `opts.first`; retained for source compatibility. */
  pageSize?: number;
  /** @deprecated use `opts.prefix`. */
  prefix?: string;
}

export interface ListKeysInput {
  formationId: string;
  /**
   * Index name on the formation. Use `by-id` for the default
   * pointer-by-id index (the name must match an index the formation
   * actually declares -- a name the formation does not declare returns
   * a 404 index-not-found, not an opaque 500). Required.
   */
  indexId: string;
  opts?: CursorPaginationOpts;
}

export interface ListSinceInput {
  formationId: string;
  /**
   * Opaque cursor from a prior `listSince` call's `nextCursor`
   * field, or the empty string for "from the beginning of the
   * formation". Required positionally by the substrate, though
   * empty string is accepted.
   */
  sinceCursor: string;
  opts?: CursorPaginationOpts;
}

/**
 * One row in a {@link WriteBatchInput.items} array. Mirrors the
 * substrate `runtime.BatchItem` shape (per
 * `pkg/lightning/runtime/engine.go`).
 *
 * Per-item `idempotencyKey` scopes the SDK's retry semantics for
 * that one write; omit to let the substrate derive a per-item key
 * from the batch-level idempotency key (when present) plus the
 * item's array index.
 */
export interface WriteBatchItem {
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Options for {@link db.writeBatch}. Mirrors the substrate
 * `runtime.BatchOptions` shape.
 *
 * Substrate-side default for `triggerFlows` is `true` (per the
 * goja installer in `extractBatchOptions`); the wrapper does not
 * override that default. Omit `triggerFlows` to keep it.
 */
export interface WriteBatchOpts {
  /**
   * Batch-level idempotency key. When set, the SDK records a
   * pointer-claim under this key so the whole batch can be
   * deduplicated on retry.
   */
  idempotencyKey?: string;
  /**
   * Whether action-flow dispatch fires for each successful write.
   * Mirrors `WriteOptions.TriggerFlows`. Defaults to true on the
   * substrate side.
   */
  triggerFlows?: boolean;
  /**
   * Caps the SDK's per-batch parallel write goroutine count. <= 0
   * uses the SDK's configured default (typically `WriteConcurrency`
   * from the Client config).
   */
  maxConcurrency?: number;
}

/**
 * Named-args input shape for {@link db.writeBatch}. The wrapper
 * repacks this into the substrate's positional `(formationId,
 * items, opts?)` calling convention.
 */
export interface WriteBatchInput {
  /** Single formation per call (substrate constraint). */
  formationId: string;
  items: WriteBatchItem[];
  opts?: WriteBatchOpts;
}

/**
 * Per-item entry in {@link WriteBatchResult.items}. Mirrors the
 * substrate `runtime.BatchItemResult` shape -- the keys that
 * `batchResultToJS` actually projects to the JS side.
 *
 * Discriminate success vs. failure on `error`: an empty/absent
 * `error` plus a non-empty `dropletId` means success. The
 * substrate's `WriteBatch` returns partial success -- some items
 * may succeed while others fail in the same call.
 */
export interface BatchItemResult {
  readonly index: number;
  readonly pathsWritten: string[];
  /** Populated on success. Empty/absent on failure. */
  readonly dropletId?: string;
  /** Populated when the formation had a declared scope-key. */
  readonly scopeValue?: string;
  /** Populated on failure; preserves the substrate's typed-error string. */
  readonly error?: string;
}

/**
 * Result shape from {@link db.writeBatch}. Mirrors the substrate
 * `runtime.BatchResult` shape (the GraphQL `BatchWriteResult`
 * projection) so a bolt that previously used the GraphQL path can
 * swap to the native binding without reshaping its result-handling.
 */
export interface WriteBatchResult {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly items: BatchItemResult[];
}

export interface ReadAtInput {
  formationId: string;
  scopeValue: string;
  /** ISO timestamp string OR a UUIDv7 dropletId (both time-sortable). */
  asOf: string;
}

export interface ReadCurrentInput {
  formationId: string;
  scopeValue: string;
}

/**
 * Named-args input for {@link db.expire}. The substrate operates
 * at the entity (scopeValue) level despite the SDK method being
 * named `ExpireDroplet` -- see substrate brain doc Q3 + the
 * SDKDatabase comment in `pkg/lightning/runtime/engine.go`.
 *
 * NOTE: the v0.1 stub shape had `dropletId`; that shape was
 * incorrect. The substrate's actual contract is per-entity. See
 * CHANGELOG v0.3.0 "Shape divergences from v0.1 stubs."
 */
export interface ExpireInput {
  formationId: string;
  scopeValue: string;
}

/**
 * Named-args input for {@link db.tag}. Tags are
 * `Record<string, string>` (S3 tag key=value pairs) per substrate
 * decision (brain doc Q1). The v0.1 stub used `string[]`; that
 * was incorrect.
 *
 * Additive semantics: existing tags not in the input remain
 * untouched. To replace the whole tag set, call {@link db.untag}
 * with the old keys first.
 */
export interface TagInput {
  formationId: string;
  scopeValue: string;
  tags: Record<string, string>;
}

/**
 * Named-args input for {@link db.untag}. `tagKeys` is the list of
 * tag KEY names to remove (string[]), not tag values. Idempotent
 * substrate-side: removing a key that wasn't tagged is not an
 * error.
 */
export interface UntagInput {
  formationId: string;
  scopeValue: string;
  tagKeys: string[];
}

// =====================================================================
// JSON-op wire shapes for ctx.db.mutate / mutateAndRead.
//
// These mirror the substrate's canonical codec exactly (the kinds
// storage.DecodeJSONOps decodes in pkg/storage/json_ops.go). The
// wrapper does NOT re-implement the codec -- it passes these objects
// through as-is; the host decodes + validates them. Discriminated on
// the `kind` field.
// =====================================================================

/**
 * Increment (or decrement, with a negative `by`) the int64-coerced
 * value at `path`. Missing intermediate keys are created on demand.
 * Spend a credit with `by: -1`; refund with `by: 1`.
 */
export interface JsonOpIncrement {
  kind: 'increment';
  path: string;
  by: number;
}

/** Replace the value at `path` with `value` (non-additive fields). */
export interface JsonOpSet {
  kind: 'set';
  path: string;
  value: unknown;
}

/**
 * Fold the int64 value at `from` into the int64 value at `to`, then
 * zero `from` when `reset` is true. Single-call drain primitive.
 */
export interface JsonOpMove {
  kind: 'move';
  from: string;
  to: string;
  reset?: boolean;
}

/**
 * Atomic fixed-window INCR+EXPIRE -- the passive-reset counter. If
 * `now - <windowStartPath> >= windowMs` (window expired, or first
 * ever use) the substrate resets `<countPath>` to `by` and stamps
 * `<windowStartPath>` to `nowMs`; otherwise it adds `by` to
 * `<countPath>`. This is what makes a monthly-resetting quota token
 * work in a bolt with no cron: the reset rides the next mutate.
 * Carry `nowMs` from the bolt (typically `Date.now()`); both paths
 * are dot-walked and missing leaves coerce to 0.
 */
export interface JsonOpWindowIncrement {
  kind: 'windowIncrement';
  countPath: string;
  windowStartPath: string;
  windowMs: number;
  by: number;
  nowMs: number;
}

/**
 * One JSON op for {@link db.mutate} / {@link db.mutateAndRead}.
 * Discriminated union over the substrate's canonical op kinds.
 */
export type JsonOp =
  | JsonOpIncrement
  | JsonOpSet
  | JsonOpMove
  | JsonOpWindowIncrement;

/** Named-args input for {@link db.mutate}. */
export interface MutateInput {
  formationId: string;
  scopeValue: string;
  ops: JsonOp[];
}

/** Named-args input for {@link db.mutateAndRead}. */
export interface MutateAndReadInput {
  formationId: string;
  scopeValue: string;
  ops: JsonOp[];
  /**
   * Unprefixed payload paths to read back after the mutate. Each maps
   * to its post-mutation int64 value in the returned record. The
   * substrate stamps the "payload." prefix internally.
   */
  readPaths: string[];
}

/**
 * Named-args input for {@link db.writeToken}. Named `WriteTokenDbInput`
 * to disambiguate from the `token` namespace's `WriteTokenInput`
 * (ctx.token.write) -- ctx.db.writeToken writes a token DROPLET to a
 * token formation, distinct from the token-namespace key/value API.
 */
export interface WriteTokenDbInput {
  formationId: string;
  payload: Record<string, unknown>;
}

// =====================================================================
// DbBinding interface -- shape of `BoltContext.db` (the raw goja
// installed surface). Methods are positional-args; method presence
// for stubs is optional (the namespace exists; individual methods
// arrive as the substrate ships them).
// =====================================================================

/**
 * Shape of `ctx.db` as the goja sandbox installs it.
 *
 * For bolt authors: prefer the package's exported `db` const (named-
 * args, typed errors). This raw type exists so `BoltContext.db` is
 * faithful to what `ctx` actually carries -- direct calls work as an
 * escape hatch.
 *
 * Calling conventions are the goja-installed positional ones; the
 * `db` wrapper repacks named-args inputs into these calls.
 */
export interface DbBinding {
  // --- LIVE ---
  readLatest(
    formationId: string,
    indexId: string,
    scopeValue: string,
  ): Promise<Droplet | null>;
  readDroplet(
    formationId: string,
    dropletId: string,
  ): Promise<Droplet | null>;
  writeDroplet(
    formationId: string,
    payload: Record<string, unknown>,
  ): Promise<DropletEnvelope>;
  listDroplets(
    formationId: string,
    opts?: CursorPaginationOpts,
  ): Promise<DropletsPage>;

  // --- LIVE since v0.2.0 (substrate commit af5e9eb) ---
  // Positional args per the goja installer. opts.first/after for
  // asc, opts.last/before for desc, plus opts.prefix narrowing.
  // Methods are typed optional (BoltContext.db is required, but
  // older lightning binaries may not carry these methods); the
  // wrapper guards with BindingNotInstalled.
  listKeys?: (
    formationId: string,
    indexId: string,
    opts?: CursorPaginationOpts,
  ) => Promise<KeyPage>;
  listSince?: (
    formationId: string,
    sinceCursor: string,
    opts?: CursorPaginationOpts,
  ) => Promise<SincePage>;

  // --- LIVE since v0.3.0 (substrate Tier 2 commit eee3eac) ---
  //
  // Positional args per the goja installer (see
  // `pkg/lightning/engines/goja/bindings.go::installDBBinding`).
  // Methods are typed optional because older lightning binaries
  // (pre-eee3eac) won't carry them; the wrapper guards with
  // BindingNotInstalled, matching the v0.2 listKeys/listSince
  // pattern.
  //
  // Tags shape: tag takes Record<string,string>; untag takes
  // string[] (KEY names to remove). See substrate brain doc Q1.
  tag?: (
    formationId: string,
    scopeValue: string,
    tags: Record<string, string>,
  ) => Promise<void>;
  untag?: (
    formationId: string,
    scopeValue: string,
    tagKeys: string[],
  ) => Promise<void>;
  /**
   * Flag the entity (formationId, scopeValue) for S3 lifecycle
   * deletion. The substrate operates at entity level despite the
   * SDK method name.
   */
  expire?: (formationId: string, scopeValue: string) => Promise<void>;
  /**
   * Returns the tenant-wide retention window in days. The substrate
   * binding takes NO args and surfaces a synchronous value; we
   * type it as Promise<number> so the SDK surface stays uniformly
   * awaitable.
   */
  expirationDays?: () => Promise<number> | number;
  /**
   * Atomic multi-droplet write to a single formation. The wrapper
   * repacks named-args into the substrate's positional convention.
   * Returns the substrate's `batchResultToJS` projection.
   */
  writeBatch?: (
    formationId: string,
    items: WriteBatchItem[],
    opts?: WriteBatchOpts,
  ) => Promise<WriteBatchResult>;

  // --- LIVE (substrate installDBBinding: mutate/mutateAndRead/writeToken) ---
  //
  // Positional args per the goja installer. Typed optional for
  // backwards-compat with lightning binaries that pre-date the
  // mutate/writeToken bindings; the wrapper guards with
  // BindingNotInstalled.
  mutate?: (
    formationId: string,
    scopeValue: string,
    ops: JsonOp[],
  ) => Promise<void>;
  mutateAndRead?: (
    formationId: string,
    scopeValue: string,
    ops: JsonOp[],
    readPaths: string[],
  ) => Promise<Record<string, number>>;
  writeToken?: (
    formationId: string,
    payload: Record<string, unknown>,
  ) => Promise<DropletEnvelope>;

  // --- STUBS (optional methods; substrate may not have shipped them) ---
  readAt?: (input: ReadAtInput) => Promise<Droplet | null>;
  readCurrent?: (input: ReadCurrentInput) => Promise<Droplet | null>;
  resolveFormation?: (dropletId: string) => Promise<string | null>;
}

// =====================================================================
// SDK wrapper -- the ergonomic surface bolts import.
// =====================================================================

/**
 * The ctx.db namespace -- ergonomic SDK wrapper.
 *
 * **LIVE**: readLatest, readDroplet, writeDroplet, listDroplets,
 *           listKeys (since v0.2.0), listSince (since v0.2.0),
 *           tag (since v0.3.0), untag (since v0.3.0),
 *           expire (since v0.3.0), expirationDays (since v0.3.0),
 *           writeBatch (since v0.3.0)
 * **STUB**: readAt, readCurrent, resolveFormation
 */
export const db = {
  /**
   * Read the freshest droplet for a (formationId, indexId, scopeValue)
   * tuple.
   *
   * LIVE binding -- substrate ships this in the base goja installer.
   *
   * @requires capability: `read` on the formation
   * @returns the droplet, or null when no droplet exists at that pointer
   * @throws CapabilityDenied when the bolt's capabilities.json does
   *   not declare `read` on the formation
   *
   * @example
   * ```ts
   * const agent = await db.readLatest({
   *   formationId: 'agent-graph',
   *   indexId: 'by-id',
   *   scopeValue: agentId,
   * });
   * if (agent === null) return { status: 404, body: 'not found' };
   * ```
   */
  async readLatest(input: ReadLatestInput): Promise<Droplet | null> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.db.readLatest(
        input.formationId,
        input.indexId,
        input.scopeValue,
      );
      return (out as Droplet | null) ?? null;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_readLatest,
        input,
      });
    }
  },

  /**
   * Read a specific droplet by ID. Returns the exact revision rather
   * than the formation's current pointer.
   *
   * LIVE binding.
   *
   * @requires capability: `read` on the formation
   * @returns the droplet, or null when the dropletId doesn't exist
   * @throws CapabilityDenied
   *
   * @example
   * ```ts
   * const droplet = await db.readDroplet({
   *   formationId: 'agent-graph',
   *   dropletId: 'a-018f...',
   * });
   * ```
   */
  async readDroplet(input: ReadDropletInput): Promise<Droplet | null> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.db.readDroplet(input.formationId, input.dropletId);
      return (out as Droplet | null) ?? null;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_readDroplet,
        input,
      });
    }
  },

  /**
   * Write a new droplet revision. The substrate assigns the
   * dropletId (UUIDv7) and updates pointers on every declared
   * index for the formation.
   *
   * LIVE binding.
   *
   * @requires capability: `write` on the formation
   * @returns the new droplet's envelope (carries dropletId)
   * @throws CapabilityDenied when capability missing
   * @throws ConditionFailed when the formation has CAS controls
   *   declared and the write doesn't satisfy them
   *
   * @example
   * ```ts
   * const { dropletId } = await db.writeDroplet({
   *   formationId: 'agent-graph',
   *   payload: { agentId: 'a-1', displayName: 'Bot' },
   * });
   * ```
   */
  async writeDroplet(input: WriteDropletInput): Promise<DropletEnvelope> {
    const ctx = resolveCtx();
    try {
      const out = (await ctx.db.writeDroplet(
        input.formationId,
        input.payload,
      )) as {
        dropletId?: unknown;
        pathsWritten?: string[];
        floatPaths?: string[];
        publicUrls?: string[];
        vectorRefs?: string[];
        warnings?: string[];
        scopeValue?: string;
        pointerETag?: string;
        durationMs?: number;
      };
      const id = out.dropletId;
      if (typeof id !== 'string') {
        throw new Error(
          'ctx.db.writeDroplet: substrate did not return dropletId string',
        );
      }
      // Carry the FULL 9-field write result -- the substrate returns
      // pathsWritten / floatPaths / publicUrls / vectorRefs / warnings /
      // scopeValue / pointerETag / durationMs alongside dropletId (parity with
      // the GraphQL writeDroplet -> WriteResult surface; shape-audit CYCLE 3,
      // completed to the full set). Optional fields present only when the
      // substrate emitted them.
      return {
        dropletId: id,
        ...(out.durationMs !== undefined ? { durationMs: out.durationMs } : {}),
        ...(out.pathsWritten ? { pathsWritten: out.pathsWritten } : {}),
        ...(out.floatPaths ? { floatPaths: out.floatPaths } : {}),
        ...(out.publicUrls ? { publicUrls: out.publicUrls } : {}),
        ...(out.vectorRefs ? { vectorRefs: out.vectorRefs } : {}),
        ...(out.warnings ? { warnings: out.warnings } : {}),
        ...(out.scopeValue ? { scopeValue: out.scopeValue } : {}),
        ...(out.pointerETag ? { pointerETag: out.pointerETag } : {}),
      };
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_writeDroplet,
        input,
      });
    }
  },

  /**
   * Enumerate droplets under a formation, optionally narrowed by semantic
   * entity scope or a raw intra-entity prefix. Returns full droplet
   * shapes; for keys-only walks use {@link listKeys} (STUBBED).
   *
   * LIVE binding.
   *
   * @requires capability: `list` on the formation
   * @returns array of droplets (page-sized; defaults to 50)
   * @throws CapabilityDenied
   *
   * @example
   * ```ts
   * let cursor: string | undefined;
   * for (;;) {
   *   const page = await db.listDroplets({
   *     formationId: 'broadcast',
   *     opts: { first: 100, ...(cursor ? { after: cursor } : {}) },
   *   });
   *   for (const d of page.droplets) await handle(d);
   *   if (!page.hasMore) break;
   *   cursor = page.nextCursor ?? undefined;
   * }
   * ```
   */
  async listDroplets(input: ListDropletsInput): Promise<DropletsPage> {
    const ctx = resolveCtx();
    // Merge the deprecated top-level pageSize/prefix into opts so old
    // call sites keep working while the canonical shape is opts.
    const opts: CursorPaginationOpts = {
      ...(input.opts ?? {}),
      ...(input.opts?.first === undefined && input.pageSize !== undefined
        ? { first: input.pageSize }
        : {}),
      ...(input.opts?.prefix === undefined && input.prefix !== undefined
        ? { prefix: input.prefix }
        : {}),
    };
    try {
      const out = await ctx.db.listDroplets(input.formationId, opts);
      return (out as DropletsPage) ?? { droplets: [], hasMore: false };
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_listDroplets,
        input,
      });
    }
  },

  /**
   * The VERSION HISTORY of one entity, newest-first: every revision droplet in
   * the entity's chain, each with its dropletId, write time, and the payload as
   * it was at that revision.
   *
   * This is RainDB's headline capability as ONE call: because every write is an
   * immutable droplet, the chain of droplets under an entity IS its full history
   * / audit trail / undo -- no versions table, no schema, no extra writes. Built
   * on the LIVE {@link listDroplets} (walks the entity prefix, paginating up to
   * `limit`), so it needs only the `list` capability on the formation.
   *
   * To read one revision's exact bytes, pass its `dropletId` to
   * {@link readDroplet}. To restore an old revision, write its payload back with
   * {@link writeDroplet} (the restore is itself a new revision -- history only
   * grows).
   *
   * @requires capability: `list` on the formation
   * @returns revisions sorted newest-first (by write time)
   *
   * @example
   * ```ts
   * const history = await db.versionHistory({ formationId: 'notes', scopeValue: id });
   * // history[0] is the current revision; history[1] the one before; ...
   * ```
   */
  async versionHistory(input: VersionHistoryInput): Promise<Revision[]> {
    const limit = input.limit ?? 200;
    const out: Revision[] = [];
    let cursor: string | undefined;
    // Walk pages of the entity's semantic scope until we have `limit` or run out.
    for (;;) {
      const page: DropletsPage = await this.listDroplets({
        formationId: input.formationId,
        opts: {
          scopeValue: input.scopeValue,
          first: Math.min(limit - out.length, 200),
          ...(cursor ? { after: cursor } : {}),
        },
      });
      for (const d of page.droplets) {
        out.push({
          dropletId: d.dropletId,
          ts: d.ts,
          payload: d.payload,
          ...(d.floatMeta ? { floatMeta: d.floatMeta } : {}),
        });
      }
      if (!page.hasMore || out.length >= limit) break;
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    // Newest-first: droplet ids are time-ordered (UUIDv7) and ts is the write
    // time; sort descending by ts so history[0] is the current revision.
    return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
  },

  // ===================================================================
  // STUBS -- substrate-side pending. Each calls stubOrDispatch which
  // throws BindingNotInstalled at runtime when the binding hasn't
  // landed yet, OR dispatches through if it has (in which case the
  // package author hasn't yet swapped the stub but the bolt benefits
  // immediately).
  // ===================================================================

  /**
   * Walk an index without reading droplet payloads -- the O(1)
   * firehose primitive for live feeds and paginated detail views.
   *
   * LIVE since v0.2.0 (audit §G Gap 2; substrate commit af5e9eb).
   *
   * Relay-style pagination: pass `opts.first` + `opts.after` to
   * walk ascending, or `opts.last` + `opts.before` to walk
   * descending. Mixing the two pairs is a substrate-side error.
   * Use `opts.prefix` to narrow within the index (only meaningful
   * for asc walks).
   *
   * @requires capability: `list` on the formation
   * @throws CapabilityDenied
   * @throws BindingNotInstalled when running against a lightning
   *   binary that pre-dates phoenix commit af5e9eb
   *
   * @example Asc walk with paging
   * ```ts
   * let cursor: string | undefined;
   * for (;;) {
   *   const page = await db.listKeys({
   *     formationId: 'broadcast',
   *     indexId: 'by-id',
   *     opts: { first: 100, ...(cursor ? { after: cursor } : {}) },
   *   });
   *   for (const k of page.keys) await processKey(k);
   *   if (!page.hasMore) break;
   *   cursor = page.nextCursor ?? undefined;
   * }
   * ```
   */
  async listKeys(input: ListKeysInput): Promise<KeyPage> {
    const ctx = resolveCtx();
    if (typeof ctx.db.listKeys !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_listKeys} requires ctx.db.listKeys which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.2.0; the substrate-side binding landed in ` +
          `phoenix commit af5e9eb. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_listKeys, input },
      );
    }
    try {
      const out = await ctx.db.listKeys(
        input.formationId,
        input.indexId,
        input.opts ?? {},
      );
      return out as KeyPage;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_listKeys,
        input,
      });
    }
  },

  /**
   * Asc-poll-from-cursor over the `by-update` index. The live-feed
   * primitive: returns the next page of droplets following
   * `sinceCursor`. Pass empty string for "from the beginning."
   *
   * LIVE since v0.2.0 (audit §G Gap 2; substrate commit af5e9eb).
   *
   * Unlike {@link listKeys}, this returns FULL droplet payloads
   * (the substrate's projection is `[]map[string]any` per
   * `ListSincePage`). Result page is a {@link SincePage}, distinct
   * from {@link KeyPage}.
   *
   * Only asc pagination is meaningful for live feeds; `opts.first`
   * and `opts.after` are honored. `opts.prefix` is ignored
   * substrate-side (the by-update index has no scope prefix).
   *
   * @requires capability: `list` on the formation
   * @throws CapabilityDenied
   * @throws BindingNotInstalled when running against a lightning
   *   binary that pre-dates phoenix commit af5e9eb
   *
   * @example
   * ```ts
   * const page = await db.listSince({
   *   formationId: 'broadcast',
   *   sinceCursor: lastSeen ?? '',
   *   opts: { first: 50 },
   * });
   * for (const d of page.droplets) await fanOut(d);
   * if (page.nextCursor) await persistCursor(page.nextCursor);
   * ```
   */
  async listSince(input: ListSinceInput): Promise<SincePage> {
    const ctx = resolveCtx();
    if (typeof ctx.db.listSince !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_listSince} requires ctx.db.listSince which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.2.0; the substrate-side binding landed in ` +
          `phoenix commit af5e9eb. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_listSince, input },
      );
    }
    try {
      const out = await ctx.db.listSince(
        input.formationId,
        input.sinceCursor,
        input.opts ?? {},
      );
      return out as SincePage;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_listSince,
        input,
      });
    }
  },

  /**
   * Add S3 tag key=value pairs to an entity (formationId,
   * scopeValue). Additive semantics -- existing tags not in the
   * input remain untouched. Tags drive S3 lifecycle policies and
   * the vector index's filter inputs.
   *
   * LIVE since v0.3.0 (audit §L Gap 7; substrate commit eee3eac).
   *
   * @requires capability: `tag` on the formation (NEW canonical op,
   *   distinct from `write` -- a bolt with droplet-write access may
   *   not need tag-mutation access and vice versa).
   * @throws CapabilityDenied
   * @throws BindingNotInstalled when running against a lightning
   *   binary that pre-dates phoenix commit eee3eac
   *
   * @example
   * ```ts
   * await db.tag({
   *   formationId: 'agent-graph',
   *   scopeValue: 'a-018f...',
   *   tags: { 'env': 'prod', 'tier': 'gold' },
   * });
   * ```
   */
  async tag(input: TagInput): Promise<void> {
    const ctx = resolveCtx();
    if (typeof ctx.db.tag !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_tag} requires ctx.db.tag which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.3.0; the substrate-side binding landed in ` +
          `phoenix commit eee3eac. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_tag, input },
      );
    }
    try {
      await ctx.db.tag(input.formationId, input.scopeValue, input.tags);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_tag,
        input,
      });
    }
  },

  /**
   * Remove the named tag KEYS from an entity. Idempotent --
   * removing a key that wasn't tagged is not an error.
   *
   * LIVE since v0.3.0 (audit §L Gap 7; substrate commit eee3eac).
   *
   * @requires capability: `tag` on the formation
   * @throws CapabilityDenied
   * @throws BindingNotInstalled on pre-eee3eac runtime
   *
   * @example
   * ```ts
   * await db.untag({
   *   formationId: 'agent-graph',
   *   scopeValue: 'a-018f...',
   *   tagKeys: ['tier'],
   * });
   * ```
   */
  async untag(input: UntagInput): Promise<void> {
    const ctx = resolveCtx();
    if (typeof ctx.db.untag !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_untag} requires ctx.db.untag which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.3.0; the substrate-side binding landed in ` +
          `phoenix commit eee3eac. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_untag, input },
      );
    }
    try {
      await ctx.db.untag(input.formationId, input.scopeValue, input.tagKeys);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_untag,
        input,
      });
    }
  },

  /**
   * Atomic multi-droplet write to a single formation. The
   * substrate's WriteBatch is single-formation only (matches SDK
   * reality; see substrate brain doc Q5). For cross-formation
   * writes, issue multiple writeBatch calls.
   *
   * LIVE since v0.3.0 (audit §I Gap 4; substrate commit eee3eac).
   *
   * Per-item `idempotencyKey` scopes individual retry semantics;
   * the batch-level `opts.idempotencyKey` claims the whole batch
   * under a single pointer for batch-level dedup. Partial success
   * is the substrate's contract: inspect each
   * {@link BatchItemResult.error} to discriminate item success vs.
   * failure -- `failed > 0` does NOT mean the whole call rejected.
   *
   * @requires capability: `write` on the formation. The wrapper's
   *   capability check is one OpWrite call on the formationId;
   *   per-item formation overrides are NOT supported (the SDK's
   *   `WriteBatch` signature does not support them).
   * @throws CapabilityDenied when `write` is not declared
   * @throws BindingNotInstalled on pre-eee3eac runtime
   *
   * @example
   * ```ts
   * const r = await db.writeBatch({
   *   formationId: 'agent-graph',
   *   items: [
   *     { payload: { agentId: 'a-1', name: 'Bot' } },
   *     { payload: { agentId: 'a-2', name: 'Bee' }, idempotencyKey: 'a-2-init' },
   *   ],
   *   opts: { idempotencyKey: 'agents-init-v1', triggerFlows: true },
   * });
   * if (r.failed > 0) {
   *   for (const it of r.items) {
   *     if (it.error) log.warn('batch item failed', { index: it.index, error: it.error });
   *   }
   * }
   * ```
   */
  async writeBatch(input: WriteBatchInput): Promise<WriteBatchResult> {
    const ctx = resolveCtx();
    if (typeof ctx.db.writeBatch !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_writeBatch} requires ctx.db.writeBatch which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.3.0; the substrate-side binding landed in ` +
          `phoenix commit eee3eac. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_writeBatch, input },
      );
    }
    try {
      const out = await ctx.db.writeBatch(
        input.formationId,
        input.items,
        input.opts,
      );
      return out as WriteBatchResult;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_writeBatch,
        input,
      });
    }
  },

  /**
   * STUB (audit §R Gap 13). Point-in-time read via the periscope-
   * managed historical snapshot.
   *
   * @requires capability: `read` on the formation
   * @throws BindingNotInstalled until substrate ships ctx.db.readAt
   */
  async readAt(input: ReadAtInput): Promise<Droplet | null> {
    const ctx = resolveCtx();
    return stubOrDispatch<Droplet | null>(
      BINDING.db_readAt,
      () => ctx.db.readAt,
      (fn) => (fn as (i: ReadAtInput) => Promise<Droplet | null>)(input),
      input,
    );
  },

  /**
   * STUB (audit §S Gap 14). Shorthand for readLatest with the default
   * `by-id` index.
   *
   * @requires capability: `read` on the formation
   * @throws BindingNotInstalled until substrate ships ctx.db.readCurrent
   */
  async readCurrent(input: ReadCurrentInput): Promise<Droplet | null> {
    const ctx = resolveCtx();
    return stubOrDispatch<Droplet | null>(
      BINDING.db_readCurrent,
      () => ctx.db.readCurrent,
      (fn) =>
        (fn as (i: ReadCurrentInput) => Promise<Droplet | null>)(input),
      input,
    );
  },

  /**
   * STUB (audit §S Gap 14). Given a dropletId, return the formationId
   * it belongs to. Useful for cross-formation references where the
   * bolt doesn't track formation alongside dropletId.
   *
   * @returns formationId, or null when the dropletId doesn't exist
   * @throws BindingNotInstalled until substrate ships ctx.db.resolveFormation
   */
  async resolveFormation(dropletId: string): Promise<string | null> {
    const ctx = resolveCtx();
    return stubOrDispatch<string | null>(
      BINDING.db_resolveFormation,
      () => ctx.db.resolveFormation,
      (fn) => (fn as (id: string) => Promise<string | null>)(dropletId),
      { dropletId },
    );
  },

  /**
   * Flag the entity (formationId, scopeValue) for S3 lifecycle
   * deletion. All revision droplets, floats, and embedding-index
   * entries for that entity are marked for cleanup; the vector
   * cleanup cascades.
   *
   * LIVE since v0.3.0 (audit §M Gap 8; substrate commit eee3eac).
   *
   * Destructive -- a separate capability op from `write` per
   * audit §M: expiration cascades destructively and SHOULD NOT be
   * implicit in write capability. A bolt declaring `expire`
   * explicitly opts into "I may retire my own data."
   *
   * NOTE: the substrate SDK method is named `ExpireDroplet` but
   * operates at the entity (scopeValue) level, NOT per-droplet.
   * The v0.1 stub typed `{formationId, dropletId}` -- that was
   * incorrect. See CHANGELOG v0.3.0 "Shape divergences from v0.1
   * stubs."
   *
   * @requires capability: `expire` on the formation
   * @throws CapabilityDenied
   * @throws BindingNotInstalled on pre-eee3eac runtime
   *
   * @example
   * ```ts
   * await db.expire({ formationId: 'agent-graph', scopeValue: 'a-018f...' });
   * ```
   */
  async expire(input: ExpireInput): Promise<void> {
    const ctx = resolveCtx();
    if (typeof ctx.db.expire !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_expire} requires ctx.db.expire which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.3.0; the substrate-side binding landed in ` +
          `phoenix commit eee3eac. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_expire, input },
      );
    }
    try {
      await ctx.db.expire(input.formationId, input.scopeValue);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_expire,
        input,
      });
    }
  },

  /**
   * Read the tenant-wide retention window (in days). Surfaces the
   * SDK's `Client.ExpirationDays()` accessor.
   *
   * LIVE since v0.3.0 (audit §M Gap 8; substrate commit eee3eac).
   *
   * Takes NO arguments -- the value is tenant-wide, not per
   * formation/scope (per substrate brain doc Q4). The v0.1 stub
   * typed `{formationId, scopeValue}` -- that was incorrect.
   *
   * Returns 0 when no retention rule is configured for the tenant.
   *
   * No capability gate (the value is metadata, not data).
   *
   * @throws BindingNotInstalled on pre-eee3eac runtime
   *
   * @example
   * ```ts
   * const days = await db.expirationDays();
   * if (days === 0) log.info('no retention rule configured for tenant');
   * ```
   */
  async expirationDays(): Promise<number> {
    const ctx = resolveCtx();
    if (typeof ctx.db.expirationDays !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_expirationDays} requires ctx.db.expirationDays ` +
          `which is not installed in this bolt runtime. The ` +
          `@raindb/bolt-sdk wrapper is LIVE since v0.3.0; the ` +
          `substrate-side binding landed in phoenix commit eee3eac. See ` +
          `raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `for the gap card that owns this surface.`,
        { binding: BINDING.db_expirationDays },
      );
    }
    try {
      // The goja installer surfaces ExpirationDays as a synchronous
      // value (no Promise wrap). Promise.resolve normalizes both
      // shapes so the wrapper stays awaitable regardless of how the
      // host returns it.
      const out = await Promise.resolve(ctx.db.expirationDays());
      return out as number;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_expirationDays,
      });
    }
  },

  /**
   * Atomic read-modify-write on a cache-backed token entity. Applies
   * the `ops` under the owning host's entry mutex -- the single
   * authoritative serialization point -- so concurrent bolts never
   * lose an increment. The owning formation must declare
   * `lifecycle.autoCache: true`; the substrate enforces that and
   * prefixes op paths with `payload.`.
   *
   * LIVE. Backed by sdk.Client.Mutate.
   *
   * @requires capability: `mutate` on the formation (distinct from
   *   `write` -- a bolt that may bump a counter need not hold full
   *   droplet-write access). Authority stays tenant-scoped: a bolt
   *   mutating a platform-owned protected token is denied by the
   *   substrate's write-authorization wall, exactly as a direct SDK
   *   caller would be.
   * @throws CapabilityDenied when `mutate` is not declared
   * @throws BindingNotInstalled on a lightning binary that pre-dates
   *   the mutate binding
   *
   * @example Spend one credit
   * ```ts
   * await db.mutate({
   *   formationId: 'invite-quota',
   *   scopeValue: tenantId,
   *   ops: [{ kind: 'increment', path: 'used', by: 1 }],
   * });
   * ```
   */
  async mutate(input: MutateInput): Promise<void> {
    const ctx = resolveCtx();
    if (typeof ctx.db.mutate !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_mutate} requires ctx.db.mutate which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.5.0; the substrate-side binding is installed ` +
          `by raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `(and internal/lightning/podchannel for the pod engine). ` +
          `Redeploy the bolt against a lightning runtime that ships it.`,
        { binding: BINDING.db_mutate, input },
      );
    }
    try {
      await ctx.db.mutate(input.formationId, input.scopeValue, input.ops);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_mutate,
        input,
      });
    }
  },

  /**
   * Atomic read-modify-write PLUS read-back of the post-mutation
   * int64 values at `readPaths`, in ONE atomic op. This is the
   * subtract-a-counter-and-read-the-remaining-value primitive: pair
   * a `windowIncrement` op with a read of the count path to bump a
   * monthly quota and learn the new total in a single call, with the
   * window passively resetting when it rolls over -- no cron. Mirrors
   * the substrate's fleet rate-limiter (pkg/sdk/fleet_ratelimit.go).
   *
   * LIVE. Backed by sdk.Client.MutateAndRead.
   *
   * @requires capability: `mutate` on the formation
   * @returns a record mapping each `readPath` to its post-mutation
   *   int64 value
   * @throws CapabilityDenied when `mutate` is not declared
   * @throws BindingNotInstalled on a pre-mutate lightning binary
   *
   * @example Monthly-resetting invite quota: consume one, read remaining
   * ```ts
   * const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
   * const vals = await db.mutateAndRead({
   *   formationId: 'invite-quota',
   *   scopeValue: tenantId,
   *   ops: [{
   *     kind: 'windowIncrement',
   *     countPath: 'used',
   *     windowStartPath: 'windowStartMs',
   *     windowMs: MONTH_MS,
   *     by: 1,
   *     nowMs: Date.now(),
   *   }],
   *   readPaths: ['used'],
   * });
   * const used = vals.used ?? 0;         // resets to 1 on a new month
   * if (used > MONTHLY_LIMIT) return { status: 429, body: 'quota exceeded' };
   * ```
   */
  async mutateAndRead(
    input: MutateAndReadInput,
  ): Promise<Record<string, number>> {
    const ctx = resolveCtx();
    if (typeof ctx.db.mutateAndRead !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_mutateAndRead} requires ctx.db.mutateAndRead which ` +
          `is not installed in this bolt runtime. The @raindb/bolt-sdk ` +
          `wrapper is LIVE since v0.5.0; the substrate-side binding is ` +
          `installed by raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `(and internal/lightning/podchannel for the pod engine). ` +
          `Redeploy the bolt against a lightning runtime that ships it.`,
        { binding: BINDING.db_mutateAndRead, input },
      );
    }
    try {
      const out = await ctx.db.mutateAndRead(
        input.formationId,
        input.scopeValue,
        input.ops,
        input.readPaths,
      );
      return (out as Record<string, number>) ?? {};
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_mutateAndRead,
        input,
      });
    }
  },

  /**
   * Write a token droplet to a token formation. Unlike
   * {@link db.writeDroplet} (which routes entity formations), this
   * targets a formation whose type is a token: the substrate stamps
   * the author (`bolt:<boltId>`), resolves the scopeValue from the
   * payload's scopeKey, and applies token-lifecycle expiration.
   *
   * LIVE. Backed by sdk.Client.WriteToken.
   *
   * @requires capability: `token-write` on the formation
   * @returns the written token's envelope (carries dropletId)
   * @throws CapabilityDenied when `token-write` is not declared
   * @throws ConditionFailed / TokenExists when the token formation
   *   declares CAS / create-only controls the write doesn't satisfy
   * @throws BindingNotInstalled on a pre-writeToken lightning binary
   *
   * @example
   * ```ts
   * const { dropletId } = await db.writeToken({
   *   formationId: 'invite-quota',
   *   payload: { tenantId, used: 0, windowStartMs: Date.now() },
   * });
   * ```
   */
  async writeToken(input: WriteTokenDbInput): Promise<DropletEnvelope> {
    const ctx = resolveCtx();
    if (typeof ctx.db.writeToken !== 'function') {
      throw new BindingNotInstalled(
        `${BINDING.db_writeToken} requires ctx.db.writeToken which is not ` +
          `installed in this bolt runtime. The @raindb/bolt-sdk wrapper ` +
          `is LIVE since v0.5.0; the substrate-side binding is installed ` +
          `by raindb-prime pkg/lightning/engines/goja/bindings.go ` +
          `(and internal/lightning/podchannel for the pod engine). ` +
          `Redeploy the bolt against a lightning runtime that ships it.`,
        { binding: BINDING.db_writeToken, input },
      );
    }
    try {
      const out = await ctx.db.writeToken(input.formationId, input.payload);
      const id = (out as { dropletId?: unknown }).dropletId;
      if (typeof id !== 'string') {
        throw new Error(
          'ctx.db.writeToken: substrate did not return dropletId string',
        );
      }
      return { dropletId: id };
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_writeToken,
        input,
      });
    }
  },
};
