// handlers/object-roundtrip.ts -- exercises objects.put + objects.get

import { objects, log, ids, CapabilityDenied, BindingNotInstalled } from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

const BUCKET = 'tenant-standard';

export async function onObjectRoundtrip(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  void req;
  const key = `bolt-sdk-example/roundtrip-${ids.uuidv7()}.txt`;
  const body = `hello from @raindb/bolt-sdk v0.2.0 at ${new Date().toISOString()}`;

  try {
    await objects.put(BUCKET, key, body, 'text/plain');
    const readBack = await objects.get(BUCKET, key);
    const matches = readBack === body;
    const present = await objects.exists(BUCKET, key);
    await objects.delete(BUCKET, key);
    const goneAfterDelete = !(await objects.exists(BUCKET, key));

    log.info('object-roundtrip', {
      bucket: BUCKET,
      key,
      matches,
      present,
      goneAfterDelete,
    });

    return {
      status: 200,
      body: {
        bucket: BUCKET,
        key,
        bytesWritten: body.length,
        bytesRead: readBack.length,
        matches,
        present,
        goneAfterDelete,
      },
    };
  } catch (e) {
    if (e instanceof CapabilityDenied) {
      return {
        status: 403,
        body: {
          error: 'bolt missing capability',
          op: e.op,
          bucket: BUCKET,
        },
      };
    }
    if (e instanceof BindingNotInstalled) {
      return {
        status: 501,
        body: {
          error: 'ctx.objects not installed on this lightning binary',
          hint: 'requires a runtime providing this binding',
        },
      };
    }
    throw e;
  }
}
