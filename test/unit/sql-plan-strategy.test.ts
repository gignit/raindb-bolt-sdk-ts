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

test('agent-bridge executeSQL ignores an invalid planStrategy (host would reject; JS never fabricates)', async () => {
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

  // 'standard' is not one of the two valid values; the bridge only forwards a
  // recognized 'range'|'scan', so the key is absent and the host applies the
  // formation default (rather than the JS forwarding a value the host rejects).
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
