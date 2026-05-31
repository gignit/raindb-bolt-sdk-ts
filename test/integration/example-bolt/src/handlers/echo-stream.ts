// handlers/echo-stream.ts -- exercises ctx.response.* streaming surface.

import { response } from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

export async function onEchoStream(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  void ctx;
  await response.setHeader('content-type', 'text/event-stream');
  await response.setHeader('cache-control', 'no-cache');
  await response.beginStream(200);

  const message = (req.query['message'] as string | undefined) ?? 'hello';
  for (let i = 0; i < 3; i++) {
    await response.write(
      `event: tick\ndata: ${JSON.stringify({ i, message })}\n\n`,
    );
  }
  await response.write('event: done\ndata: {}\n\n');

  // The handler returns an empty response; the engine reads
  // streamed=true on the InvocationResult and seals the stream.
  return {};
}
