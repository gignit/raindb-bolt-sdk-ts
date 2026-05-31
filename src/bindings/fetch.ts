// bindings/fetch.ts -- typed wrapper for ctx.fetch.
//
// LIVE binding (audit §B). Maps onto
// `pkg/lightning/engines/goja/bindings.go::installFetchBinding`.
// The goja-side response shape:
//   { status: number, ok: boolean, headers: object, body: string,
//     text(): string, json(): unknown }
//
// The goja binding is a callable, not a namespace -- the wrapper
// exposes a callable function `fetch(url, init?)` returning a typed
// FetchResponse.
//
// Note on egress allowlisting (per substrate
// `pkg/lightning/runtime/engine.go::SDKFetch.Do`): host MUST be in
// the bolt manifest's capabilities.network.egress[]. Calls to
// non-allowlisted hosts reject with a substrate-side error; the
// wrapper surfaces that as a generic RainDBBoltError because there's
// no typed-name discriminator for it (yet).

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
