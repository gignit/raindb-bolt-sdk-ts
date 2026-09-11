// test/unit/v0_2-tier-1-swap.test.ts -- unit tests for the four
// stubs that were swapped to LIVE in v0.2.0:
//
//   - ctx.objects.{get,put,exists,delete}
//   - ctx.sql.query
//   - ctx.db.listKeys
//   - ctx.db.listSince
//
// Per handoff §L acceptance: each newly-LIVE binding gets at least
//   (1) a happy-path test (mock substrate returns the expected shape;
//       wrapper translates correctly),
//   (2) a capability-error test (mock substrate throws the canonical
//       capability-denial pattern; wrapper produces CapabilityDenied),
//   (3) a binding-missing test (substrate namespace absent; wrapper
//       throws BindingNotInstalled with the expected message hints).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  setCtx,
  objects,
  sql,
  isBehind,
  isFresh,
  needsHarvest,
  db,
  BindingNotInstalled,
  CapabilityDenied,
  RainDBBoltError,
} from '../../src/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

// ============================================================
// ctx.objects.* (audit §F Gap 1)
// ============================================================

test('objects.get forwards (bucket, key) and returns string payload', async () => {
  let captured: { b?: string; k?: string } = {};
  setCtx(
    mockCtx({
      objects: {
        get: async (b: string, k: string) => {
          captured = { b, k };
          return 'hello-bytes';
        },
        put: async () => {},
        exists: async () => false,
        delete: async () => {},
      },
    }),
  );
  const out = await objects.get('platform-public', 'a/b.json');
  assert.deepEqual(captured, { b: 'platform-public', k: 'a/b.json' });
  assert.equal(out, 'hello-bytes');
});

test('objects.get translates capability denial to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      objects: {
        get: async () => {
          throw new Error(
            'ctx.objects: object-read on formation "platform-public" not declared in capabilities',
          );
        },
        put: async () => {},
        exists: async () => false,
        delete: async () => {},
      },
    }),
  );
  await assert.rejects(
    () => objects.get('platform-public', 'spec.json'),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'object-read');
      assert.equal(
        (e as CapabilityDenied).formationId,
        'platform-public',
      );
      assert.equal(
        (e as CapabilityDenied).binding,
        'ctx.objects.get',
      );
      return true;
    },
  );
});

test('objects.get throws BindingNotInstalled when ctx.objects absent', async () => {
  setCtx(mockCtx()); // no objects field
  await assert.rejects(
    () => objects.get('platform-public', 'spec.json'),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match(
        (e as Error).message,
        /ctx\.objects\.get is not installed in this bolt runtime/,
      );
      assert.match((e as Error).message, /Check the operation's availability and required capabilities/);
      return true;
    },
  );
});

test('objects.put forwards (bucket, key, data, contentType) and returns void', async () => {
  const captured: { b?: string; k?: string; d?: unknown; c?: string } = {};
  setCtx(
    mockCtx({
      objects: {
        get: async () => '',
        put: async (b: string, k: string, d: Uint8Array | string, c?: string) => {
          captured.b = b;
          captured.k = k;
          captured.d = d;
          if (c !== undefined) captured.c = c;
        },
        exists: async () => false,
        delete: async () => {},
      },
    }),
  );
  await objects.put('tenant-standard', 'r.json', '{}', 'application/json');
  assert.equal(captured.b, 'tenant-standard');
  assert.equal(captured.k, 'r.json');
  assert.equal(captured.d, '{}');
  assert.equal(captured.c, 'application/json');
});

test('objects.put translates capability denial', async () => {
  setCtx(
    mockCtx({
      objects: {
        get: async () => '',
        put: async () => {
          throw new Error(
            'ctx.objects: object-write on formation "tenant-standard" not declared in capabilities',
          );
        },
        exists: async () => false,
        delete: async () => {},
      },
    }),
  );
  await assert.rejects(
    () => objects.put('tenant-standard', 'k', 'd'),
    (e: unknown) =>
      e instanceof CapabilityDenied &&
      (e as CapabilityDenied).op === 'object-write' &&
      (e as CapabilityDenied).formationId === 'tenant-standard',
  );
});

