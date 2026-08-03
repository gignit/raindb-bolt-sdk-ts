// types/droplet.ts -- droplet-shaped types shared across binding wrappers.
//
// Cross-validation reference: per handoff §J, these shapes match
// @raindb/agent's DropletResult, DropletPage, KeyEntry, KeyPage,
// WriteResult, BulkDropletResult so a bolt that uses both packages
// composes without translation overhead. See test/unit/shape-compat/
// for the structural-equivalence proofs.
//
// Field naming is camelCase; nullable fields use `?` (optional with
// possibly absent value). Date strings are RFC3339 `string`. These
// rules mirror @raindb/agent's projection style per handoff §J.3.

/**
 * One droplet revision -- the canonical RainDB content unit.
 *
 * Mirrors @raindb/agent's `DropletResult` (see
 * `~/src/raindb-agent-ts/src/tools/droplet.ts`) field-for-field so
 * the two surfaces are interchangeable. The substrate side's
 * canonical Go shape is `internal/ops/droplet.go::DropletResult`.
 *
 * @see DropletEnvelope for the wrapper type carrying the optional
 *   `pointerETag` from a write/read result.
 */
export interface Droplet {
  readonly dropletId: string;
  readonly formationId: string;
  readonly schemaVersion: number;
  /**
   * Write timestamp in Unix MILLISECONDS. The substrate emits the Go
   * `Droplet.TS int64` unchanged, so this is a JS `number` -- NOT a
   * string. (Corrected from a prior `string` typo that never matched
   * the runtime value on either engine.)
   */
  readonly ts: number;
  readonly author: string;
  readonly tenantId?: string;
  /**
   * Present only on droplets written as part of a batch (`db.writeBatch`).
   * Emitted by the substrate only when non-empty (Go omitempty), so it is
   * `undefined` on a single-write droplet.
   */
  readonly batchId?: string;
  readonly payload: Record<string, unknown> | null;
  /**
   * Per-float metadata records, one entry per floated binary field. An
   * ARRAY (the Go shape is `[]map[string]any`); present only when the
   * droplet has floated fields. Was previously mistyped as a single
   * object.
   */
  readonly floatMeta?: Record<string, unknown>[];
  readonly pointerETag?: string | null;
}

/**
 * Page of droplets returned from listing operations.
 * Mirrors @raindb/agent's `DropletPage`.
 */
export interface DropletPage {
  readonly droplets: Droplet[];
  readonly nextCursor?: string | null;
  readonly hasMore: boolean;
}

/**
 * Envelope for a written droplet -- the result of `db.writeDroplet`.
 * Mirrors @raindb/agent's `WriteResult` shape minus the agent-only
 * `durationMs` (the bolt SDK doesn't synthesize wall time).
 */
export interface DropletEnvelope {
  readonly dropletId: string;
}

/**
 * Full write result from `db.writeBatch` (STUBBED) -- mirrors
 * @raindb/agent's `WriteResult`. Optional fields come from the
 * substrate's projection of pointer-claim outcomes.
 */
export interface WriteResult {
  readonly dropletId: string;
  readonly pathsWritten: string[];
  readonly floatPaths: string[];
  readonly publicUrls: string[];
  readonly vectorRefs: string[];
  readonly warnings: string[];
  readonly scopeValue?: string | null;
  readonly pointerETag?: string | null;
  readonly durationMs: number;
}

/**
 * Per-item result of `db.writeBatch` (STUBBED). Mirrors
 * @raindb/agent's `BulkDropletResult`.
 */
export interface BulkDropletResult {
  readonly index: number;
  readonly dropletId?: string;
  readonly scopeValue?: string;
  readonly succeeded: boolean;
  readonly error?: string;
}

/**
 * One key in a `db.listKeys` result. Mirrors @raindb/agent's
 * `KeyEntry`. The `etag` field is added as an optional extension
 * over the agent's shape because the substrate's `ListKeyEntry`
 * (runtime/engine.go) carries S3 ETag; the goja installer surfaces
 * it as the `etag` field only when non-empty. Agent-shape compat
 * is preserved (extra optional fields are structurally tolerated).
 */
export interface KeyEntry {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
  /**
   * S3 ETag for the underlying pointer object. Absent when the
   * substrate did not surface one (older index entries, in-memory
   * pointers). Added in v0.2.0 alongside the LIVE listKeys swap.
   */
  readonly etag?: string;
}

/**
 * Page of keys from `db.listKeys`. Mirrors @raindb/agent's
 * `KeyPage`.
 */
export interface KeyPage {
  readonly keys: KeyEntry[];
  readonly nextCursor?: string | null;
  readonly hasMore: boolean;
  readonly totalCount: number;
}

/**
 * Page of droplets returned from `db.listSince` -- the asc-poll-
 * from-cursor live-feed primitive. Distinct from {@link KeyPage}
 * because listSince returns full droplet payloads (the substrate's
 * `ListSincePage.Droplets` is `[]map[string]any`, projected as
 * full droplets to the JS side per
 * `pkg/lightning/engines/goja/bindings.go::listSincePageToJS`).
 *
 * Added in v0.2.0. The v0.1 stub typed listSince as `KeyPage` --
 * that was incorrect; this is a shape divergence resolved in favor
 * of the substrate's actual contract.
 */
export interface SincePage {
  readonly droplets: Droplet[];
  readonly nextCursor?: string | null;
  readonly hasMore: boolean;
}

/**
 * Page of droplets returned from `db.listDroplets` -- the enumerate-
 * under-a-formation primitive with Relay-style cursor pagination.
 * Mirrors {@link SincePage}; the substrate's `ListDropletsPage` is
 * projected to JS by
 * `pkg/lightning/engines/goja/bindings.go::listDropletsPageToJS`.
 *
 * Added when listDroplets gained pagination (substrate H12 fix). The
 * prior wrapper returned a bare `Droplet[]` and could only ever see the
 * first page; this page carries `nextCursor` + `hasMore` so a bolt can
 * walk the whole formation and detect truncation.
 */
export interface DropletsPage {
  readonly droplets: Droplet[];
  readonly nextCursor?: string | null;
  readonly hasMore: boolean;
}
