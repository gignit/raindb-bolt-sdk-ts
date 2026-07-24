// bindings/auth.ts -- typed wrapper for ctx.auth.
//
// LIVE since v0.4.0 (substrate-side commit 7bf58b6 -- lightning
// gains the same auth gate raindb-api's auth_middleware runs).
//
// Maps onto pkg/lightning/engines/goja/bindings.go::installAuthBinding
// and pkg/lightning/runtime/engine.go::SDKAuth in the substrate.
//
// Architecture (the fused gate model):
//
//   (graphql)     auth_middleware -> ctx -> RequireResource
//   (lightning)   resolveAuthContext -> ctx.auth -> ctx.auth.permits
//
// Same auth.GrantValidator, same auth.AuthContext shape, same
// auth.ResourceGrant.Permits semantics. PROJECT_REQUIREMENTS \u00a72
// library discipline: ONE Permits implementation; rule changes
// happen in pkg/auth only.
//
// See ~/src/raindb-prime/internal/lightning (unified IAM gate; resolveAuthContext)
// for the architecture decision + Phase plan.

import { resolveCtx } from '../runtime/ctx-resolver.js';

/**
 * Bolt-facing shape of `ctx.auth` -- the raw goja-installed
 * surface. Mirrors `pkg/lightning/runtime/engine.go::SDKAuth`.
 *
 * Scalar fields are PROPERTIES (set once at request boundary by
 * `installAuthBinding` from the validated `AuthContext`). They
 * never throw and never await.
 *
 * Predicates are FUNCTIONS that consult the AuthContext.Grant
 * via pkg/auth's `Permits` / `PermitsWireKeySubscribe`. Both
 * return synchronous booleans (no I/O, no allocation beyond the
 * resource-path split).
 */
export interface AuthBinding {
  /**
   * Tenant ID from the validated grant -- the USER's tenant,
   * where their data lives. Empty string for anonymous
   * requests.
   *
   * IMPORTANT for portal-bolts: this is NOT the bolt's host
   * tenant. fdn-app hosted on platform-bolts, serving Joshua
   * on chess, sees tenantId === chess (Joshua's). The bolt's
   * host tenant is on `ctx.bolt.tenantId` if you need it.
   */
  readonly tenantId: string;

  /**
   * Grant.Subject -- typically the end-user's userId from the
   * authentication staircase (raindb-app's
   * username/password -> userId -> groupId -> tenantId
   * progression). Empty for anonymous and for grants that
   * didn't carry a subject (e.g. machine API keys where
   * subject == tenantId).
   */
  readonly subject: string;

  /**
   * Grant.JTI -- the unique credential identifier. Useful
   * for audit logging + correlating a bolt-issued action
   * back to the originating session. Empty for anonymous.
   */
  readonly apiClientId: string;

  /**
   * True when no credential was presented (or validation
   * failed silently because the bolt's route declared a
   * public allow-list).
   *
   * Bolt JS checks this BEFORE calling in-process privileged
   * bindings (ctx.iam.mintWireToken, future cross-tenant
   * ctx.db.write) -- those will throw RainDBBoltError with
   * `ErrMissingCredential` if called when anonymous.
   */
  readonly isAnonymous: boolean;

  /**
   * Reports whether the caller's grant permits the named
   * (resourceType, resourceID, op) tuple. Returns false for
   * anonymous callers, expired grants, and any miss.
   *
   * SAME semantics as graphql's RequireResource directive and
   * pkg/auth's ResourceGrant.Permits. Use this to gate
   * cross-tenant operations OR operations that should respect
   * the user's actual authorization (NOT the bolt's host
   * privileges).
   *
   * Synchronous; no I/O.
   */
  permits(resourceType: string, resourceID: string, op: string): boolean;

  /**
   * Reports whether the grant permits subscribe on the given
   * S3 chain-head key path. Uses the canonical 3-rule check
   * (wire-key:subscribe OR formation:read OR tenant:admin --
   * the "read implies subscribe" semantic mapping). Same rule
   * graphql's mintWireSubscribeToken and the lightning SSE
   * per-key check apply.
   *
   * Bolt code that mints session-scoped wire-tokens can use
   * this to pre-validate BEFORE calling ctx.iam.mintWireToken
   * (which applies the same gate internally).
   */
  permitsWireKeySubscribe(resourceID: string): boolean;
}

