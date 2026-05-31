// src/index.ts -- the example bolt's entrypoint.
//
// Demonstrates the canonical handler shape:
//   1. import { setCtx, ... } from '@raindb/bolt-sdk'
//   2. each handler calls setCtx(ctx) on the first line
//   3. delegates to a handler function in src/handlers/<name>.ts
//   4. handler functions use the SDK's binding namespaces (db.*,
//      log.*, etc.) instead of touching ctx.* directly
//
// At publish time, esbuild bundles this file plus its dependencies
// (the SDK is mostly type declarations + thin wrappers, so the
// bundle is tiny) and the goja sandbox loads the resulting JS.

import { setCtx } from '@raindb/bolt-sdk';
import type { BoltContext, BoltRequest, BoltResponse } from '@raindb/bolt-sdk';

import { onPing } from './handlers/ping.js';
import { onReadAgent, onWriteAgent } from './handlers/agent.js';
import { onSecretTest } from './handlers/secret-test.js';
import { onEchoStream } from './handlers/echo-stream.js';

export async function onHttpRequest(
  ctx: BoltContext,
  req: BoltRequest,
): Promise<BoltResponse> {
  setCtx(ctx);

  // Route by path prefix. In a real bolt, the dispatcher routes via
  // the bolt.json `routes[]` declaration; we replicate the routing
  // here for the local mock harness.
  if (req.method === 'GET' && req.path === '/ping') {
    return onPing(ctx, req);
  }
  if (req.method === 'GET' && req.path.startsWith('/agent/')) {
    return onReadAgent(ctx, req);
  }
  if (req.method === 'POST' && req.path === '/agent') {
    return onWriteAgent(ctx, req);
  }
  if (req.method === 'GET' && req.path === '/secret-test') {
    return onSecretTest(ctx, req);
  }
  if (req.method === 'GET' && req.path === '/echo-stream') {
    return onEchoStream(ctx, req);
  }
  return { status: 404, body: { error: 'no route', path: req.path } };
}

// In real bolts each handler is a separate exported entry. The
// dispatcher resolves by HandlerRef.Name. Re-exporting them here so
// the bolt.json's `handler` fields resolve cleanly.
export { onPing, onReadAgent, onWriteAgent, onSecretTest, onEchoStream };
