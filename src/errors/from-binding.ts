// errors/from-binding.ts -- translation from goja's Error envelope
// to the package's typed error classes.
//
// The goja sandbox rejects bolt-side promise calls with an Error
// object whose `.name` carries the typed-error discriminator (per
// docs/HANDOFF_RAINDB_TOKEN_BINDINGS.md §C). Capability denials use
// a stable message format the wrapper parses with a regex.
//
// Every binding wrapper that calls into goja routes its catch path
// through `translateBindingError` -- this is the single point where
// untyped runtime errors become typed package errors. Adding a new
// typed error class means: (1) declare it in classes.ts, (2) add a
// case in the switch below, (3) add a unit test under
// test/unit/errors/.

import {
  RainDBBoltError,
  BindingNotInstalled,
  CapabilityDenied,
  TokenExists,
  TokenExpired,
  ConditionFailed,
  StatsValidation,
  AuthorRequired,
} from './classes.js';
import { CAPABILITY_DENIAL_REGEX, ERROR_NAME } from '../internal/constants.js';

/**
 * Context the wrapper passes through to the translator. `binding`
 * is the canonical binding name (e.g. `"ctx.db.readLatest"`); `input`
 * is the wrapper's input arguments (used for log correlation, not
 * for error logic).
 */
export interface TranslateContext {
  binding: string;
  input?: unknown;
}

/**
 * Translate an arbitrary thrown value to a typed RainDBBoltError
 * subclass and re-throw it. Never returns -- the function is
 * declared `never` so callers can chain it after `try { ... } catch
 * (e) { translateBindingError(e, ...); }` without a separate throw.
 *
 * Translation order:
 *   1. Pre-typed (already a RainDBBoltError) -> rethrow unchanged.
 *   2. Error.name matches a known typed name -> typed subclass.
 *   3. Error.message matches the capability-denial pattern -> CapabilityDenied.
 *   4. Fall through -> RainDBBoltError wrapping the original message.
 */
export function translateBindingError(
  err: unknown,
  ctx: TranslateContext,
): never {
  // (1) Already typed -- pass through. The wrapper may re-throw in
  // its own catch path; we do NOT double-wrap.
  if (err instanceof RainDBBoltError) {
    throw err;
  }

  // (2) The substrate-side typed names are stamped on Error.name.
  // BindingNotInstalled is not produced by substrate -- only by the
  // package's own stubOrDispatch path -- so it's not in this switch.
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message;
    const init = { binding: ctx.binding, input: ctx.input };

    switch (name) {
      case ERROR_NAME.TokenExists: {
        // The substrate may also stamp formationId/scopeValue on the
        // error object for richer typed errors; opportunistically
        // pull them off if present (they're non-standard so we use a
        // type assertion).
        const errAny = err as Error & { formationId?: string; scopeValue?: string };
        const tokenInit: {
          formationId?: string;
          scopeValue?: string;
          binding: string;
          input?: unknown;
        } = { binding: ctx.binding, input: ctx.input };
        if (typeof errAny.formationId === 'string') {
          tokenInit.formationId = errAny.formationId;
        }
        if (typeof errAny.scopeValue === 'string') {
          tokenInit.scopeValue = errAny.scopeValue;
        }
        throw new TokenExists(msg, tokenInit);
      }
      case ERROR_NAME.TokenExpired:
        throw new TokenExpired(msg, init);
      case ERROR_NAME.ConditionFailed:
        throw new ConditionFailed(msg, init);
      case ERROR_NAME.StatsValidation:
        throw new StatsValidation(msg, init);
      case ERROR_NAME.AuthorRequired:
        throw new AuthorRequired(msg, init);
      default:
        // fall through to message-pattern checks
        break;
    }

    // (3) Capability errors arrive as plain Error with the canonical
    // message format. Parse once; if the regex misses we fall through
    // to the generic wrapper.
    const cap = CAPABILITY_DENIAL_REGEX.exec(msg);
    if (cap) {
      const op = cap[1];
      const formation = cap[2];
      if (op !== undefined && formation !== undefined) {
        throw new CapabilityDenied(formation, op, init);
      }
    }
  }

  // (4) Generic fallback -- the consumer at least sees the binding
  // name and original message.
  const message = err instanceof Error ? err.message : String(err);
  throw new RainDBBoltError(message, {
    binding: ctx.binding,
    input: ctx.input,
  });
}

// Re-export BindingNotInstalled here so the runtime/binding-not-installed
// helper has a single import path. Other typed errors are exported from
// errors/index.ts.
export { BindingNotInstalled };