test('objects.exists returns boolean and forwards args', async () => {
  let called = false;
  setCtx(
    mockCtx({
      objects: {
        get: async () => '',
        put: async () => {},
        exists: async (b: string, k: string) => {
          assert.equal(b, 'tenant-standard');
          assert.equal(k, 'reports/today.json');
          called = true;
          return true;
        },
        delete: async () => {},
      },
    }),
  );
  assert.equal(await objects.exists('tenant-standard', 'reports/today.json'), true);
  assert.equal(called, true);
});

test('objects.exists throws BindingNotInstalled when ctx.objects absent', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => objects.exists('b', 'k'),
    (e: unknown) =>
      e instanceof BindingNotInstalled &&
      /ctx\.objects\.exists/.test((e as Error).message),
  );
});

test('objects.delete forwards args and returns void', async () => {
  let called: { b?: string; k?: string } = {};
  setCtx(
    mockCtx({
      objects: {
        get: async () => '',
        put: async () => {},
        exists: async () => false,
        delete: async (b: string, k: string) => {
          called = { b, k };
        },
      },
    }),
  );
  await objects.delete('tenant-standard', 'tmp/expired.bin');
  assert.deepEqual(called, { b: 'tenant-standard', k: 'tmp/expired.bin' });
});

test('objects.delete throws BindingNotInstalled when ctx.objects absent', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => objects.delete('b', 'k'),
    (e: unknown) => e instanceof BindingNotInstalled,
  );
});

// ============================================================
// ctx.sql.query (audit §H Gap 3)
// ============================================================

test('sql.query forwards (sql, opts) and returns named (column-keyed) rows', async () => {
  let capturedSql = '';
  let capturedOpts: { formationId?: string; timeoutMs?: number; withFreshness?: boolean } | undefined;
  setCtx(
    mockCtx({
      sql: {
        query: async (
          q: string,
          opts?: { formationId?: string; timeoutMs?: number; withFreshness?: boolean },
        ) => {
          capturedSql = q;
          capturedOpts = opts;
          // The substrate returns column-keyed object rows, IDENTICAL to
          // the GraphQL executeSQL shape (sqlResultToGQL / the bolt
          // adapter both zip duckdb positional rows into map[column]value).
          return {
            columns: ['n', 'name'],
            rows: [
              { n: 1, name: 'alice' },
              { n: 2, name: 'bob' },
            ],
            rowCount: 2,
            durationMs: 7,
            truncated: false,
          };
        },
      },
    }),
  );

  const result = await sql.query({
    sql: 'SELECT n, name FROM t',
    formationId: 'continuum',
    timeoutMs: 1000,
  });

  assert.equal(capturedSql, 'SELECT n, name FROM t');
  assert.equal(capturedOpts?.formationId, 'continuum');
  assert.equal(capturedOpts?.timeoutMs, 1000);
  // withFreshness was not provided -- the wrapper omits it rather
  // than forwarding `undefined` to keep the substrate's distinction
  // between "absent" and "false" clean.
  assert.equal(Object.prototype.hasOwnProperty.call(capturedOpts!, 'withFreshness'), false);

  assert.deepEqual(result.columns, ['n', 'name']);
  assert.equal(result.rowCount, 2);
  assert.equal(result.rows.length, 2);
  // Named row access -- the parity shape contract (matches executeSQL).
  assert.equal(result.rows[0]?.['n'], 1);
  assert.equal(result.rows[0]?.['name'], 'alice');
  assert.equal(result.rows[1]?.['name'], 'bob');
  // withFreshness was not requested, so the substrate omits latest.
  assert.equal(result.latest, undefined);
});

