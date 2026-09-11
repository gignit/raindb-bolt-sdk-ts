// types/token.ts -- token-shaped types for the STUBBED ctx.token surface.

/**
 * One token droplet. Tokens are the substrate's
 * idempotency-protected pointer-claim primitive: a "this scope is
 * mine" exclusive marker.
 */
export interface Token {
  readonly tokenId: string;
  readonly formationId: string;
  readonly scopeValue: string;
  readonly author: string;
  readonly ts: string;
  readonly payload?: Record<string, unknown> | null;
  /** RFC3339 expiration time, when the token is configured with TTL. */
  readonly expiresAt?: string | null;
}

/**
 * Options for `token.write` / `token.claim`. Mirrors the Go-side
 * `sdk.WriteTokenOptions` shape.
 */
export interface WriteTokenOptions {
  /** Caller identity stamped on the token droplet. */
  author: string;
  /** Free-form payload. */
  payload?: Record<string, unknown>;
  /** Time-to-live in seconds; substrate enforces expiration. */
  ttlSec?: number;
  /**
   * When true (the `claim` semantic), the write fails with TokenExists
   * if the scope is already claimed. When false, an existing claim is
   * overwritten. `token.claim` always sets this true; `token.write`
   * defaults false.
   */
  createOnly?: boolean;
}