/**
 * Per-request auth namespace. Read-only surface backed by the
 * AuthContext the lightning dispatcher resolved via
 * GrantValidator at request boundary.
 *
 * @example Gating a cross-tenant write
 * ```ts
 * import { setCtx, auth, db, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';
 *
 * export async function onHttpRequest(
 *   ctx: BoltContext,
 *   req: BoltRequest,
 * ): Promise<BoltResponse> {
 *   setCtx(ctx);
 *   if (auth.isAnonymous) {
 *     return { status: 401, body: { error: 'auth required' } };
 *   }
 *   // The user can write to droplet:fdn-chat-messages -- check before doing it.
 *   if (!auth.permits('droplet', 'fdn-chat-messages', 'write')) {
 *     return { status: 403, body: { error: 'insufficient grant' } };
 *   }
 *   await db.writeDroplet({
 *     formationId: 'fdn-chat-messages',
 *     payload: { sessionId: req.json?.sessionId, message: req.json?.message },
 *   });
 *   return { status: 200, body: { ok: true } };
 * }
 * ```
 *
 * @example Gating an SSE wire-token mint
 * ```ts
 * import { auth, iam } from '@raindb/bolt-sdk';
 *
 * const keys = sessions.map(s => `tenants/${auth.tenantId}/indexes/fdn-chat-messages/by-session.desc/${s.id}/latest.json`);
 *
 * // Pre-flight gate (optional -- iam.mintWireToken applies the same gate).
 * for (const key of keys) {
 *   if (!auth.permitsWireKeySubscribe(key)) {
 *     return { status: 403, body: { error: 'cannot subscribe to ' + key } };
 *   }
 * }
 *
 * const token = await iam.mintWireToken({
 *   subject: auth.subject,
 *   resources: keys.map(id => ({ type: 'wire-key', id, ops: ['subscribe'] })),
 *   ttlSec: 3600,
 * });
 * return { status: 200, body: { token, keys } };
 * ```
 */
export const auth = {
  /**
   * Tenant ID from the validated grant. See AuthBinding.tenantId.
   */
  get tenantId(): string {
    const ctx = resolveCtx();
    if (ctx.auth === undefined) return '';
    return ctx.auth.tenantId;
  },

  /**
   * Grant.Subject. See AuthBinding.subject.
   */
  get subject(): string {
    const ctx = resolveCtx();
    if (ctx.auth === undefined) return '';
    return ctx.auth.subject;
  },

  /**
   * Grant.JTI. See AuthBinding.apiClientId.
   */
  get apiClientId(): string {
    const ctx = resolveCtx();
    if (ctx.auth === undefined) return '';
    return ctx.auth.apiClientId;
  },

  /**
   * No-credential indicator. See AuthBinding.isAnonymous.
   *
   * Also true when running on older lightning binaries that
   * predate the ctx.auth installation (substrate commit
   * 7bf58b6); newer code SHOULD check isAnonymous OR
   * ctx.auth !== undefined to distinguish the two cases.
   */
  get isAnonymous(): boolean {
    const ctx = resolveCtx();
    if (ctx.auth === undefined) return true;
    return ctx.auth.isAnonymous;
  },

  /**
   * Per-resource permission check. See AuthBinding.permits.
   *
   * Pre-7bf58b6 lightning binaries don't install ctx.auth;
   * this method returns false in that case (no AuthContext
   * means no permissions). Bolt code that targets the new
   * substrate should rely on the gate; older substrate
   * deployments fall through to whatever defaults the bolt
   * applies.
   */
  permits(resourceType: string, resourceID: string, op: string): boolean {
    const ctx = resolveCtx();
    if (ctx.auth === undefined) return false;
    return ctx.auth.permits(resourceType, resourceID, op);
  },

  /**
   * Wire-key subscribe gate (3-rule check). See
   * AuthBinding.permitsWireKeySubscribe.
   */
  permitsWireKeySubscribe(resourceID: string): boolean {
    const ctx = resolveCtx();
    if (ctx.auth === undefined) return false;
    return ctx.auth.permitsWireKeySubscribe(resourceID);
  },
};