test('sql.query honors withFreshness option and tolerates absent latest field', async () => {
  let capturedOpts: { withFreshness?: boolean } | undefined;
  setCtx(
    mockCtx({
      sql: {
        query: async (_q, opts) => {
          capturedOpts = opts;
          return {
            columns: ['x'],
            rows: [{ x: 1 }],
            rowCount: 1,
            durationMs: 1,
            truncated: false,
            // The substrate omits latest when empty (no by-update index, or
            // withFreshness not honored for this formation). The wrapper must
            // pass that through as undefined, not fabricate an empty array.
          };
        },
      },
    }),
  );
  const r = await sql.query({ sql: 'SELECT 1', withFreshness: true });
  assert.equal(capturedOpts?.withFreshness, true);
  assert.equal(r.latest, undefined);
});

test('sql.query surfaces the populated freshness bookmark incl. freshnessStatus', async () => {
  setCtx(
    mockCtx({
      sql: {
        query: async () => ({
          columns: ['n'],
          rows: [{ n: 3 }],
          rowCount: 1,
          durationMs: 2,
          truncated: false,
          // Substrate returns the canonical bookmark incl. the server-computed
          // freshnessStatus verdict; the wrapper passes it through unchanged.
          latest: [
            {
              formationId: 'orders',
              snapshotDropletId: '019ff4a6',
              snapshotKey: 'tenants/T/indexes/orders/by-update/019ff4a6/latest.json',
              snapshotAt: 1786516211667,
              currentDropletId: '019ff522',
              currentKey: 'tenants/T/entities/orders/x/019ff522.json',
              indexPrefix: 'tenants/T/indexes/orders/by-update/',
              freshnessStatus: 'BEHIND',
            },
          ],
        }),
      },
    }),
  );
  const r = await sql.query({ sql: 'SELECT count(*) AS n FROM entity."orders"', withFreshness: true });
  assert.equal(r.latest?.length, 1);
  const bm = r.latest![0]!;
  assert.equal(bm.freshnessStatus, 'BEHIND');
  assert.equal(bm.currentDropletId, '019ff522');
  // The exported helpers read the verdict, not the raw cursors.
  assert.equal(isBehind(bm), true);
  assert.equal(isFresh(bm), false);
  assert.equal(needsHarvest(bm), true);
});

test('sql.query translates capability denial to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      sql: {
        query: async () => {
          throw new Error(
            'ctx.sql: sql-read on formation "_bolt" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () => sql.query({ sql: 'SELECT 1' }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'sql-read');
      assert.equal((e as CapabilityDenied).binding, 'ctx.sql.query');
      return true;
    },
  );
});

test('sql.query wraps unknown errors in RainDBBoltError', async () => {
  setCtx(
    mockCtx({
      sql: {
        query: async () => {
          throw new Error('duckdb panic');
        },
      },
    }),
  );
  await assert.rejects(
    () => sql.query({ sql: 'SELECT 1' }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.ok(!(e instanceof CapabilityDenied));
      assert.equal((e as RainDBBoltError).binding, 'ctx.sql.query');
      assert.match((e as Error).message, /duckdb panic/);
      return true;
    },
  );
});

test('sql.query throws BindingNotInstalled when ctx.sql absent', async () => {
  setCtx(mockCtx());
  await assert.rejects(
    () => sql.query({ sql: 'SELECT 1' }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.sql\.query is not installed in this bolt runtime/);
      assert.match((e as Error).message, /Check the operation's availability and required capabilities/);
      assert.match((e as Error).message, /sqlRead/);
      return true;
    },
  );
});

// ============================================================
// ctx.db.listKeys (audit §G Gap 2)
// ============================================================

test('db.listKeys forwards (formationId, indexId, opts) positionally', async () => {
  let called: { f?: string; i?: string; o?: unknown } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listKeys: async (f: string, i: string, o?: unknown) => {
          called = { f, i, o };
          return {
            keys: [
              { key: 'a/1', size: 12, lastModified: '2026-01-01T00:00:00Z' },
              { key: 'a/2', size: 34, lastModified: '2026-01-02T00:00:00Z', etag: 'abc' },
            ],
            hasMore: true,
            totalCount: 2,
            nextCursor: 'cur-1',
          };
        },
      },
    }),
  );
  const page = await db.listKeys({
    formationId: 'broadcast',
    indexId: 'by-id-latest',
    opts: { first: 100, after: 'prev', prefix: 'topic/' },
  });
  assert.equal(called.f, 'broadcast');
  assert.equal(called.i, 'by-id-latest');
  assert.deepEqual(called.o, { first: 100, after: 'prev', prefix: 'topic/' });
  assert.equal(page.keys.length, 2);
  assert.equal(page.keys[0]?.key, 'a/1');
  assert.equal(page.keys[1]?.etag, 'abc');
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'cur-1');
  assert.equal(page.totalCount, 2);
});

