// test/unit/sql-plan-strategy.test.ts -- reconciliation coverage for the
// planStrategy (range/scan) feature and the agent-bridge option forwarding
// (gap ledger G1 + G3 in bolt-sdk-and-lightning-pods-reconciliation.md).
//
// The host already accepts planStrategy on BOTH engines (goja
// extractSQLQueryOptions / pod-channel handleSQLQuery ->
// runtime.SQLQueryOptions.PlanStrategy). These tests pin that the TYPED
// wrapper and the agent bridge forward it (and the other dropped options)
// instead of structurally discarding them.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { setCtx, sql } from '../../src/index.js';
import type { SqlResult, SqlBinding } from '../../src/index.js';
import type { CursorPaginationOpts } from '../../src/types/cursor.js';
import { makeBoltNativeHost } from '../../src/agent-bridge/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

const emptyResult: SqlResult = {
  columns: ['n'],
  rows: [{ n: 1 }],
  rowCount: 1,
  durationMs: 1,
  truncated: false,
};

// A capturing sql binding: records the positional (sql, opts) the wrapper
// hands the substrate so we can assert exactly what was forwarded.
function captureSql(): {
  calls: Array<{ sql: string; opts?: Record<string, unknown> }>;
  binding: SqlBinding;
} {
  const calls: Array<{ sql: string; opts?: Record<string, unknown> }> = [];
  return {
    calls,
    binding: {
      query: async (s: string, o?: Record<string, unknown>): Promise<SqlResult> => {
        calls.push(o === undefined ? { sql: s } : { sql: s, opts: o });
        return emptyResult;
      },
    },
  };
}

// --- G1: the typed sql.query wrapper forwards planStrategy --------------------

test('sql.query forwards a defined planStrategy=scan to the host binding', async () => {
  const cap = captureSql();
  setCtx(mockCtx({ sql: cap.binding }));

  await sql.query({ sql: 'SELECT 1', planStrategy: 'scan' });

  assert.equal(cap.calls.length, 1);
  assert.equal(cap.calls[0]?.opts?.['planStrategy'], 'scan');
});

test('sql.query forwards planStrategy=range', async () => {
  const cap = captureSql();
  setCtx(mockCtx({ sql: cap.binding }));

  await sql.query({ sql: 'SELECT 1', planStrategy: 'range' });

  assert.equal(cap.calls[0]?.opts?.['planStrategy'], 'range');
});

test('sql.query OMITS planStrategy when not provided (host default, no zero value)', async () => {
  const cap = captureSql();
  setCtx(mockCtx({ sql: cap.binding }));

  await sql.query({ sql: 'SELECT 1' });

  assert.ok(cap.calls[0]?.opts, 'opts object is forwarded');
  assert.equal(
    'planStrategy' in (cap.calls[0]!.opts as object),
    false,
    'planStrategy key must be ABSENT so the host applies the formation default',
  );
});

test('sql.query still forwards the pre-existing options alongside planStrategy', async () => {
  const cap = captureSql();
  setCtx(mockCtx({ sql: cap.binding }));

  await sql.query({
    sql: 'SELECT 1',
    formationId: 'orders',
    timeoutMs: 5000,
    withFreshness: true,
    planStrategy: 'scan',
  });

  assert.deepEqual(cap.calls[0]?.opts, {
    formationId: 'orders',
    timeoutMs: 5000,
    withFreshness: true,
    planStrategy: 'scan',
  });
});

// --- G3: the agent bridge forwards the dropped options -----------------------

test('agent-bridge executeSQL forwards formationId, timeoutMs and planStrategy', async () => {
  let seenSql = '';
  let seenOpts: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
    },
    sql: {
      query: async (q: string, o?: Record<string, unknown>): Promise<SqlResult> => {
        seenSql = q;
        seenOpts = o;
        return { columns: [], rows: [], rowCount: 0, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: SQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: {
        input: {
          sql: 'SELECT 1 AS n',
          formationId: 'orders',
          timeoutMs: 4000,
          planStrategy: 'scan',
        },
      },
    }),
  });

  assert.equal(seenSql, 'SELECT 1 AS n');
  assert.equal(seenOpts?.['formationId'], 'orders');
  assert.equal(seenOpts?.['timeoutMs'], 4000);
  assert.equal(seenOpts?.['planStrategy'], 'scan');
});

test('agent-bridge executeSQL FORWARDS an invalid planStrategy to the host (loud reject, never silent omission)', async () => {
  // The agent's GraphQL variables are untyped JSON, so an invalid planStrategy
  // can arrive. The bridge must FORWARD it verbatim so the host validator
  // (ValidatePlanStrategy) rejects it with a bad_request -- it must NOT convert
  // an explicit invalid value into omission (which would silently run the
  // formation-default planner, a PR 5.3 silent substitution). This inverts the
  // prior test that codified that defect.
  let seen: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
    },
    sql: {
      query: async (_q: string, o?: Record<string, unknown>): Promise<SqlResult> => {
        seen = o;
        return { columns: [], rows: [], rowCount: 0, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: SQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: { input: { sql: 'SELECT 1', planStrategy: 'standard' } },
    }),
  });

  // 'standard' is invalid, but it was EXPLICITLY supplied -- it reaches the host
  // (which rejects it) rather than being dropped. Here the mock host records the
  // forwarded value; against the real host this is a bad_request.
  assert.equal(seen?.['planStrategy'], 'standard');
});

