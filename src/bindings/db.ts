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
// LIVE methods (audit §B; goja installer in
// `pkg/lightning/engines/goja/bindings.go::installDBBinding`):
//   - readLatest(formationId, indexId, scopeValue)
//   - readDroplet(formationId, dropletId)
//   - writeDroplet(formationId, payload)
//   - listDroplets(formationId, prefix?, pageSize?)
//
// STUBBED methods (substrate-side pending; per-method JSDoc points
// at the audit gap card):
//   - listKeys, listSince (audit §G Gap 2)
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
import { BINDING } from '../internal/constants.js';
import type {
  Droplet,
  DropletEnvelope,
  KeyPage,
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
  indexId: string;
  opts?: CursorPaginationOpts;
}

export interface ListSinceInput {
  formationId: string;
  sinceCursor?: string;
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

  // --- STUBS (optional methods; substrate may not have shipped them) ---
  listKeys?: (input: ListKeysInput) => Promise<KeyPage>;
  listSince?: (input: ListSinceInput) => Promise<KeyPage>;
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
 * **LIVE**: readLatest, readDroplet, writeDroplet, listDroplets
 * **STUB**: listKeys, listSince, writeBatch, readAt, readCurrent,
 *           resolveFormation, expire, expirationDays
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
   * STUB (audit §G Gap 2). Walk an index without reading droplet
   * payloads -- O(1) firehose primitive for live feeds.
   *
   * @requires capability: `list` on the formation
   * @throws BindingNotInstalled until substrate ships ctx.db.listKeys
   */
  async listKeys(input: ListKeysInput): Promise<KeyPage> {
    const ctx = resolveCtx();
    return stubOrDispatch<KeyPage>(
      BINDING.db_listKeys,
      () => ctx.db.listKeys,
      (fn) => (fn as (i: ListKeysInput) => Promise<KeyPage>)(input),
      input,
    );
  },

  /**
   * STUB (audit §G Gap 2). Asc-poll-from-cursor live-feed primitive.
   *
   * @throws BindingNotInstalled until substrate ships ctx.db.listSince
   */
  async listSince(input: ListSinceInput): Promise<KeyPage> {
    const ctx = resolveCtx();
    return stubOrDispatch<KeyPage>(
      BINDING.db_listSince,
      () => ctx.db.listSince,
      (fn) => (fn as (i: ListSinceInput) => Promise<KeyPage>)(input),
      input,
    );
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
