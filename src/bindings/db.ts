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
// LIVE methods (audit §B / §G; goja installer in
// `pkg/lightning/engines/goja/bindings.go::installDBBinding`):
//   - readLatest(formationId, indexId, scopeValue)
//   - readDroplet(formationId, dropletId)
//   - writeDroplet(formationId, payload)
//   - listDroplets(formationId, prefix?, pageSize?)
//   - listKeys(formationId, indexId, opts?)         [LIVE since v0.2.0]
//   - listSince(formationId, sinceCursor, opts?)    [LIVE since v0.2.0]
//
// STUBBED methods (substrate-side pending; per-method JSDoc points
// at the audit gap card):
//   - writeBatch (audit §I Gap 4)
//   - readAt (audit §R Gap 13)
//   - readCurrent, resolveFormation (audit §S Gap 14)
//   - expire, expirationDays (audit §M Gap 8)
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
  KeyPage,
  SincePage,
  WriteResult,
  BulkDropletResult,
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

export interface WriteDropletInput {
  formationId: string;
  payload: Record<string, unknown>;
}

export interface ListDropletsInput {
  formationId: string;
  prefix?: string;
  pageSize?: number;
}

export interface ListKeysInput {
  formationId: string;
  /**
   * Index name on the formation. Use `by-id-latest` for the
   * default pointer-by-id index. Required.
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

export interface WriteBatchItem {
  formationId: string;
  payload: Record<string, unknown>;
}

export interface WriteBatchInput {
  items: WriteBatchItem[];
  opts?: {
    idempotencyKey?: string;
    triggerFlows?: boolean;
    author?: string;
  };
}

export interface WriteBatchResult {
  writes: WriteResult[];
  bulkResults?: BulkDropletResult[];
  idempotencyHit: boolean;
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

export interface ExpireInput {
  formationId: string;
  dropletId: string;
}

export interface ExpirationDaysInput {
  formationId: string;
  scopeValue: string;
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
    prefix?: string,
    pageSize?: number,
  ): Promise<Droplet[]>;

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

  // --- STUBS (optional methods; substrate may not have shipped them) ---
  writeBatch?: (input: WriteBatchInput) => Promise<WriteBatchResult>;
  readAt?: (input: ReadAtInput) => Promise<Droplet | null>;
  readCurrent?: (input: ReadCurrentInput) => Promise<Droplet | null>;
  resolveFormation?: (dropletId: string) => Promise<string | null>;
  expire?: (input: ExpireInput) => Promise<void>;
  expirationDays?: (input: ExpirationDaysInput) => Promise<number>;
}

// =====================================================================
// SDK wrapper -- the ergonomic surface bolts import.
// =====================================================================

/**
 * The ctx.db namespace -- ergonomic SDK wrapper.
 *
 * **LIVE**: readLatest, readDroplet, writeDroplet, listDroplets,
 *           listKeys (since v0.2.0), listSince (since v0.2.0)
 * **STUB**: writeBatch, readAt, readCurrent, resolveFormation,
 *           expire, expirationDays
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
   *   indexId: 'by-id-latest',
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
      const out = await ctx.db.writeDroplet(input.formationId, input.payload);
      const id = (out as { dropletId?: unknown }).dropletId;
      if (typeof id !== 'string') {
        throw new Error(
          'ctx.db.writeDroplet: substrate did not return dropletId string',
        );
      }
      return { dropletId: id };
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_writeDroplet,
        input,
      });
    }
  },

  /**
   * Enumerate droplets under a formation prefix. Returns full droplet
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
   * const recent = await db.listDroplets({
   *   formationId: 'broadcast',
   *   prefix: 'topic/observability/',
   *   pageSize: 100,
   * });
   * ```
   */
  async listDroplets(input: ListDropletsInput): Promise<Droplet[]> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.db.listDroplets(
        input.formationId,
        input.prefix,
        input.pageSize,
      );
      return (out as Droplet[]) ?? [];
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.db_listDroplets,
        input,
      });
    }
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
   *     indexId: 'by-id-latest',
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
          `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md §G ` +
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
          `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md §G ` +
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
   * STUB (audit §I Gap 4). Atomic multi-droplet write across one or
   * more formations.
   *
   * @requires capability: `write` on every referenced formation
   * @throws BindingNotInstalled until substrate ships ctx.db.writeBatch
   * @throws CapabilityDenied for the first missing formation
   */
  async writeBatch(input: WriteBatchInput): Promise<WriteBatchResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<WriteBatchResult>(
      BINDING.db_writeBatch,
      () => ctx.db.writeBatch,
      (fn) =>
        (fn as (i: WriteBatchInput) => Promise<WriteBatchResult>)(input),
      input,
    );
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
   * `by-id-latest` index.
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
   * STUB (audit §M Gap 8). Flag a specific droplet for tier-1
   * retention expiry; cascades vector cleanup.
   *
   * @requires capability: `expire` on the formation (NEW canonical op,
   *   distinct from `write` -- see audit §M for rationale)
   * @throws BindingNotInstalled until substrate ships ctx.db.expire
   * @throws CapabilityDenied
   */
  async expire(input: ExpireInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.db_expire,
      () => ctx.db.expire,
      (fn) => (fn as (i: ExpireInput) => Promise<void>)(input),
      input,
    );
  },

  /**
   * STUB (audit §M Gap 8). Read the formation's declared retention
   * window for a scope. Returns days; 0 means "no retention rule".
   *
   * @requires capability: `read` on the formation
   * @throws BindingNotInstalled until substrate ships ctx.db.expirationDays
   */
  async expirationDays(input: ExpirationDaysInput): Promise<number> {
    const ctx = resolveCtx();
    return stubOrDispatch<number>(
      BINDING.db_expirationDays,
      () => ctx.db.expirationDays,
      (fn) => (fn as (i: ExpirationDaysInput) => Promise<number>)(input),
      input,
    );
  },
};
