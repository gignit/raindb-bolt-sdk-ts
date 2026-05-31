// handlers/ping.ts -- exercises log + ids + bolt metadata.
//
// The simplest possible handler: returns a small JSON envelope with
// the bolt's id and a fresh uuidv7.

import { ids, log } from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

export function onPing(
  ctx: BoltContext,
  req: BoltRequest,
): BoltResponse {
  log.info('ping', { path: req.path, boltId: ctx.bolt.id });
  return {
    status: 200,
    body: {
      bolt: ctx.bolt.id,
      tenant: ctx.bolt.tenantId,
      requestId: ids.uuidv7(),
    },
  };
}
