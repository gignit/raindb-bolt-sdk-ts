// runtime/binding-not-installed.ts -- the stub-vs-live discriminator.
//
// Per handoff §F: stubbed bindings call stubOrDispatch which checks
// at runtime whether the goja-side binding actually exists. If it
// does (e.g. because the substrate-side agent shipped it after this
// package's version compiled), the stub dispatches through it. If
// not, it throws a clearly-named BindingNotInstalled error pointing
// at the audit gap card.
//
// This helper is the SINGLE point where stub-vs-live discrimination
// happens. Every stubbed binding wrapper routes through it. No
// scattered `if (typeof ctx.foo === 'undefined')` checks elsewhere.

import { BindingNotInstalled } from '../errors/classes.js';
import { translateBindingError } from '../errors/from-binding.js';

/**
 * Resolve a stubbed binding at call time and dispatch through it,
 * or throw BindingNotInstalled if the binding hasn't been installed
 * yet on the substrate side.
 *
 * The pattern at the call site:
 *
 * ```ts
 * export const sql = {
 *   async query(input: SqlQueryInput): Promise<SqlResult> {
 *     const ctx = resolveCtx();
 *     return stubOrDispatch(
 *       BINDING.sql_query,
 *       () => (ctx as any).sql?.query,
 *       (fn) => fn(input.sql, { withFreshness: input.withFreshness }),
 *       input,
 *     );
 *   },
 * };
 * ```
 *
 * The `resolver` is a thunk that returns the goja-side function (or
 * undefined if the namespace doesn't exist). The `dispatcher` calls
 * the resolved function with the wrapper's chosen argument layout.
 * Both are passed as closures so the type-erased `(ctx as any)` lookup
 * stays scoped to one place.
 *
 * @param bindingName Canonical name for error.binding and the
 *   BindingNotInstalled message. Sourced from `internal/constants.ts`.
 * @param resolver Returns the underlying goja-side function or
 *   undefined when the binding namespace is absent.
 * @param dispatcher Calls the resolved function and returns its
 *   value. The `fn` argument is typed `unknown` -- callers cast it
 *   inside the dispatcher closure (this is the controlled untyped
 *   surface).
 * @param input Optional input object to stamp onto the thrown error
 *   for log correlation. Don't pass secrets.
 *
 * @throws BindingNotInstalled when resolver returns non-function.
 * @throws RainDBBoltError (or a typed subclass) when the dispatched
 *   call rejects. The dispatcher's throw is routed through
 *   translateBindingError.
 */
export async function stubOrDispatch<T>(
  bindingName: string,
  resolver: () => unknown,
  dispatcher: (fn: unknown) => unknown,
  input?: unknown,
): Promise<T> {
  const fn = resolver();
  if (typeof fn !== 'function') {
    throw new BindingNotInstalled(
      `${bindingName} is not installed in this bolt runtime. ` +
        `The @raindb/bolt-sdk wrapper is shipped; the substrate-side ` +
        `binding is pending. See ` +
        `~/src/raindb-phoenix-lightning/docs/AUDIT_BOLT_SDK_GAPS.md ` +
        `for the gap card that owns this surface, and ` +
        `~/src/raindb-phoenix-lightning/docs/BOLT_SDK_COORDINATION.md ` +
        `for current substrate ship status.`,
      { binding: bindingName, input },
    );
  }
  try {
    const out = await Promise.resolve(dispatcher(fn));
    return out as T;
  } catch (err) {
    translateBindingError(err, { binding: bindingName, input });
  }
}
