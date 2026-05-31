// handlers/expire-droplet.ts -- exercises db.expire + db.expirationDays.
// LIVE since v0.3.0 (substrate commit eee3eac).
//
// Demonstrates the entity-level retention surface:
//   1. read the tenant-wide retention window (db.expirationDays takes no args)
//   2. flag a specific entity (formationId, scopeValue) for lifecycle deletion
//
// NOTE: the substrate SDK method is named ExpireDroplet but operates
// at the ENTITY (scopeValue) level, NOT per-droplet. The v0.1 stub
// shape had the parameter as `dropletId` -- that was incorrect. See
// CHANGELOG v0.3.0 "Shape divergences from v0.1 stubs."
//
// Capability: bolt.json must declare `expire` op on the formation.
// Expire is a SEPARATE op from `write` per audit §M -- a bolt with
// write access does NOT implicitly get expire.

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
          hint: 'requires substrate >= phoenix commit eee3eac',
        },
      };
    }
    throw e;
  }
}
