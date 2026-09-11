// bindings/iam.ts -- typed wrapper for ctx.iam.mintWireToken.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';
import { RainDBBoltError } from '../errors/classes.js';

/**
 * One resource entry on a wire-token grant. Mirrors
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

  /**
   * Mint a browser-direct ACTIVITY subscription for real-time alerts: the
   * high-level "wake my client when any of these entities gets a new write"
   * primitive. This packages the RainDB construct every real-time bolt otherwise
   * hand-derives (see fdn-app's chainHeadKeyFor): the wire key that fires an SSE
   * wakeup on new activity is the entity's newest-first chain-head pointer --
   *   indexes/<formationId>/<indexName>.desc/<scopeValue>/latest.json
   * -- which the platform invalidates on every write, waking any subscribed
   * browser. You supply the formation + the descIndex index name + the entity
   * ids; this derives those keys and mints the grant.
   *
   * The result is what the BROWSER needs to open its EventSource: the token, the
   * SSE endpoint, and the resolved keys. On each wakeup the client raises its own
   * alert / unread badge (the wakeup is a SIGNAL that a key changed, not a count;
   * the unread count is app state the client derives). See the starter's
   * client subscribeActivity() helper for the browser side.
   *
   * The index MUST be a descIndex-enabled index on the formation (its `.desc`
   * chain is what the platform pokes). ttlSec defaults to the substrate default.
   *
   * @requires the bolt's grant permits wire-key:subscribe on the derived keys
   * @throws RainDBBoltError when subject/formationId/indexName missing or
   *   scopeValues is empty
   *
   * @example
   * ```ts
   * const sub = await iam.mintActivitySubscription({
   *   subject: userId,
   *   formationId: 'ref-entries',
   *   indexName: 'by-update',
   *   scopeValues: watchedEntryIds,
   *   ttlSec: 3600,
   * });
   * return { status: 200, body: sub }; // browser: subscribeActivity(sub)
   * ```
   */
  async mintActivitySubscription(input: {
    subject: string;
    formationId: string;
    indexName: string;
    scopeValues: string[];
    ttlSec?: number;
  }): Promise<{ token: string; keys: string[] }> {
    if (!input.subject) {
      throw new RainDBBoltError('iam.mintActivitySubscription: subject required', {
        binding: BINDING.iam_mintWireToken,
      });
    }
    if (!input.formationId || !input.indexName) {
      throw new RainDBBoltError(
        'iam.mintActivitySubscription: formationId + indexName required',
        { binding: BINDING.iam_mintWireToken },
      );
    }
    if (!input.scopeValues || input.scopeValues.length === 0) {
      throw new RainDBBoltError(
        'iam.mintActivitySubscription: at least one scopeValue required',
        { binding: BINDING.iam_mintWireToken },
      );
    }
    // Derive the chain-head wire keys (tenant-RELATIVE -- the substrate resolves
    // the tenants/<tid>/ prefix from the bolt's identity at mint time).
    const keys = input.scopeValues.map(
      (sv) => `indexes/${input.formationId}/${input.indexName}.desc/${sv}/latest.json`,
    );
    const resources: WireTokenResource[] = keys.map((id) => ({
      type: 'wire-key',
      id,
      ops: ['subscribe'],
    }));
    const token = await this.mintWireToken({
      subject: input.subject,
      resources,
      ...(input.ttlSec !== undefined ? { ttlSec: input.ttlSec } : {}),
    });
    return { token, keys };
  },
};
