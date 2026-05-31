// handlers/agent.ts -- exercises db.readLatest, db.writeDroplet,
// db.listDroplets, plus typed-error discrimination.

import { db, log, CapabilityDenied } from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

const FORMATION_ID = 'agent-graph';
const INDEX_ID = 'by-id-latest';

export async function onReadAgent(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  const id = req.params['id'];
  if (id === undefined || id === '') {
    return { status: 400, body: { error: 'missing id' } };
  }

  try {
    const droplet = await db.readLatest({
      formationId: FORMATION_ID,
      indexId: INDEX_ID,
      scopeValue: id,
    });
    if (droplet === null) {
      return { status: 404, body: { error: 'not found', id } };
    }
    return { status: 200, body: droplet };
  } catch (e) {
    if (e instanceof CapabilityDenied) {
      log.warn('capability denied', { formation: e.formationId, op: e.op });
      return { status: 403, body: { error: 'bolt missing capability' } };
    }
    throw e;
  }
}

export async function onWriteAgent(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  const json = req.json as { agentId?: string; displayName?: string } | undefined;
  if (!json?.agentId) {
    return { status: 400, body: { error: 'missing agentId' } };
  }

  const { dropletId } = await db.writeDroplet({
    formationId: FORMATION_ID,
    payload: {
      agentId: json.agentId,
      displayName: json.displayName ?? json.agentId,
    },
  });

  return { status: 201, body: { dropletId } };
}
