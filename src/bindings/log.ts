// bindings/log.ts -- typed wrapper over ctx.log.{info,warn,error}.
//
// LIVE binding (audit §B). Maps directly onto the goja installer in
// `pkg/lightning/engines/goja/bindings.go::installLogBinding` which
// dispatches to `runtime.SDKLogger`.
//
// The goja-side accepts `(msg, ...fields)` where each field is an
// arbitrary value. We type fields as `Record<string, unknown>` for
// the most common case (structured logging) plus `unknown[]` for
// ad-hoc varargs -- the goja side accepts both because Export()
// produces map[string]any or []any indifferently.

import { resolveCtx } from '../runtime/ctx-resolver.js';

/**
 * Bolt-facing shape of `ctx.log`. Every method matches the goja
 * sandbox's `SDKLogger` surface.
 */
export interface LogBinding {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Structured logger surface. Routes through to the host's zap
 * logger; entries land in the bolt's invocation audit droplet.
 *
 * Logging is fire-and-forget; methods return void. Errors in the
 * underlying logger are swallowed (the goja installer never panics
 * for log calls).
 *
 * @example
 * ```ts
 * import { setCtx, log } from '@raindb/bolt-sdk';
 *
 * export async function onHttpRequest(ctx, req) {
 *   setCtx(ctx);
 *   log.info('handler entry', { path: req.path, method: req.method });
 *   try {
 *     // ...
 *   } catch (e) {
 *     log.error('handler failed', { error: String(e) });
 *     throw e;
 *   }
 * }
 * ```
 */
export const log: LogBinding = {
  info(msg, fields) {
    const ctx = resolveCtx();
    if (fields !== undefined) ctx.log.info(msg, fields);
    else ctx.log.info(msg);
  },
  warn(msg, fields) {
    const ctx = resolveCtx();
    if (fields !== undefined) ctx.log.warn(msg, fields);
    else ctx.log.warn(msg);
  },
  error(msg, fields) {
    const ctx = resolveCtx();
    if (fields !== undefined) ctx.log.error(msg, fields);
    else ctx.log.error(msg);
  },
};
