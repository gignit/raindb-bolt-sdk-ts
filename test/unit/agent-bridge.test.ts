// test/unit/agent-bridge.test.ts -- coverage for makeBoltNativeHost.
//
// Per handoff §I acceptance criteria 2-4: the host's fetch must
// (a) intercept substrate-operation GraphQL queries and route them
// natively, (b) fall through to ctx.fetch for non-GraphQL URLs and
// non-substrate queries, (c) keep chatCompletion routing through
// ctx.fetch.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { setCtx } from '../../src/index.js';
import { makeBoltNativeHost } from '../../src/agent-bridge/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

test('agent-bridge fetch intercepts substrate readLatest GraphQL', async () => {
  let nativeCalled: { f?: string; i?: string; s?: string } = {};
  let ctxFetchCalled = false;

  const ctx = mockCtx({
    db: {
      readLatest: async (f: string, i: string, s: string) => {
        nativeCalled = { f, i, s };
        return {
          dropletId: 'd-1',
          formationId: f,
          schemaVersion: 1,
          ts: 1767225600000,
          author: 'agent',
          payload: { hello: 'world' },
        };
      },
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
    },
    fetch: async () => {
      ctxFetchCalled = true;
      return {
        status: 500,
        ok: false,
        headers: {},
        body: 'should not have been called',
        text: () => '',
        json: () => null,
      };
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query:
        'query ReadLatest($input: ReadLatestInput!) { readLatest(input: $input) { dropletId } }',
      variables: {
        input: {
          formationId: 'agent-graph',
          indexId: 'by-id-latest',
          scopeValue: 'a-1',
        },
      },
    }),
  });

  assert.equal(ctxFetchCalled, false, 'ctx.fetch should NOT be called');
  assert.deepEqual(nativeCalled, {
    f: 'agent-graph',
    i: 'by-id-latest',
    s: 'a-1',
  });
  assert.equal(resp.status, 200);
  assert.equal(resp.ok, true);
  const body = (await resp.json()) as {
    data: { readLatest: { dropletId: string } };
  };
  assert.equal(body.data.readLatest.dropletId, 'd-1');
});

test('agent-bridge fetch falls through for non-GraphQL URLs', async () => {
  let ctxFetchCalled = false;
  const ctx = mockCtx({
    fetch: async () => {
      ctxFetchCalled = true;
      return {
        status: 200,
        ok: true,
        headers: {},
        body: 'external',
        text: () => 'external',
        json: () => ({ ok: true }),
      };
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('https://api.openai.com/v1/chat/completions');
  assert.equal(ctxFetchCalled, true);
  assert.equal(resp.status, 200);
  const text = await resp.text();
  assert.equal(text, 'external');
});

test('agent-bridge fetch falls through for unknown GraphQL operation', async () => {
  let ctxFetchCalled = false;
  let warnFields: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    log: {
      info: () => {},
      warn: (_msg, fields) => {
        warnFields = fields;
      },
      error: () => {},
    },
    fetch: async () => {
      ctxFetchCalled = true;
      return {
        status: 200,
        ok: true,
        headers: {},
        body: '{"data":{"adminThing":null}}',
        text: () => '{"data":{"adminThing":null}}',
        json: () => ({ data: { adminThing: null } }),
      };
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query:
        'query AdminThing { adminThing { id } }',
      variables: {},
    }),
  });
  assert.equal(ctxFetchCalled, true);
  assert.ok(warnFields, 'fallthrough should log a warning');
  assert.equal(warnFields?.['reason'], 'no-native-binding');
});

test('agent-bridge fetch routes writeDroplet natively', async () => {
  let nativeCalled: { f?: string; p?: Record<string, unknown> } = {};
  const ctx = mockCtx({
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async (f: string, p: Record<string, unknown>) => {
        nativeCalled = { f, p };
        return { dropletId: 'd-new' };
      },
      listDroplets: async () => ({ droplets: [], hasMore: false }),
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query:
        'mutation WriteDroplet($input: WriteDropletInput!) { writeDroplet(input: $input) { dropletId } }',
      variables: {
        input: { formationId: 'agent-graph', payload: { agentId: 'a-1' } },
      },
    }),
  });
  assert.deepEqual(nativeCalled, {
    f: 'agent-graph',
    p: { agentId: 'a-1' },
  });
  const body = (await resp.json()) as {
    data: { writeDroplet: { dropletId: string } };
  };
  assert.equal(body.data.writeDroplet.dropletId, 'd-new');
});