test('db.listKeys passes empty opts object when input.opts is absent', async () => {
  let capturedOpts: unknown;
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listKeys: async (_f, _i, o?: unknown) => {
          capturedOpts = o;
          return { keys: [], hasMore: false, totalCount: 0 };
        },
      },
    }),
  );
  const page = await db.listKeys({ formationId: 'f', indexId: 'i' });
  assert.deepEqual(capturedOpts, {});
  assert.equal(page.keys.length, 0);
});

test('db.listKeys translates capability denial', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listKeys: async () => {
          throw new Error(
            'ctx.db: list on formation "broadcast" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () => db.listKeys({ formationId: 'broadcast', indexId: 'by-id-latest' }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).op, 'list');
      assert.equal((e as CapabilityDenied).formationId, 'broadcast');
      assert.equal((e as CapabilityDenied).binding, 'ctx.db.listKeys');
      return true;
    },
  );
});

// (The "BindingNotInstalled when ctx.db.listKeys absent" test is
// already in binding-not-installed.test.ts via the default mockCtx
// which omits listKeys -- exercising the version-skew path.)

// ============================================================
// ctx.db.listSince (audit §G Gap 2)
// ============================================================

test('db.listSince forwards (formationId, sinceCursor, opts) and returns SincePage', async () => {
  let called: { f?: string; s?: string; o?: unknown } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listSince: async (f: string, s: string, o?: unknown) => {
          called = { f, s, o };
          return {
            droplets: [
              {
                dropletId: 'd-1',
                formationId: f,
                schemaVersion: 1,
                ts: 1767225600000,
                author: 'a',
                payload: { x: 1 },
              },
            ],
            hasMore: false,
            nextCursor: 'cur-2',
          };
        },
      },
    }),
  );
  const page = await db.listSince({
    formationId: 'broadcast',
    sinceCursor: 'cur-prev',
    opts: { first: 50 },
  });
  assert.equal(called.f, 'broadcast');
  assert.equal(called.s, 'cur-prev');
  assert.deepEqual(called.o, { first: 50 });
  assert.equal(page.droplets.length, 1);
  assert.equal(page.droplets[0]?.dropletId, 'd-1');
  assert.equal(page.hasMore, false);
  assert.equal(page.nextCursor, 'cur-2');
});

test('db.listSince accepts empty sinceCursor for "from beginning"', async () => {
  let capturedCursor = 'unset';
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listSince: async (_f, s: string) => {
          capturedCursor = s;
          return { droplets: [], hasMore: false };
        },
      },
    }),
  );
  const page = await db.listSince({ formationId: 'f', sinceCursor: '' });
  assert.equal(capturedCursor, '');
  assert.equal(page.droplets.length, 0);
  assert.equal(page.hasMore, false);
});

test('db.listSince translates capability denial', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listSince: async () => {
          throw new Error(
            'ctx.db: list on formation "broadcast" not declared in capabilities',
          );
        },
      },
    }),
  );
  await assert.rejects(
    () => db.listSince({ formationId: 'broadcast', sinceCursor: '' }),
    (e: unknown) =>
      e instanceof CapabilityDenied &&
      (e as CapabilityDenied).op === 'list' &&
      (e as CapabilityDenied).binding === 'ctx.db.listSince',
  );
});

