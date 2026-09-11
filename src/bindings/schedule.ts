// bindings/schedule.ts -- typed wrapper for ctx.schedule.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { translateBindingError } from '../errors/from-binding.js';
import { BindingNotInstalled } from '../errors/classes.js';
import { BINDING } from '../internal/constants.js';

/**
 * Named-args input shape for {@link schedule.schedule}. The
 * wrapper repacks this into the substrate's positional
 * `(formationId, runAfterMs, actionRef, payload?)` convention.
 *
 * Field constraints (enforced substrate-side; mismatches surface
 * as plain Errors with `binding: "ctx.schedule"`):
 *
 * - `formationId` and `actionRef` are required and non-empty.
 * - `runAfterMs` must be > 0 (unix-millis target fire time);
 *   values in the past fire on the next scheduler poll.
 * - `payload` is optional; null/undefined are both accepted.
 *   Object-shaped only -- non-object payloads reject with a
 *   typed substrate error.
 */
export interface ScheduleInput {
  /**
   * The formation the callback is logically scoped to -- used by
   * the bolt's callback registry at dispatch time to locate the
   * handler. Must be non-empty.
   */
  formationId: string;
  /**
   * Unix-millis target fire time. Must be > 0. Values in the
   * past fire on the next scheduler poll.
   */
  runAfterMs: number;
  /**
   * Bolt-defined identifier for the callback handler (e.g.
   * `"settle-review-deadline"`). Must be non-empty. Resolved at
   * fire time against the bolt's exported handler functions via
   * the `POST /__bolt/actions/{formationId}/{actionRef}` route.
   */
  actionRef: string;
  /**
   * Opaque map carried verbatim in the workload and surfaced to
   * the eventual JS callback handler as the trigger payload. Omit
   * for callbacks that only need the `(formationId, actionRef)`
   * tuple.
   */
  payload?: Record<string, unknown>;
}

/**
 * Shape of `ctx.schedule` as the goja sandbox installs it. The
 * top-level callable returns the scheduled event's S3 key string
 * for later cancellation (cancellation API is a v0.2 follow-up;
 * see Wave 2.5 brief open questions).
 *
 * For bolt authors: prefer the package's exported `schedule.schedule(...)`
 * helper (typed errors via `translateBindingError`). This raw
 * type exists so `BoltContext.schedule` is faithful to what `ctx`
 * actually carries -- direct calls work as an escape hatch.
 */
export type ScheduleBinding = (
  formationId: string,
  runAfterMs: number,
  actionRef: string,
  payload?: Record<string, unknown> | null,
) => Promise<string> | string;

/** Internal: shared "binding missing" error producer. */
function missingSchedule(input: unknown): never {
  throw new BindingNotInstalled(
    `${BINDING.schedule} is not installed in this bolt runtime. Check the operation's availability and required capabilities. Scheduling requires capabilities.raindb.schedule: true.`,
    { binding: BINDING.schedule, input },
  );
}

/**
 * The ctx.schedule namespace -- LIVE wrapper over the substrate's
 * deferred-callback scheduler.
 *
 * The substrate's cyclone scheduler promotes the event at the
 * caller-supplied `runAfterMs` and dispatches it back into the
 * bolt via the `POST /__bolt/actions/{formationId}/{actionRef}`
 * HTTP route. The bolt's callback handler receives the original
 * `payload` plus the `(formationId, actionRef)` tuple.
 *
 * Capability: bolt-level OpSchedule. Single boolean opt-in on
 * `capabilities.raindb.schedule`. Distinct from formation-level
 * read/write ops because the schedule's target is supplied at
 * call time and the eventual callback runs in a separate
 * invocation context.
 *
 * Requires the scheduling binding and declared scheduling capability.
 * @example Schedule a deferred review-settlement callback
 * ```ts
 * import { schedule } from '@raindb/bolt-sdk';
 *
 * const eventKey = await schedule.schedule({
 *   formationId: 'agent-review-request',
 *   runAfterMs: Date.now() + 60_000,
 *   actionRef: 'settle-review-deadline',
 *   payload: { requestId: 'rev-123' },
 * });
 * // Persist eventKey somewhere if cancellation is needed later.
 * ```
 */
export const schedule = {
  /**
   * Enqueue a deferred bolt-callback. Returns the scheduled
   * event's S3 key (for future cancellation API; cancellation is
   * a v0.2 substrate follow-up).
   *
   * LIVE since v0.3.0.
   *
   * @requires capability: bolt-level `schedule` (set
   *   `capabilities.raindb.schedule: true` in `bolt.json`)
   * @returns the scheduled event's S3 key string
   * @throws BindingNotInstalled when `ctx.schedule` is not
   *   installed in the runtime or the required capability is missing
   * @throws RainDBBoltError carrying the substrate's typed
   *   message on capability denial (the denial format does NOT
   *   match the formation-shape regex; see file header)
   */
  async schedule(input: ScheduleInput): Promise<string> {
    const ctx = resolveCtx();
    if (typeof ctx.schedule !== 'function') {
      missingSchedule(input);
    }
    try {
      const out = await Promise.resolve(
        ctx.schedule(
          input.formationId,
          input.runAfterMs,
          input.actionRef,
          input.payload ?? null,
        ),
      );
      if (typeof out !== 'string') {
        throw new Error(
          'ctx.schedule: substrate did not return a string event key ' +
            `(got ${typeof out})`,
        );
      }
      return out;
    } catch (err) {
      translateBindingError(err, {
        binding: BINDING.schedule,
        input,
      });
    }
  },
};
