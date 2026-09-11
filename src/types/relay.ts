// types/relay.ts -- relay-shaped types for the STUBBED ctx.relay surface.

/**
 * The address that uniquely identifies a relay. Mirrors
 * @raindb/agent's `RelayAddress`.
 */
export interface RelayAddress {
  readonly formationId: string;
  readonly entityId: string;
  readonly relayId: string;
  readonly parentId?: string;
  readonly primaryId?: string;
}

/**
 * One log entry on a relay. Mirrors @raindb/agent's `RelayLogEntry`.
 */
export interface RelayLogEntry {
  readonly logId: string;
  readonly type: string;
  readonly data: string;
  readonly ts: string;
}

/**
 * The full relay result returned from `relay.read` etc.
 *
 * Mirrors @raindb/agent's `RelayResult`. Optional fields appear when
 * the read requested them (e.g. `includeLog: true` populates `logs`).
 */
export interface RelayResult {
  readonly relayId: string;
  readonly parentId?: string | null;
  readonly primaryId?: string | null;
  readonly formationId: string;
  readonly entityId: string;
  readonly relayType?: string;
  readonly status: string;
  readonly details?: Record<string, unknown> | null;
  readonly logIds?: string[];
  readonly logs?: RelayLogEntry[];
  readonly subRelays?: RelayResult[];
}

/**
 * Options for `relay.read`.
 */
export interface ReadRelayOptions {
  /** Hydrate the `logs` array on the returned RelayResult. */
  includeLog?: boolean;
  /** Cap the log array to N entries (most recent first). */
  logLimit?: number;
}

/**
 * Details payload for `relay.write` / `relay.updateStatus`.
 * Free-form; substrate-side validates against the relay-formation's
 * declared schema.
 */
export interface RelayDetails {
  /** Caller identity stamped on the relay droplet. */
  author: string;
  /** Free-form payload mirroring the Go side's RelayDetails.Payload. */
  payload?: Record<string, unknown>;
  /** Optional starting status (default per formation config). */
  status?: string;
  /** Optional relay type discriminator. */
  relayType?: string;
}