test('db.listSince throws BindingNotInstalled on runtime without the binding', async () => {
  setCtx(mockCtx()); // omits listSince
  await assert.rejects(
    () => db.listSince({ formationId: 'f', sinceCursor: '' }),
    (e: unknown) => {
      assert.ok(e instanceof BindingNotInstalled);
      assert.match((e as Error).message, /ctx\.db\.listSince/);
      assert.match((e as Error).message, /Check the operation's availability and required capabilities/);
      return true;
    },
  );
});

// --------------------- sql.queryEntityRowsFresh (row-list freshness merge) ---

test('queryEntityRowsFresh merges the not-yet-pooled tail (newest wins, deduped by scopeKey)', async () => {
  setCtx(
    mockCtx({
      sql: {
        // SQL snapshot is BEHIND: it has e1 (old title) but not e2, and its e1
        // is a stale revision.
        query: async () => ({
          columns: ['entryId', 'title'],
          rows: [{ entryId: 'e1', title: 'e1-OLD' }],
          rowCount: 1,
          durationMs: 1,
          truncated: false,
          latest: [
            {
              formationId: 'ff-journal',
              snapshotDropletId: 'd-snap',
              snapshotKey: 'k',
              // The current watermark is the newest tail droplet (d3): a complete
              // harvest observes it, satisfying the Follow-up B coverage check.
              currentDropletId: 'd3',
              currentKey: 'k2',
              indexPrefix: 'indexes/ff-journal/by-update/',
              freshnessStatus: 'BEHIND',
            },
          ],
        }),
      },
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        // The tail after the snapshot cursor: a newer e1 revision + a brand-new e2.
        // listSince is asc (oldest-first); the last droplet is the watermark d3.
        listSince: async (_f: string, _cursor: string) => ({
          droplets: [
            { dropletId: 'd2', formationId: 'ff-journal', schemaVersion: 1, ts: 2, author: 'a', payload: { entryId: 'e1', title: 'e1-NEW' } },
            { dropletId: 'd3', formationId: 'ff-journal', schemaVersion: 1, ts: 3, author: 'a', payload: { entryId: 'e2', title: 'e2' } },
          ],
          hasMore: false,
        }),
      },
    }),
  );

  const r = await sql.queryEntityRowsFresh({
    sql: 'SELECT entryId, title FROM entity."ff-journal"',
    formationId: 'ff-journal',
    scopeKey: 'entryId',
  });
  // e2 (newest late) leads, then the FRESH e1 (late revision supersedes the stale
  // snapshot row), and the stale snapshot e1-OLD is gone.
  assert.deepEqual(r.rows, [
    { entryId: 'e2', title: 'e2' },
    { entryId: 'e1', title: 'e1-NEW' },
  ]);
});

test('queryEntityRowsFresh is a passthrough when the snapshot is CURRENT (no harvest)', async () => {
  let listSinceCalled = false;
  setCtx(
    mockCtx({
      sql: {
        query: async () => ({
          columns: ['entryId'],
          rows: [{ entryId: 'e1' }],
          rowCount: 1,
          durationMs: 1,
          truncated: false,
          latest: [
            {
              formationId: 'ff-journal',
              snapshotDropletId: 'd',
              snapshotKey: 'k',
              currentDropletId: 'd',
              currentKey: 'k',
              indexPrefix: 'indexes/ff-journal/by-update/',
              freshnessStatus: 'CURRENT',
            },
          ],
        }),
      },
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listSince: async () => {
          listSinceCalled = true;
          return { droplets: [], hasMore: false };
        },
      },
    }),
  );
  const r = await sql.queryEntityRowsFresh({ sql: 'SELECT entryId FROM entity."ff-journal"', formationId: 'ff-journal' });
  assert.equal(listSinceCalled, false); // CURRENT -> no harvest
  assert.deepEqual(r.rows, [{ entryId: 'e1' }]);
});

test('queryEntityRowsFresh FAILS LOUD on harvest error (never returns stale)', async () => {
  setCtx(
    mockCtx({
      sql: {
        query: async () => ({
          columns: ['entryId'],
          rows: [{ entryId: 'e1' }],
          rowCount: 1,
          durationMs: 1,
          truncated: false,
          latest: [
            {
              formationId: 'ff-journal',
              snapshotDropletId: 'd',
              snapshotKey: 'k',
              currentDropletId: 'd2',
              currentKey: 'k2',
              indexPrefix: 'indexes/ff-journal/by-update/',
              freshnessStatus: 'BEHIND',
            },
          ],
        }),
      },
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
        listSince: async () => {
          throw new Error('S3 unavailable');
        },
      },
    }),
  );
  await assert.rejects(
    () => sql.queryEntityRowsFresh({ sql: 'SELECT entryId FROM entity."ff-journal"', formationId: 'ff-journal' }),
    (e: unknown) => e instanceof RainDBBoltError && /harvest failed/.test((e as Error).message),
  );
});

