// runtime/ctx-resolver.ts -- the ambient ctx resolver.
//
// Per handoff §E "ctx-resolver pattern", three options were considered
// for how the package accesses ctx:
//
//   (a) Pass ctx as the first arg of every wrapper call.
//   (b) AsyncLocalStorage-like ambient context (broken in goja).
//   (c) Module-level binding set at handler entry.
//
// Decision: option (c). The bolt's handler entrypoint calls setCtx(ctx)
// once at the top; every wrapper resolves through resolveCtx().
//
// Safety property: the goja sandbox is single-threaded per invocation
// and per FD-25 invariant 2 sandboxes are NOT pooled. So module-level
// state within one invocation is safe. setCtx(ctx) overwrites the
// previous ambient on each call (which is the right behavior at
// handler entry; the previous invocation's ctx is dead anyway by
// the time the next handler runs).
//
// Open question 1 in the handoff doc: should the package install a
// runtime check that catches "called outside an invocation"? For v0.1
// we don't -- the cost (a guard on every call) is real, and the
// failure mode (calling at module-top-level) is rare. Bolts that
// trip this get an undefined-deref on `ctx.<binding>` which is a
// clear-enough error.

import type { BoltContext } from '../types/bolt-context.js';
import { RainDBBoltError } from '../errors/classes.js';

let _ambient: BoltContext | undefined;

/**
 * Register the current invocation's `ctx` so every binding wrapper
 * can resolve through it.
 *
 * Call this ONCE at the top of every handler:
 *
 * @example
 * ```ts
 * import { setCtx, db, BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';
 *
 * export async function onHttpRequest(
 *   ctx: BoltContext,
 *   req: BoltRequest,
 * ): Promise<BoltResponse> {
 *   setCtx(ctx);
 *   // ... handler body uses db.*, token.*, etc.
 * }
 * ```
 *
 * Safety: do NOT call package wrappers at module-top-level (e.g.
 * during `import` time) because there is no ambient ctx until a
 * handler runs. Wrappers will throw `RainDBBoltError("setCtx not
 * called")` at the first call.
 */
export function setCtx(ctx: BoltContext): void {
  _ambient = ctx;
}

/**
 * Resolve the ambient ctx. Throws if `setCtx(ctx)` was never called
 * for this invocation.
 *
 * Internal -- used by every binding wrapper. Not exported from the
 * package's public surface; bolt code shouldn't need direct access.
 *
 * @internal
 */
export function resolveCtx(): BoltContext {
  if (_ambient === undefined) {
    throw new RainDBBoltError(
      'setCtx(ctx) was not called on this invocation. ' +
        'Add `setCtx(ctx)` as the first line of every bolt handler. ' +
        'See @raindb/bolt-sdk README for the canonical handler shape.',
    );
  }
  return _ambient;
}

/**
 * Test-only escape hatch -- clear the ambient ctx between unit tests.
 *
 * @internal
 */
export function _resetCtxForTest(): void {
  _ambient = undefined;
}
