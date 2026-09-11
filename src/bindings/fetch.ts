// bindings/fetch.ts -- typed wrapper for ctx.fetch.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BINDING } from '../internal/constants.js';

/**
 * Init shape for fetch calls. Subset of the standard `RequestInit`
 * covering what the goja binding accepts (per `installFetchBinding`).
 */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

/**
 * Response shape produced by ctx.fetch. Mirrors the goja installer's
 * projection -- `text()` and `json()` are functions for parity with
 * the standard Response (and with @raindb/agent's HostResponse).
 */
export interface FetchResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Record<string, string | string[]>;
  readonly body: string;
  text(): Promise<string> | string;
  json(): Promise<unknown> | unknown;
}

/**
 * Bolt-facing shape of `ctx.fetch`. The binding is a callable.
 */
export type FetchBinding = (
  url: string,
  init?: FetchInit,
) => Promise<FetchResponse>;

/**
 * Egress-allowlisted HTTP fetch. The bolt manifest declares which
 * hosts are reachable; un-declared hosts reject.
 *
 * LIVE binding.
 *
 * @example
 * ```ts
 * const resp = await fetch('https://api.example.com/v1/things', {
 *   method: 'GET',
 *   headers: { 'X-Api-Key': await secrets.get('upstream-key') },
 * });
 * if (!resp.ok) throw new Error(`upstream ${resp.status}`);
 * const json = await resp.json();
 * ```
 *
 * @throws RainDBBoltError on transport errors (DNS, TCP reset, TLS
 *   handshake failure, egress-denial)
 */
export async function fetch(
  url: string,
  init?: FetchInit,
): Promise<FetchResponse> {
  const ctx = resolveCtx();
  try {
    const out = await ctx.fetch(url, init);
    return out;
  } catch (err) {
    translateBindingError(err, {
      binding: BINDING.fetch,
      input: { url, init },
    });
  }
}
