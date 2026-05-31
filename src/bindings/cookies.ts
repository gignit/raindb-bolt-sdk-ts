// bindings/cookies.ts -- typed wrapper for ctx.cookies.{parse,build}.
//
// LIVE binding (audit §B). Maps onto
// `pkg/lightning/engines/goja/bindings.go::installCookiesBinding`.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';

/**
 * Cookie attribute options for `cookies.build`. Matches
 * `pkg/lightning/runtime/engine.go::CookieOptions` field-for-field.
 */
export interface CookieOptions {
  path?: string;
  domain?: string;
  /** Seconds. <0 = delete. 0 = session. */
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Bolt-facing shape of `ctx.cookies` -- the raw goja-installed surface.
 */
export interface CookiesBinding {
  parse(headerValue: string): Promise<Record<string, string>> | Record<string, string>;
  build(name: string, value: string, opts?: CookieOptions): Promise<string> | string;
}

/**
 * Cookie helpers. Parses Cookie header values and builds Set-Cookie
 * values with attribute options.
 */
export const cookies = {
  /**
   * Parse a Cookie header value into a name->value map.
   *
   * LIVE binding. The substrate's parser is RFC 6265 compliant.
   *
   * @example
   * ```ts
   * const jar = await cookies.parse(req.headers['cookie'] as string);
   * const session = jar['session'];
   * ```
   */
  async parse(headerValue: string): Promise<Record<string, string>> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.cookies.parse(headerValue);
      return (out as Record<string, string>) ?? {};
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.cookies_parse,
        input: undefined,
      });
    }
  },

  /**
   * Build a Set-Cookie header value with attribute options.
   *
   * LIVE binding.
   *
   * @example
   * ```ts
   * const setCookie = await cookies.build('session', token, {
   *   path: '/',
   *   maxAge: 86400,
   *   httpOnly: true,
   *   secure: true,
   *   sameSite: 'Lax',
   * });
   * return { status: 200, headers: { 'Set-Cookie': setCookie } };
   * ```
   */
  async build(
    name: string,
    value: string,
    opts?: CookieOptions,
  ): Promise<string> {
    const ctx = resolveCtx();
    try {
      const out = await ctx.cookies.build(name, value, opts);
      return String(out);
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.cookies_build,
        input: { name, opts },
      });
    }
  },
};
