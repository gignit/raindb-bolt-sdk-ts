// bindings/stats.ts -- STUBBED ctx.stats.* surface.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';

export interface StatsIncrementInput {
  formationId: string;
  scopeValue: string;
  field: string;
  delta?: number;
}

export interface StatsSetInput {
  formationId: string;
  scopeValue: string;
  field: string;
  value: number;
}

export interface StatsBatchEntry {
  field: string;
  op: 'increment' | 'set';
  value: number;
}

export interface StatsBatchInput {
  formationId: string;
  scopeValue: string;
  entries: StatsBatchEntry[];
}

export interface StatsDrainInput {
  formationId: string;
  scopeValue: string;
}

/**
 * Bolt-facing shape of `ctx.stats` -- raw goja surface (STUB until
 * substrate ships v0.4).
 */
export interface StatsBinding {
  increment?: (input: StatsIncrementInput) => Promise<void>;
  set?: (input: StatsSetInput) => Promise<void>;
  batch?: (input: StatsBatchInput) => Promise<void>;
  drain?: (input: StatsDrainInput) => Promise<void>;
}

/**
 * STUB (audit §V token+stats handoff). High-burst counter surface.
 * Mostly used for fire-and-forget tallies (memoriesWritten,
 * broadcastsPosted, votesCast, etc).
 */
export const stats = {
  /**
   * STUB. Increment a counter field by `delta` (default 1).
   *
   * @throws BindingNotInstalled until substrate ships ctx.stats.increment
   * @throws StatsValidation when field unknown, op-mismatch, or
   *   formation lacks autoCache
   */
  async increment(
    formationId: string,
    scopeValue: string,
    field: string,
    delta: number = 1,
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.stats_increment,
      () =>
        (ctx as unknown as { stats?: StatsBinding }).stats?.increment,
      (fn) =>
        (fn as (i: StatsIncrementInput) => Promise<void>)({
          formationId,
          scopeValue,
          field,
          delta,
        }),
      { formationId, scopeValue, field, delta },
    );
  },

  /**
   * STUB. Set a counter field to a specific value (idempotent).
   *
   * @throws BindingNotInstalled
   * @throws StatsValidation
   */
  async set(
    formationId: string,
    scopeValue: string,
    field: string,
    value: number,
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.stats_set,
      () => (ctx as unknown as { stats?: StatsBinding }).stats?.set,
      (fn) =>
        (fn as (i: StatsSetInput) => Promise<void>)({
          formationId,
          scopeValue,
          field,
          value,
        }),
      { formationId, scopeValue, field, value },
    );
  },

  /**
   * STUB. Apply multiple counter ops atomically.
   *
   * @throws BindingNotInstalled
   * @throws StatsValidation on the first invalid entry
   */
  async batch(
    formationId: string,
    scopeValue: string,
    entries: StatsBatchEntry[],
  ): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.stats_batch,
      () =>
        (ctx as unknown as { stats?: StatsBinding }).stats?.batch,
      (fn) =>
        (fn as (i: StatsBatchInput) => Promise<void>)({
          formationId,
          scopeValue,
          entries,
        }),
      { formationId, scopeValue, count: entries.length },
    );
  },

  /**
   * STUB. Force-drain the in-memory counter cache for a scope to the
   * underlying droplet. Rare -- used at end-of-batch flushes.
   *
   * @throws BindingNotInstalled
   */
  async drain(formationId: string, scopeValue: string): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.stats_drain,
      () =>
        (ctx as unknown as { stats?: StatsBinding }).stats?.drain,
      (fn) =>
        (fn as (i: StatsDrainInput) => Promise<void>)({
          formationId,
          scopeValue,
        }),
      { formationId, scopeValue },
    );
  },
};