test('agent-bridge executeSQL forwards an empty-string planStrategy (host rejects; not silently omitted)', async () => {
  let seen: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
    },
    sql: {
      query: async (_q: string, o?: Record<string, unknown>): Promise<SqlResult> => {
        seen = o;
        return { columns: [], rows: [], rowCount: 0, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: SQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: { input: { sql: 'SELECT 1', planStrategy: '' } },
    }),
  });

  // Empty string is a PRESENT value (an explicit selection), which the host
  // rejects (ValidatePlanStrategy: an explicit value cannot be empty). It must
  // be forwarded, not treated as omission.
  assert.equal('planStrategy' in (seen ?? {}), true);
  assert.equal(seen?.['planStrategy'], '');
});

test('agent-bridge executeSQL OMITS planStrategy only when genuinely absent (host default)', async () => {
  let seen: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
    },
    sql: {
      query: async (_q: string, o?: Record<string, unknown>): Promise<SqlResult> => {
        seen = o;
        return { columns: [], rows: [], rowCount: 0, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: SQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: { input: { sql: 'SELECT 1' } },
    }),
  });

  assert.equal('planStrategy' in (seen ?? {}), false);
});

test('agent-bridge listDroplets forwards scopeValue (semantic entity narrowing)', async () => {
  let seenOpts: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async (f: string, o?: Record<string, unknown>) => {
        void f;
        seenOpts = o;
        return { droplets: [], hasMore: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ListDroplets($input: ListDropletsInput!) { listDroplets(input: $input) { droplets { dropletId } } }',
      variables: { input: { formationId: 'notes', scopeValue: 'note-42', pageSize: 10 } },
    }),
  });

  assert.equal(seenOpts?.['scopeValue'], 'note-42', 'scopeValue must reach the native binding');
  assert.equal(seenOpts?.['first'], 10);
});

test('agent-bridge listKeys forwards last/before (descending), not a phantom orderByDesc', async () => {
  let seenOpts: CursorPaginationOpts | undefined;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
      listKeys: async (f: string, i: string, o?: CursorPaginationOpts) => {
        void f;
        void i;
        seenOpts = o;
        return { keys: [], nextCursor: null, hasMore: false, totalCount: 0 };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ListKeys($input: ListKeysInput!) { listKeys(input: $input) { keys { key } } }',
      variables: {
        input: { formationId: 'notes', indexId: 'by-id-latest', last: 20, before: 'cursor-x' },
      },
    }),
  });

  assert.equal(seenOpts?.last, 20, 'last (descending page size) must be forwarded');
  assert.equal(seenOpts?.before, 'cursor-x', 'before (descending cursor) must be forwarded');
  assert.equal('orderByDesc' in (seenOpts ?? {}), false, 'no phantom orderByDesc field');
});

test('agent-bridge listKeys FALLS THROUGH to GraphQL when maxKeys is supplied (native cannot honor it)', async () => {
  // The native listKeys binding has no maxKeys accumulation target. Silently
  // dropping a supplied maxKeys would reduce the requested semantics (R2), so
  // the interception must fall through to ctx.fetch (the real GraphQL route).
  let ctxFetchCalled = false;
  let nativeCalled = false;
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
      listKeys: async () => {
        nativeCalled = true;
        return { keys: [], nextCursor: null, hasMore: false, totalCount: 0 };
      },
    },
    fetch: async () => {
      ctxFetchCalled = true;
      return {
        status: 200, ok: true, headers: {},
        body: '{"data":{"listKeys":{"keys":[]}}}',
        text: () => '{"data":{"listKeys":{"keys":[]}}}',
        json: () => ({ data: { listKeys: { keys: [] } } }),
      };
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ListKeys($input: ListKeysInput!) { listKeys(input: $input) { keys { key } } }',
      variables: { input: { formationId: 'notes', indexId: 'by-id-latest', maxKeys: 5, first: 2 } },
    }),
  });

  assert.equal(nativeCalled, false, 'native binding must NOT be used when maxKeys is present');
  assert.equal(ctxFetchCalled, true, 'must fall through to the GraphQL route that honors maxKeys');
});

test('agent-bridge listKeys projects native RFC3339 lastModified to the GraphQL Time number', async () => {
  // The native KeyEntry.lastModified is an RFC3339 STRING; the GraphQL contract
  // is Time! (Unix-ms NUMBER). Intercepting a GraphQL op must return the number,
  // not the native string (R2). Malformed -> null, never a silent 0.
  const iso = '2026-09-10T00:00:00.000Z';
  const expectedMs = Date.parse(iso);
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
      listKeys: async () => ({
        keys: [
          { key: 'k1', size: 10, lastModified: iso, etag: 'e1' },
          { key: 'k2', size: 20, lastModified: '' },
        ],
        nextCursor: null,
        hasMore: false,
        totalCount: 2,
      }),
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ListKeys($input: ListKeysInput!) { listKeys(input: $input) { keys { key lastModified } } }',
      variables: { input: { formationId: 'notes', indexId: 'by-id-latest', first: 10 } },
    }),
  });
  const body = (await resp.json()) as {
    data: { listKeys: { keys: Array<{ key: string; lastModified: number | null; etag?: string }> } };
  };
  const keys = body.data.listKeys.keys;
  assert.equal(keys[0]?.lastModified, expectedMs, 'RFC3339 string -> Unix-ms number');
  assert.equal(typeof keys[0]?.lastModified, 'number');
  assert.equal(keys[0]?.etag, 'e1', 'etag preserved');
  assert.equal(keys[1]?.lastModified, null, 'empty timestamp -> null, not 0');
});
