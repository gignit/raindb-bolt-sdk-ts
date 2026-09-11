// handlers/write-batch.ts -- exercises db.writeBatch with per-item

import {
  db,
  log,
  ids,
  CapabilityDenied,
  BindingNotInstalled,
} from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

const FORMATION = 'agent-graph';

export async function onWriteBatch(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  void req;
  const batchKey = `batch-${ids.uuidv7()}`;

  try {
    const result = await db.writeBatch({
      formationId: FORMATION,
      items: [
        {
          payload: { agentId: ids.uuidv7(), displayName: 'Alpha' },
          idempotencyKey: `${batchKey}-alpha`,
        },
        {
          payload: { agentId: ids.uuidv7(), displayName: 'Bravo' },
          idempotencyKey: `${batchKey}-bravo`,
        },
        {
          payload: { agentId: ids.uuidv7(), displayName: 'Charlie' },
          idempotencyKey: `${batchKey}-charlie`,
        },
      ],
      opts: {
        idempotencyKey: batchKey,
        triggerFlows: true,
      },
    });

    // Partial-success discrimination -- substrate returns counts +
    // per-item results; check .error per item to surface failures.
    const failures = result.items.filter((it) => it.error !== undefined);
    if (failures.length > 0) {
      log.warn('write-batch partial failure', {
        batchKey,
        total: result.total,
        failed: result.failed,
        firstError: failures[0]?.error,
      });
    }

    log.info('write-batch ok', {
      batchKey,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    });

    return {
      status: 200,
      body: {
        batchKey,
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        items: result.items.map((it) => ({
          index: it.index,
          ...(it.dropletId !== undefined ? { dropletId: it.dropletId } : {}),
          ...(it.scopeValue !== undefined ? { scopeValue: it.scopeValue } : {}),
          ...(it.error !== undefined ? { error: it.error } : {}),
        })),
      },
    };
  } catch (e) {
    if (e instanceof CapabilityDenied) {
      return {
        status: 403,
        body: {
          error: 'bolt missing capability',
          op: e.op,
          formation: e.formationId,
        },
      };
    }
    if (e instanceof BindingNotInstalled) {
      return {
        status: 501,
        body: {
          error: 'ctx.db.writeBatch not installed on this lightning binary',
          hint: 'requires a runtime providing this binding',
        },
      };
    }
    throw e;
  }
}