// dbBase: the four required DbBinding methods so a `db` override can
// add just the method under test (BoltContext.db is non-partial).
const dbBase = {
  readLatest: async () => null,
  readDroplet: async () => null,
  writeDroplet: async () => ({ dropletId: 'x' }),
  listDroplets: async () => ({ droplets: [], hasMore: false }),
};

test('agent-bridge routes tagEntity natively (was self-looping via GraphQL)', async () => {
  let nativeCalled: { f?: string; s?: string; t?: unknown } = {};
  let ctxFetchCalled = false;
  const ctx = mockCtx({
    db: {
      ...dbBase,
      tag: async (f: string, s: string, tags: Record<string, string>) => {
        nativeCalled = { f, s, t: tags };
      },
    },
    fetch: async () => {
      ctxFetchCalled = true;
      return {
        status: 500, ok: false, headers: {},
        body: 'nope', text: () => 'nope', json: () => null,
      };
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query:
        'mutation TagEntity($input: TagEntityInput!) { tagEntity(input: $input) { success } }',
      variables: {
        input: { formationId: 'note', scopeValue: 'n-1', tags: { pinned: 'true' } },
      },
    }),
  });

  assert.equal(ctxFetchCalled, false, 'ctx.fetch must NOT be called');
  assert.deepEqual(nativeCalled, { f: 'note', s: 'n-1', t: { pinned: 'true' } });
  const body = (await resp.json()) as {
    data: { tagEntity: { success: boolean } };
  };
  assert.equal(body.data.tagEntity.success, true);
});

test('agent-bridge routes untagEntity natively', async () => {
  let nativeCalled: { f?: string; s?: string; k?: unknown } = {};
  const ctx = mockCtx({
    db: {
      ...dbBase,
      untag: async (f: string, s: string, tagKeys: string[]) => {
        nativeCalled = { f, s, k: tagKeys };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query:
        'mutation UntagEntity($input: UntagEntityInput!) { untagEntity(input: $input) { success } }',
      variables: { input: { formationId: 'note', scopeValue: 'n-1', tagKeys: ['pinned'] } },
    }),
  });
  assert.deepEqual(nativeCalled, { f: 'note', s: 'n-1', k: ['pinned'] });
  const body = (await resp.json()) as { data: { untagEntity: { success: boolean } } };
  assert.equal(body.data.untagEntity.success, true);
});

test('agent-bridge routes expireDroplet natively', async () => {
  let nativeCalled: { f?: string; s?: string } = {};
  const ctx = mockCtx({
    db: {
      ...dbBase,
      expire: async (f: string, s: string) => {
        nativeCalled = { f, s };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query:
        'mutation ExpireDroplet($input: ExpireDropletInput!) { expireDroplet(input: $input) { success } }',
      variables: { input: { formationId: 'note', scopeValue: 'n-1' } },
    }),
  });
  assert.deepEqual(nativeCalled, { f: 'note', s: 'n-1' });
  const body = (await resp.json()) as { data: { expireDroplet: { success: boolean } } };
  assert.equal(body.data.expireDroplet.success, true);
});

test('agent-bridge routes listKeys natively', async () => {
  let nativeCalled: { f?: string; i?: string } = {};
  const ctx = mockCtx({
    db: {
      ...dbBase,
      listKeys: async (f: string, i: string) => {
        nativeCalled = { f, i };
        return { keys: [{ key: 'k1', size: 10, lastModified: '2026-01-01T00:00:00Z' }], nextCursor: null, hasMore: false, totalCount: 1 };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ListKeys($input: ListKeysInput!) { listKeys(input: $input) { keys { key } } }',
      variables: { input: { formationId: 'note', indexId: 'by-id-latest', first: 50 } },
    }),
  });
  assert.deepEqual(nativeCalled, { f: 'note', i: 'by-id-latest' });
  const body = (await resp.json()) as {
    data: { listKeys: { keys: Array<{ key: string }> } };
  };
  assert.equal(body.data.listKeys.keys[0]?.key, 'k1');
});

