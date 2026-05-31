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
  readonly ts: string;
  readonly author: string;
  readonly tenantId?: string;
  readonly batchId?: string;
  readonly payload: Record<string, unknown> | null;
  readonly floatMeta?: Record<string, unknown> | null;
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
 * One key in a `db.listKeys` (STUBBED) result. Mirrors
 * @raindb/agent's `KeyEntry`.
 */
export interface KeyEntry {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
}

/**
 * Page of keys from `db.listKeys` (STUBBED). Mirrors
 * @raindb/agent's `KeyPage`.
 */
export interface KeyPage {
  readonly keys: KeyEntry[];
  readonly nextCursor?: string | null;
  readonly hasMore: boolean;
  readonly totalCount: number;
}
