// bindings/iam.ts -- typed wrapper for ctx.iam.mintWireToken.
//
// LIVE binding (audit §B). Maps onto
// `pkg/lightning/engines/goja/bindings.go::installIAMBinding`. Used
// by SSE-streaming bolts to mint short-lived browser-direct grants
// over chain-head wire keys (per Lightning SSE Phase 5,
// docs/RAINDB_PHX_LIGHTNING_SSE.md J).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';

/**
 * One resource entry on a wire-token grant. Mirrors
 * `pkg/lightning/runtime/engine.go::WireTokenResource`.
 */
export interface WireTokenResource {
  /** Always `"wire-key"` today; future verbs additive. */
  type: 'wire-key' | string;
  /** Full chain-head key path; `*` wildcard not allowed via mint. */
  id: string;
  /** Typically `["subscribe"]`. */
  ops: string[];
}

/**
 * Options for `iam.mintWireToken`. Mirrors
 * `pkg/lightning/runtime/engine.go::WireTokenMintOptions`.
 */
export interface WireTokenMintOptions {
  /** End-user identity from the bolt's user table. */
  subject: string;
  /** Resource list the grant authorizes. */
  resources: WireTokenResource[];
  /** Lifetime in seconds. Default 3600 (substrate-side); max 86400. */
  ttlSec?: number;
}

/**
 * Bolt-facing shape of `ctx.iam` -- the raw goja-installed surface.
 */
export interface IamBinding {
  mintWireToken(opts: WireTokenMintOptions): Promise<string>;
}

/**
 * IAM token minting surface. Used by SSE bolts to issue short-lived
 * grants the browser carries when subscribing to wire keys.
 *
 * The substrate validates: subject required; resources non-empty;
 * every resource id starts with `tenants/<bolt's tenantId>/`; ttl
 * within bounds. Validation failures throw `RainDBBoltError`.
 */
export const iam = {
  /**
   * Mint a wire-key IAM token. Returns the signed `rgr1.<...>` token
   * string the browser carries on the SSE subscribe request.
   *
   * LIVE binding.
   *
   * @example
   * ```ts
   * const wireToken = await iam.mintWireToken({
   *   subject: userId,
   *   resources: [
   *     {
   *       type: 'wire-key',
   *       id: `tenants/${ctx.bolt.tenantId}/.../latest.json`,
   *       ops: ['subscribe'],
   *     },
   *   ],
   *   ttlSec: 3600,
   * });
   * return { status: 200, body: { wireToken } };
   * ```
   *
   * @throws RainDBBoltError when validation fails (subject missing,
   *   non-tenant-prefixed resource, ttl out of bounds, etc.)
   */
  async mintWireToken(opts: WireTokenMintOptions): Promise<string> {
    const ctx = resolveCtx();
    try {
      return await ctx.iam.mintWireToken(opts);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.iam_mintWireToken,
        input: { subject: opts.subject, ttlSec: opts.ttlSec },
      });
    }
  },
};