// --- Follow-up B (R3): the helper must not return the base as "fresh" without
// establishing bookmark coverage, tail completeness, or valid row identity. ---

function freshCtx(overrides: {
  latest?: unknown[];
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  listSince?: (...args: unknown[]) => Promise<unknown>;
}) {
  return mockCtx({
    sql: {
      query: async () => ({
        columns: overrides.columns ?? ['entryId'],
        rows: overrides.rows ?? [{ entryId: 'e1' }],
        rowCount: (overrides.rows ?? [{ entryId: 'e1' }]).length,
        durationMs: 1,
        truncated: false,
        latest: (overrides.latest ?? []) as never,
      }),
    },
    db: {
      readLatest: async () => null,
      readDroplet: async () => null,
      writeDroplet: async () => ({ dropletId: 'x' }),
      listDroplets: async () => ({ droplets: [], hasMore: false }),
      listSince: (overrides.listSince ?? (async () => ({ droplets: [], hasMore: false }))) as never,
    },
  });
}

test('queryEntityRowsFresh REJECTS when there is NO bookmark coverage (absence of evidence != CURRENT)', async () => {
  // Empty latest[] means the server produced no freshness evidence. A *Fresh
  // method must not treat "no bookmark" as "confirmed current".
  setCtx(freshCtx({ latest: [] }));
  await assert.rejects(
    () => sql.queryEntityRowsFresh({ sql: 'SELECT entryId FROM entity."ff-journal"', formationId: 'ff-journal', scopeKey: 'entryId' }),
    (e: unknown) => e instanceof RainDBBoltError && /coverage|bookmark|freshness/i.test((e as Error).message),
  );
});

test('queryEntityRowsFresh REJECTS a BEHIND bookmark whose tail never reaches the current watermark', async () => {
  // BEHIND: the snapshot cursor (d-100) is chronologically BEFORE the current
  // watermark (d-900) -- dropletIds are UUIDv7, lexicographic == chronological.
  // The harvest returns an empty page with hasMore:false, so maxSeen stays at
  // the snapshot cursor and never reaches d-900 -> coverage is unproven. The old
  // code returned the stale base on late.length===0.
  setCtx(freshCtx({
    latest: [{
      formationId: 'ff-journal', snapshotDropletId: 'd-100', snapshotKey: 'k',
      currentDropletId: 'd-900', currentKey: 'k2',
      indexPrefix: 'indexes/ff-journal/by-update/', freshnessStatus: 'BEHIND',
    }],
    listSince: async () => ({ droplets: [], hasMore: false }),
  }));
  await assert.rejects(
    () => sql.queryEntityRowsFresh({ sql: 'SELECT entryId FROM entity."ff-journal"', formationId: 'ff-journal', scopeKey: 'entryId' }),
    (e: unknown) => e instanceof RainDBBoltError && /watermark|coverage|caught up|current/i.test((e as Error).message),
  );
});

