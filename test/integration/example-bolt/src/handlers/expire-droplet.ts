// handlers/expire-droplet.ts -- exercises db.expire + db.expirationDays.

import {
  db,
  log,
  CapabilityDenied,
  BindingNotInstalled,
} from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

const FORMATION = 'agent-graph';

export async function onExpireDroplet(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  const scopeValue = req.params['id'] ?? 'demo-entity-to-expire';

  try {
    const retentionDays = await db.expirationDays();
    await db.expire({ formationId: FORMATION, scopeValue });

    log.info('expire-droplet', {
      formation: FORMATION,
      scopeValue,
      retentionDays,
    });

    return {
      status: 200,
      body: {
        formation: FORMATION,
        scopeValue,
        retentionDays,
        note:
          retentionDays === 0
            ? 'no tenant-wide retention rule configured (lifecycle deletion still flagged)'
            : `entity tagged for deletion after ${retentionDays} days`,
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
          hint:
            e.op === 'expire'
              ? 'add "expire" to capabilities.raindb.formations[].ops'
              : undefined,
        },
      };
    }
    if (e instanceof BindingNotInstalled) {
      return {
        status: 501,
        body: {
          error: 'ctx.db.expire/expirationDays not installed',
          hint: 'requires a runtime providing this binding',
        },
      };
    }
    throw e;
  }
}
