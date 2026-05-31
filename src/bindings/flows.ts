// bindings/flows.ts -- STUBBED ctx.flows.queryState surface.
// Audit §R (Gap 13).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface QueryFlowStateInput {
  formationId: string;
  flowId: string;
  scopeValue: string;
}

export type FlowState = Record<string, unknown>;

/**
 * Bolt-facing shape of `ctx.flows` -- raw goja surface (STUB).
 */
export interface FlowsBinding {
  queryState?: (input: QueryFlowStateInput) => Promise<FlowState>;
}

/**
 * STUB (audit §R Gap 13). Cyclone flow-state introspection.
 */
export const flows = {
  /**
   * STUB. Read the cyclone-managed funnel state for a flow.
   * Empty result is normal for formations without actions.
   * @throws BindingNotInstalled
   */
  async queryState(input: QueryFlowStateInput): Promise<FlowState> {
    const ctx = resolveCtx();
    return stubOrDispatch<FlowState>(
      BINDING.flows_queryState,
      () =>
        (ctx as unknown as { flows?: FlowsBinding }).flows?.queryState,
      (fn) =>
        (fn as (i: QueryFlowStateInput) => Promise<FlowState>)(input),
      input,
    );
  },
};