test('queryEntityRowsFresh does NOT accept a premature empty page (hasMore:true) as complete; continues the walk', async () => {
  // An empty page with hasMore:true is a transient gap, NOT "caught up". The old
  // code broke the loop on droplets.length===0 even with hasMore:true, so it
  // stopped early and (via late.length===0) returned the stale base. The fix
  // must CONTINUE the walk to the next page, which here reaches the watermark.
  let calls = 0;
  setCtx(freshCtx({
    columns: ['entryId', 'title'],
    rows: [{ entryId: 'e1', title: 'e1-OLD' }],
    latest: [{
      formationId: 'ff-journal', snapshotDropletId: 'd-snap', snapshotKey: 'k',
      currentDropletId: 'd-cur', currentKey: 'k2',
      indexPrefix: 'indexes/ff-journal/by-update/', freshnessStatus: 'BEHIND',
    }],
    listSince: async () => {
      calls += 1;
      if (calls === 1) {
        // Transient empty page WITH more to come -- must not terminate here.
        return { droplets: [], nextCursor: 'c1', hasMore: true };
      }
      // Second page reaches the watermark d-cur with a valid identity.
      return {
        droplets: [
          { dropletId: 'd-cur', formationId: 'ff-journal', schemaVersion: 1, ts: 3, author: 'a', payload: { entryId: 'e1', title: 'e1-NEW' } },
        ],
        hasMore: false,
      };
    },
  }));
  const r = await sql.queryEntityRowsFresh({ sql: 'SELECT entryId, title FROM entity."ff-journal"', formationId: 'ff-journal', scopeKey: 'entryId' });
  // Continued past the empty page, harvested the fresh e1.
  assert.ok(calls >= 2, 'must continue past a premature empty page');
  assert.deepEqual(r.rows, [{ entryId: 'e1', title: 'e1-NEW' }]);
});

test('queryEntityRowsFresh REJECTS a late row missing the identity value (cannot dedup null-key rows)', async () => {
  // The tail contains a droplet whose payload lacks the scopeKey. Projection
  // null-fills it, and the old Map merged unrelated null-key rows. The identity
  // must be validated as non-null before dedup.
  setCtx(freshCtx({
    columns: ['entryId', 'title'],
    rows: [{ entryId: 'e1', title: 'old' }],
    latest: [{
      formationId: 'ff-journal', snapshotDropletId: 'd-snap', snapshotKey: 'k',
      currentDropletId: 'd-cur', currentKey: 'k2',
      indexPrefix: 'indexes/ff-journal/by-update/', freshnessStatus: 'BEHIND',
    }],
    listSince: async () => ({
      droplets: [
        // reaches the watermark (dropletId d-cur) so coverage is satisfied,
        // but this payload has NO entryId -> null identity.
        { dropletId: 'd-cur', formationId: 'ff-journal', schemaVersion: 1, ts: 2, author: 'a', payload: { title: 'no-id' } },
      ],
      hasMore: false,
    }),
  }));
  await assert.rejects(
    () => sql.queryEntityRowsFresh({ sql: 'SELECT entryId, title FROM entity."ff-journal"', formationId: 'ff-journal', scopeKey: 'entryId' }),
    (e: unknown) => e instanceof RainDBBoltError && /identity|scopeKey|null/i.test((e as Error).message),
  );
});

test('queryEntityRowsFresh SUCCEEDS when the tail reaches the current watermark with valid identities', async () => {
  // Positive control: BEHIND, the harvest observes d-cur, and every late row has
  // a non-null entryId -> the merge proceeds and returns fresh rows.
  setCtx(freshCtx({
    columns: ['entryId', 'title'],
    rows: [{ entryId: 'e1', title: 'e1-OLD' }],
    latest: [{
      formationId: 'ff-journal', snapshotDropletId: 'd-snap', snapshotKey: 'k',
      currentDropletId: 'd-cur', currentKey: 'k2',
      indexPrefix: 'indexes/ff-journal/by-update/', freshnessStatus: 'BEHIND',
    }],
    listSince: async () => ({
      droplets: [
        { dropletId: 'd2', formationId: 'ff-journal', schemaVersion: 1, ts: 2, author: 'a', payload: { entryId: 'e1', title: 'e1-NEW' } },
        { dropletId: 'd-cur', formationId: 'ff-journal', schemaVersion: 1, ts: 3, author: 'a', payload: { entryId: 'e2', title: 'e2' } },
      ],
      hasMore: false,
    }),
  }));
  const r = await sql.queryEntityRowsFresh({ sql: 'SELECT entryId, title FROM entity."ff-journal"', formationId: 'ff-journal', scopeKey: 'entryId' });
  assert.deepEqual(r.rows, [
    { entryId: 'e2', title: 'e2' },
    { entryId: 'e1', title: 'e1-NEW' },
  ]);
});
