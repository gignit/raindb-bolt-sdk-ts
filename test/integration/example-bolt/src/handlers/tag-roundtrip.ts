// handlers/tag-roundtrip.ts -- exercises db.tag + db.untag (and the

import {
  db,
  tags,
  log,
  CapabilityDenied,
  BindingNotInstalled,
} from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

const FORMATION = 'agent-graph';

export async function onTagRoundtrip(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  // The roundtrip is read-only against substrate state -- it
  // touches a synthetic scopeValue that doesn't need to exist as
  // a droplet. Tags survive across writes; this handler is safe
  // to call repeatedly.
  const scopeValue = req.params['id'] ?? 'demo-entity';
  let replaceTagsAvailable = false;

  try {
    // 1. additive tag using db.* named-args
    await db.tag({
      formationId: FORMATION,
      scopeValue,
      tags: { env: 'demo', tier: 'starter' },
    });

    // 2. add more tags via the ergonomic 3-arg tags.* form
    await tags.tag(FORMATION, scopeValue, { region: 'us-east-1' });

    // 3. remove one key (idempotent -- safe to repeat)
    await db.untag({
      formationId: FORMATION,
      scopeValue,
      tagKeys: ['tier'],
    });

    // 4. probe the STUB to show how graceful degradation reads
    try {
      await tags.replaceTags(FORMATION, scopeValue, { env: 'demo' });
      replaceTagsAvailable = true;
    } catch (e) {
      if (!(e instanceof BindingNotInstalled)) throw e;
      // expected -- substrate does NOT ship a native atomic replace
    }

    log.info('tag-roundtrip', {
      formation: FORMATION,
      scopeValue,
      replaceTagsAvailable,
    });

    return {
      status: 200,
      body: {
        formation: FORMATION,
        scopeValue,
        operations: ['tag(env,tier)', 'tag(region)', 'untag(tier)'],
        replaceTagsAvailable,
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
          error: 'ctx.db.tag/untag not installed on this lightning binary',
          hint: 'requires a runtime providing this binding',
        },
      };
    }
    throw e;
  }
}
