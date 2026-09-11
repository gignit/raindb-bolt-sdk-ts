// bindings/relay.ts -- STUBBED ctx.relay.* surface.

import { resolveCtx } from '../runtime/ctx-resolver.js';
import { stubOrDispatch } from '../runtime/binding-not-installed.js';
import { BINDING } from '../internal/constants.js';
import type {
  RelayResult,
  ReadRelayOptions,
  RelayDetails,
  RelayLogEntry,
  RelayAddress,
} from '../types/relay.js';

export interface WriteRelayInput {
  formationId: string;
  scopeValue: string;
  details: RelayDetails;
}

export interface ReadRelayInput {
  formationId: string;
  scopeValue: string;
  opts?: ReadRelayOptions;
}

export interface UpdateRelayStatusInput {
  formationId: string;
  entityId: string;
  status: string;
  details?: RelayDetails;
}

export interface SpawnChildInput {
  parent: { formationId: string; scopeValue: string };
  child: { formationId: string; scopeValue: string; details: RelayDetails };
}

export interface WriteRelayLogInput {
  formationId: string;
  scopeValue: string;
  entry: Omit<RelayLogEntry, 'logId' | 'ts'> & {
    logId?: string;
    ts?: string;
  };
}

export interface EnqueueTokenInput {
  queueFormation: string;
  details: RelayDetails;
}

export interface DequeueTokenInput {
  queueFormation: string;
  relayId: string;
}

/**
 * Bolt-facing shape of `ctx.relay` -- raw goja surface (STUB).
 */
export interface RelayBinding {
  write?: (input: WriteRelayInput) => Promise<RelayAddress>;
  read?: (input: ReadRelayInput) => Promise<RelayResult | null>;
  updateStatus?: (input: UpdateRelayStatusInput) => Promise<void>;
  spawnChild?: (input: SpawnChildInput) => Promise<RelayAddress>;
  writeLog?: (input: WriteRelayLogInput) => Promise<void>;
  enqueueToken?: (input: EnqueueTokenInput) => Promise<RelayAddress>;
  dequeueToken?: (input: DequeueTokenInput) => Promise<void>;
}

/**
 * STUB (audit §J Gap 5; CONTRACT-UNCERTAIN per handoff §C).
 *
 * Long-lived workflow primitive. Relays carry status, sub-tasks, log
 * entries, and queue-based work distribution.
 *
 * Cross-validation: read shape matches @raindb/agent's
 * `relay_inspect` tool -- formationId/scopeValue input, RelayResult
 * with optional logs[] and subRelays[] output.
 */
export const relay = {
  /**
   * STUB. Write a new relay droplet.
   * @throws BindingNotInstalled
   */
  async write(input: WriteRelayInput): Promise<RelayAddress> {
    // TODO(substrate-card-J): confirm output shape (RelayAddress vs
    // full RelayResult) once substrate-side requirements card lands.
    const ctx = resolveCtx();
    return stubOrDispatch<RelayAddress>(
      BINDING.relay_write,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.write,
      (fn) =>
        (fn as (i: WriteRelayInput) => Promise<RelayAddress>)(input),
      input,
    );
  },

  /**
   * STUB. Read a relay with optional log replay.
   * @throws BindingNotInstalled
   */
  async read(input: ReadRelayInput): Promise<RelayResult | null> {
    const ctx = resolveCtx();
    return stubOrDispatch<RelayResult | null>(
      BINDING.relay_read,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.read,
      (fn) =>
        (fn as (i: ReadRelayInput) => Promise<RelayResult | null>)(input),
      input,
    );
  },

  /**
   * STUB. Transition a relay's status.
   * @throws BindingNotInstalled
   */
  async updateStatus(input: UpdateRelayStatusInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.relay_updateStatus,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.updateStatus,
      (fn) =>
        (fn as (i: UpdateRelayStatusInput) => Promise<void>)(input),
      input,
    );
  },

  /**
   * STUB. Create a sub-relay under a parent.
   * @throws BindingNotInstalled
   */
  async spawnChild(input: SpawnChildInput): Promise<RelayAddress> {
    const ctx = resolveCtx();
    return stubOrDispatch<RelayAddress>(
      BINDING.relay_spawnChild,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.spawnChild,
      (fn) =>
        (fn as (i: SpawnChildInput) => Promise<RelayAddress>)(input),
      input,
    );
  },

  /**
   * STUB. Append to a relay's log.
   * @throws BindingNotInstalled
   */
  async writeLog(input: WriteRelayLogInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.relay_writeLog,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.writeLog,
      (fn) =>
        (fn as (i: WriteRelayLogInput) => Promise<void>)(input),
      input,
    );
  },

  /**
   * STUB. Enqueue a queue-based relay token.
   * @throws BindingNotInstalled
   */
  async enqueueToken(input: EnqueueTokenInput): Promise<RelayAddress> {
    const ctx = resolveCtx();
    return stubOrDispatch<RelayAddress>(
      BINDING.relay_enqueueToken,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.enqueueToken,
      (fn) =>
        (fn as (i: EnqueueTokenInput) => Promise<RelayAddress>)(input),
      input,
    );
  },

  /**
   * STUB. Dequeue a queue-based relay token.
   * @throws BindingNotInstalled
   */
  async dequeueToken(input: DequeueTokenInput): Promise<void> {
    const ctx = resolveCtx();
    return stubOrDispatch<void>(
      BINDING.relay_dequeueToken,
      () =>
        (ctx as unknown as { relay?: RelayBinding }).relay?.dequeueToken,
      (fn) =>
        (fn as (i: DequeueTokenInput) => Promise<void>)(input),
      input,
    );
  },
};
