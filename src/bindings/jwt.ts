// bindings/jwt.ts -- typed wrapper for ctx.jwt.{sign,verify}.
//
// LIVE binding (audit §B). HMAC-signed JWTs. Symmetric secret comes
// from the bolt's secrets capability (the secretName must be in
// capabilities.raindb.secrets.names).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';

/**
 * JWT claims map. The substrate stamps standard claims (iss, aud,
 * iat) automatically when not present; expiration is set from the
 * `expiresInSec` argument to `sign`.
 */
export type JwtClaims = Record<string, unknown>;

/**
 * Bolt-facing shape of `ctx.jwt` -- the raw goja-installed surface.
 */
export interface JwtBinding {
  sign(
    secretName: string,
    claims: JwtClaims,
    expiresInSec: number,
  ): Promise<string>;
  verify(secretName: string, token: string): Promise<JwtClaims>;
}

/**
 * HS256-signed JWT helpers. Use for session cookies, API tokens, and
 * any other signed-claim flow where the bolt is both issuer and
 * verifier.
 */
export const jwt = {
  /**
   * Produce an HS256-signed JWT.
   *
   * LIVE binding.
   *
   * @param secretName - Must be declared in capabilities.raindb.secrets.names
   * @param claims - Free-form map. Standard claims (iat, iss, aud) are
   *   populated by the substrate when absent.
   * @param expiresInSec - Lifetime in seconds; sets the `exp` claim.
   *
   * @example
   * ```ts
   * const token = await jwt.sign('session-secret', { sub: userId }, 3600);
   * ```
   *
   * @throws RainDBBoltError when the secret is missing or signing fails
   */
  async sign(
    secretName: string,
    claims: JwtClaims,
    expiresInSec: number,
  ): Promise<string> {
    const ctx = resolveCtx();
    try {
      return await ctx.jwt.sign(secretName, claims, expiresInSec);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.jwt_sign,
        input: { secretName, expiresInSec },
      });
    }
  },

  /**
   * Verify an HS256-signed JWT and return its claims.
   *
   * LIVE binding. Validates `exp` (rejects expired) and `nbf`.
   *
   * @example
   * ```ts
   * try {
   *   const claims = await jwt.verify('session-secret', cookie);
   *   const userId = claims['sub'];
   * } catch (e) {
   *   return { status: 401, body: 'expired or invalid token' };
   * }
   * ```
   *
   * @throws RainDBBoltError when signature mismatch, exp passed, or
   *   the token is malformed
   */
  async verify(secretName: string, token: string): Promise<JwtClaims> {
    const ctx = resolveCtx();
    try {
      return await ctx.jwt.verify(secretName, token);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.jwt_verify,
        input: { secretName },
      });
    }
  },
};
