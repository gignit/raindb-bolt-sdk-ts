// bindings/crypto.ts -- typed wrapper for ctx.crypto.*.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';

/**
 * Bolt-facing shape of `ctx.crypto` -- the raw goja-installed surface.
 */
export interface CryptoBinding {
  hashPassword(plaintext: string, cost?: number): Promise<string>;
  verifyPassword(plaintext: string, hash: string): Promise<boolean>;
  randomBytes(n?: number): Promise<string>;
}

/**
 * Password-hashing + secure random helpers.
 */
export const crypto = {
  /**
   * Bcrypt-hash a cleartext password.
   *
   * LIVE binding.
   *
   * @param plaintext - The raw password
   * @param cost - bcrypt cost factor (default 10 if omitted or <=0)
   *
   * @example
   * ```ts
   * const hash = await crypto.hashPassword(req.json.password);
   * await db.writeDroplet({ formationId: 'user', payload: { passwordHash: hash } });
   * ```
   */
  async hashPassword(plaintext: string, cost?: number): Promise<string> {
    const ctx = resolveCtx();
    try {
      if (cost !== undefined) {
        return await ctx.crypto.hashPassword(plaintext, cost);
      }
      return await ctx.crypto.hashPassword(plaintext);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.crypto_hashPassword,
        input: { cost },
      });
    }
  },

  /**
   * Compare a cleartext password against a bcrypt hash.
   *
   * LIVE binding. Returns boolean -- mismatch is a normal outcome,
   * not an error.
   *
   * @example
   * ```ts
   * const ok = await crypto.verifyPassword(req.json.password, user.passwordHash);
   * if (!ok) return { status: 401, body: 'invalid credentials' };
   * ```
   */
  async verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.crypto.verifyPassword(plaintext, hash);
      return Boolean(out);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.crypto_verifyPassword,
        input: undefined,
      });
    }
  },

  /**
   * Generate n cryptographically-secure random bytes, hex-encoded.
   *
   * LIVE binding.
   *
   * @param n - Number of bytes (default 32 -- 256 bits of entropy)
   *
   * @example
   * ```ts
   * const csrfToken = await crypto.randomBytes(16);
   * ```
   */
  async randomBytes(n?: number): Promise<string> {
    const ctx = resolveCtx();
    try {
      if (n !== undefined) {
        return await ctx.crypto.randomBytes(n);
      }
      return await ctx.crypto.randomBytes();
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.crypto_randomBytes,
        input: { n },
      });
    }
  },
};
