// errors/classes.ts -- typed error class hierarchy per handoff §G.
//
// Bolt code does:
//
//   try {
//     await token.claim('continuum-stats', { scope: 'global' }, { author: 'bot' });
//   } catch (e) {
//     if (e instanceof TokenExists) { /* already initialized */ }
//     else throw e;
//   }
//
// All errors descend from RainDBBoltError so consumers can catch the
// whole family with one `instanceof` check when discrimination doesn't
// matter.
//
// Per the package's tsconfig (`exactOptionalPropertyTypes: true`), the
// constructors are careful with optional fields: only assign when the
// caller provided a value, so consumers reading the field can rely on
// `undefined` meaning "not present" rather than "set to undefined".

/**
 * Base class for every error originating in @raindb/bolt-sdk.
 *
 * Bolt code can catch this to handle "anything from the SDK" without
 * discriminating further. The `binding` field carries the wrapper
 * name (e.g. `"ctx.db.readLatest"`) for log correlation.
 */
export class RainDBBoltError extends Error {
  readonly binding?: string;
  readonly input?: unknown;

  constructor(message: string, init?: { binding?: string; input?: unknown }) {
    super(message);
    this.name = 'RainDBBoltError';
    if (init?.binding !== undefined) this.binding = init.binding;
    if (init?.input !== undefined) this.input = init.input;
  }
}

/**
 * The bolt's `capabilities.json` does not declare the required op on
 * the formation. The substrate's `allowOp(formationID, op)` check
 * rejected the call before it ever reached the SDK.
 *
 * Per audit §W cross-cutting concerns, the substrate emits these as
 * `ctx.<binding>: <op> on formation "<formationId>" not declared in capabilities`.
 * The wrapper's translateBindingError parses that pattern and produces
 * this typed class with `.formationId` and `.op` populated.
 *
 * Bolt code that wants to gracefully degrade on capability denial:
 *
 * @example
 * ```ts
 * try {
 *   const droplet = await db.readLatest({ formationId: 'agent-graph', ... });
 * } catch (e) {
 *   if (e instanceof CapabilityDenied) {
 *     return { status: 403, body: `bolt missing ${e.op} on ${e.formationId}` };
 *   }
 *   throw e;
 * }
 * ```
 */
export class CapabilityDenied extends RainDBBoltError {
  readonly formationId: string;
  readonly op: string;

  constructor(
    formationId: string,
    op: string,
    init?: { binding?: string; input?: unknown; message?: string },
  ) {
    // For a formation-op denial the canonical message is synthesized from
    // (op, formationId). For a namespace-level denial (e.g. schedule/objects,
    // where formationId is "") the caller passes the original substrate
    // message via init.message so it is preserved verbatim.
    super(
      init?.message ??
        `${op} on formation "${formationId}" not declared in capabilities`,
      init,
    );
    this.name = 'CapabilityDenied';
    this.formationId = formationId;
    this.op = op;
  }
}

/**
 * The substrate-side binding is not installed in this bolt runtime.
 *
 * The package shipped a typed wrapper, but the corresponding goja
 * binding has not yet landed (or this bolt was deployed against a
 * substrate too old to ship it). The error message points at the
 * audit gap card so operators know which substrate work would
 * unblock the call.
 */
export class BindingNotInstalled extends RainDBBoltError {
  constructor(message: string, init?: { binding?: string; input?: unknown }) {
    super(message, init);
    this.name = 'BindingNotInstalled';
  }
}

/**
 * Token write with `createOnly: true` (the `claim` semantic) hit an
 * existing claim. The scope is already taken; the caller should
 * either give up or read the existing token to learn who claimed it.
 *
 * @example
 * ```ts
 * try {
 *   await token.claim('continuum-stats', 'global', { author: 'bot' });
 * } catch (e) {
 *   if (e instanceof TokenExists) {
 *     // already initialized; safe to ignore in init paths
 *   } else throw e;
 * }
 * ```
 */
export class TokenExists extends RainDBBoltError {
  readonly formationId?: string;
  readonly scopeValue?: string;

  constructor(
    message: string,
    init?: {
      formationId?: string;
      scopeValue?: string;
      binding?: string;
      input?: unknown;
    },
  ) {
    super(message, init);
    this.name = 'TokenExists';
    if (init?.formationId !== undefined) this.formationId = init.formationId;
    if (init?.scopeValue !== undefined) this.scopeValue = init.scopeValue;
  }
}

/**
 * Token read returned an expired pointer; the substrate's lifecycle
 * recycled it. The caller should either re-claim or treat the scope
 * as un-owned.
 */
export class TokenExpired extends RainDBBoltError {
  constructor(message: string, init?: { binding?: string; input?: unknown }) {
    super(message, init);
    this.name = 'TokenExpired';
  }
}

/**
 * Conditional write (CAS via `expectedETag` or `ifFieldEquals`) was
 * not satisfied. The caller should re-read the latest, decide whether
 * to retry, and re-issue the write with a fresh expected value.
 */
export class ConditionFailed extends RainDBBoltError {
  constructor(message: string, init?: { binding?: string; input?: unknown }) {
    super(message, init);
    this.name = 'ConditionFailed';
  }
}

/**
 * The stats binding rejected the call. Causes include: unknown field
 * name (not declared on the formation), op-mismatch (calling
 * `increment` on a `set`-typed field), autoCache not enabled on the
 * formation, etc.
 */
export class StatsValidation extends RainDBBoltError {
  constructor(message: string, init?: { binding?: string; input?: unknown }) {
    super(message, init);
    this.name = 'StatsValidation';
  }
}

/**
 * The wrapper could not derive a required `author` field for the
 * write. The bolt's invocation context didn't carry an author and
 * the call site didn't pass one explicitly.
 */
export class AuthorRequired extends RainDBBoltError {
  constructor(message: string, init?: { binding?: string; input?: unknown }) {
    super(message, init);
    this.name = 'AuthorRequired';
  }
}
