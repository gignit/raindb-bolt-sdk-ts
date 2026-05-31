// handlers/object-roundtrip.ts -- exercises objects.put + objects.get
// + objects.exists + objects.delete. LIVE since v0.2.0 (substrate
// commit af5e9eb).
//
// Demonstrates the full S3-style roundtrip: write a payload, read
// it back, verify the body matches, optionally clean up.
//
// Capability: bolt.json must declare a `capabilities.raindb.buckets`
// entry naming the target bucket with both object-read and
// object-write ops. The example-bolt's bolt.json declares
// `tenant-standard` for this purpose.

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
          hint: 'requires substrate >= phoenix commit af5e9eb',
        },
      };
    }
    throw e;
  }
}
