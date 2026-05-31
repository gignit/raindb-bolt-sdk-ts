// bindings/formations.ts -- STUBBED ctx.formations.* surface.
// Audit §Q (Gap 12).

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface FormationDescription {
  formationId: string;
  formationType: string;
  version: string;
  schema?: Record<string, unknown>;
  indexes?: unknown[];
  lifecycle?: Record<string, unknown>;
  concurrencyControl?: Record<string, unknown>;
  stats?: Record<string, unknown>;
}

export interface FormationSummary {
  formationId: string;
  formationType: string;
  version: string;
}

/**
 * Bolt-facing shape of `ctx.formations` -- raw goja surface (STUB).
 */
export interface FormationsBinding {
  describe?: (formationId: string) => Promise<FormationDescription>;
  list?: () => Promise<FormationSummary[]>;
  warm?: (formationIds: string[]) => Promise<void>;
}

/**
 * STUB (audit §Q Gap 12). Formation introspection.
 */
export const formations = {
  /**
   * STUB. Read a formation's config + schema.
   * @throws BindingNotInstalled
   */
  async describe(formationId: string): Promise<FormationDescription> {
    const ctx = resolveCtx();
    return stubOrDispatch<FormationDescription>(
      BINDING.formations_describe,
      () =>
        (ctx as unknown as { formations?: FormationsBinding }).formations
          ?.describe,
      (fn) =>
        (fn as (id: string) => Promise<FormationDescription>)(formationId),
      { formationId },
    );
  },

  /**
   * STUB. Summary list of all formations on the tenant.
   * @throws BindingNotInstalled
   */
  async list(): Promise<FormationSummary[]> {
    const ctx = resolveCtx();
    return stubOrDispatch<FormationSummary[]>(
      BINDING.formations_list,
      () =>
        (ctx as unknown as { formations?: FormationsBinding }).formations
          ?.list,
      (fn) => (fn as () => Promise<FormationSummary[]>)(),
      undefined,
    );
  },

  /**
   * STUB. Pre-load the SDK's formation cache before a tight loop.
   * @throws BindingNotInstalled
   */
  async warm(formationIds: string[]): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.formations_warm,
      () =>
        (ctx as unknown as { formations?: FormationsBinding }).formations
          ?.warm,
      (fn) => (fn as (ids: string[]) => Promise<void>)(formationIds),
      { count: formationIds.length },
    );
  },
};