test('agent-bridge routes executeSQL natively', async () => {
  let nativeSql = '';
  const ctx = mockCtx({
    db: { ...dbBase },
    sql: {
      query: async (q: string) => {
        nativeSql = q;
        return { columns: ['n'], rows: [{ n: 1 }], rowCount: 1, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: ExecuteSQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: { input: { sql: 'SELECT 1 AS n' } },
    }),
  });
  assert.equal(nativeSql, 'SELECT 1 AS n');
  const body = (await resp.json()) as { data: { executeSQL: { rowCount: number } } };
  assert.equal(body.data.executeSQL.rowCount, 1);
});

test('agent-bridge executeSQL requests freshness when a formationId is present', async () => {
  // The sql_execute tool offers the model the freshness/harvest signal for a
  // formation-scoped query, and the GraphQL surface returns SQLResult.latest[]
  // for one. The native ctx.sql.query binding gates the bookmark on an explicit
  // withFreshness opt (absent from the GraphQL variables), so the bridge turns
  // it on for a formation-scoped query to return the same latest[] a caller gets
  // on the Node/GraphQL host -- and ONLY then, since the bookmark costs reads.
  let capturedOpts: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: { ...dbBase },
    sql: {
      query: async (q: string, opts?: Record<string, unknown>) => {
        capturedOpts = opts;
        return {
          columns: ['n'],
          rows: [{ n: 1 }],
          rowCount: 1,
          durationMs: 1,
          truncated: false,
          latest: [
            {
              formationId: 'orders',
              snapshotDropletId: 'd1',
              snapshotKey: 'k1',
              currentDropletId: 'd1',
              currentKey: 'k1',
              indexPrefix: 'indexes/orders/by-update/',
              freshnessStatus: 'CURRENT',
            },
          ],
        };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  const resp = await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: ExecuteSQLInput!) { executeSQL(input: $input) { rowCount latest { freshnessStatus } } }',
      variables: { input: { sql: 'SELECT 1 AS n', formationId: 'orders' } },
    }),
  });
  assert.equal(capturedOpts?.['formationId'], 'orders');
  assert.equal(capturedOpts?.['withFreshness'], true);
  const body = (await resp.json()) as {
    data: { executeSQL: { latest?: Array<{ freshnessStatus: string }> } };
  };
  assert.equal(body.data.executeSQL.latest?.[0]?.freshnessStatus, 'CURRENT');
});

test('agent-bridge executeSQL does NOT request freshness for an unscoped query (no extra reads)', async () => {
  // Assembling the freshness bookmark costs real reads (the droplet-tier cursor
  // + the formation meta latest pointer). An unscoped query has no formationId,
  // and the sql_execute tool offers the model no freshness/harvest guidance for
  // an unscoped query, so the bridge must NOT request the bookmark -- it would
  // add hops the caller never reads. withFreshness stays unset (the native
  // default: no bookmark).
  let capturedOpts: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: { ...dbBase },
    sql: {
      query: async (_q: string, opts?: Record<string, unknown>) => {
        capturedOpts = opts;
        return { columns: ['n'], rows: [{ n: 1 }], rowCount: 1, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: ExecuteSQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: { input: { sql: 'SELECT count(*) AS n FROM entity."orders"' } },
    }),
  });
  assert.equal(capturedOpts?.['formationId'], undefined);
  assert.equal(capturedOpts?.['withFreshness'], undefined);
});

test('agent-bridge executeSQL honors an explicit withFreshness=false even with a formationId', async () => {
  // An explicit withFreshness in the variables wins over the formationId
  // default -- a caller that opts out stays opted out.
  let capturedOpts: Record<string, unknown> | undefined;
  const ctx = mockCtx({
    db: { ...dbBase },
    sql: {
      query: async (_q: string, opts?: Record<string, unknown>) => {
        capturedOpts = opts;
        return { columns: ['n'], rows: [{ n: 1 }], rowCount: 1, durationMs: 1, truncated: false };
      },
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  await host.fetch('http://localhost:8080/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: 'query ExecuteSQL($input: ExecuteSQLInput!) { executeSQL(input: $input) { rowCount } }',
      variables: { input: { sql: 'SELECT 1 AS n', formationId: 'orders', withFreshness: false } },
    }),
  });
  assert.equal(capturedOpts?.['formationId'], 'orders');
  assert.equal(capturedOpts?.['withFreshness'], false);
});

test('agent-bridge log surface delegates to ctx.log', () => {
  const events: string[] = [];
  const ctx = mockCtx({
    log: {
      info: (msg) => events.push(`info:${msg}`),
      warn: (msg) => events.push(`warn:${msg}`),
      error: (msg) => events.push(`error:${msg}`),
    },
  });
  setCtx(ctx);

  const host = makeBoltNativeHost(ctx);
  host.log.info('a');
  host.log.warn('b');
  host.log.error('c');
  assert.deepEqual(events, ['info:a', 'warn:b', 'error:c']);
});
