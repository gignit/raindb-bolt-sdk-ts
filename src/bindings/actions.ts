// bindings/actions.ts -- STUBBED ctx.actions.* surface.
// Audit §K (Gap 6).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface DispatchActionInput {
  formationId: string;
  actionName: string;
  input: Record<string, unknown>;
}

export interface DispatchActionResult {
  actionId: string;
}

export interface InvokeActionInput {
  formationId: string;
  actionName: string;
  input: Record<string, unknown>;
  opts?: { timeoutMs?: number };
}

export interface InvokeActionResult {
  result: unknown;
  durationMs: number;
}

/**
 * Bolt-facing shape of `ctx.actions` -- raw goja surface (STUB).
 */
export interface ActionsBinding {
  dispatch?: (input: DispatchActionInput) => Promise<DispatchActionResult>;
  invoke?: (input: InvokeActionInput) => Promise<InvokeActionResult>;
}

/**
 * STUB (audit §K Gap 6). Action dispatch + invoke surface.
 *
 * Capability: requires `action-dispatch` / `action-invoke` declared
 * on the bolt manifest. Action names must be in
 * `capabilities.raindb.actions[]`.
 */
export const actions = {
  /**
   * STUB. Async fire-and-forget action dispatch.
   * @throws BindingNotInstalled
   */
  async dispatch(
    formationId: string,
    actionName: string,
    input: Record<string, unknown>,
  ): Promise<DispatchActionResult> {
    const ctx = resolveCtx();
    return stubOrDispatch<DispatchActionResult>(
      BINDING.actions_dispatch,
      () =>
        (ctx as unknown as { actions?: ActionsBinding }).actions?.dispatch,
      (fn) =>
        (
          fn as (i: DispatchActionInput) => Promise<DispatchActionResult>
        )({ formationId, actionName, input }),
      { formationId, actionName },
    );
  },

  /**
   * STUB. Synchronous invoke; blocks on cyclone for the result.
   * Note: invocation can exceed wallMs if the action is slow --
   * prefer `dispatch` when runtime is uncertain.
   *
   * @throws BindingNotInstalled
   */
  async invoke(
    formationId: string,
    actionName: string,
    input: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<InvokeActionResult> {
    const ctx = resolveCtx();
    const callInput: InvokeActionInput = { formationId, actionName, input };
    if (opts !== undefined) callInput.opts = opts;
    return stubOrDispatch<InvokeActionResult>(
      BINDING.actions_invoke,
      () =>
        (ctx as unknown as { actions?: ActionsBinding }).actions?.invoke,
      (fn) =>
        (fn as (i: InvokeActionInput) => Promise<InvokeActionResult>)(
          callInput,
        ),
      { formationId, actionName },
    );
  },
};
