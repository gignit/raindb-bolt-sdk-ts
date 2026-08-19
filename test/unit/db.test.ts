// test/unit/db.test.ts -- unit tests for ctx.db.* wrappers.
//
// Coverage per handoff §L acceptance: at least one happy-path test
// and one error-translation test per wrapper. STUBs additionally
// covered by binding-not-installed.test.ts.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { db, setCtx, CapabilityDenied, RainDBBoltError } from '../../src/index.js';
import type { CursorPaginationOpts } from '../../src/index.js';
import { _resetCtxForTest } from '../../src/runtime/ctx-resolver.js';
import { mockCtx } from './_helpers.js';

beforeEach(() => {
  _resetCtxForTest();
});

// ----------------------------- readLatest -----------------------------

test('db.readLatest forwards positional args and returns droplet', async () => {
  let called: { f?: string; i?: string; s?: string } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async (f: string, i: string, s: string) => {
          called = { f, i, s };
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
    }),
  );

  const out = await db.readLatest({
    formationId: 'agent-graph',
    indexId: 'by-id-latest',
    scopeValue: 'a-1',
  });
  assert.deepEqual(called, {
    f: 'agent-graph',
    i: 'by-id-latest',
    s: 'a-1',
  });
  assert.equal(out?.dropletId, 'd-1');
  assert.equal(out?.formationId, 'agent-graph');
});

test('db.readLatest returns null when substrate returns null', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
      },
    }),
  );
  const out = await db.readLatest({
    formationId: 'f',
    indexId: 'i',
    scopeValue: 's',
  });
  assert.equal(out, null);
});

test('db.readLatest translates capability error to CapabilityDenied', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => {
          throw new Error(
            'ctx.db: read on formation "agent-graph" not declared in capabilities',
          );
        },
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
      },
    }),
  );

  await assert.rejects(
    () =>
      db.readLatest({
        formationId: 'agent-graph',
        indexId: 'by-id-latest',
        scopeValue: 'a-1',
      }),
    (e: unknown) => {
      assert.ok(e instanceof CapabilityDenied);
      assert.equal((e as CapabilityDenied).formationId, 'agent-graph');
      assert.equal((e as CapabilityDenied).op, 'read');
      assert.equal((e as CapabilityDenied).binding, 'ctx.db.readLatest');
      return true;
    },
  );
});

test('db.readLatest wraps unknown error in RainDBBoltError', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => {
          throw new Error('S3 unreachable');
        },
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
      },
    }),
  );

  await assert.rejects(
    () =>
      db.readLatest({
        formationId: 'f',
        indexId: 'i',
        scopeValue: 's',
      }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.ok(!(e instanceof CapabilityDenied));
      assert.equal((e as RainDBBoltError).binding, 'ctx.db.readLatest');
      assert.match((e as RainDBBoltError).message, /S3 unreachable/);
      return true;
    },
  );
});

// ----------------------------- readDroplet -----------------------------

test('db.readDroplet forwards args and returns droplet', async () => {
  let called: { f?: string; d?: string } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async (f: string, d: string) => {
          called = { f, d };
          return {
            dropletId: d,
            formationId: f,
            schemaVersion: 1,
            ts: 1767225600000,
            author: 'agent',
            payload: null,
          };
        },
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async () => ({ droplets: [], hasMore: false }),
      },
    }),
  );

  const out = await db.readDroplet({
    formationId: 'agent-graph',
    dropletId: 'd-1',
  });
  assert.deepEqual(called, { f: 'agent-graph', d: 'd-1' });
  assert.equal(out?.dropletId, 'd-1');
});

// ----------------------------- writeDroplet -----------------------------

test('db.writeDroplet forwards args and returns envelope', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async (f: string, p: Record<string, unknown>) => {
          assert.equal(f, 'agent-graph');
          assert.deepEqual(p, { agentId: 'a-1' });
          return { dropletId: 'd-new' };
        },
        listDroplets: async () => ({ droplets: [], hasMore: false }),
      },
    }),
  );

  const out = await db.writeDroplet({
    formationId: 'agent-graph',
    payload: { agentId: 'a-1' },
  });
  assert.equal(out.dropletId, 'd-new');
});

test('db.writeDroplet throws when substrate returns wrong shape', async () => {
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        // simulating a broken substrate that returns object with no
        // dropletId field. The wrapper's defensive check should fire.
        writeDroplet: async () =>
          ({ wrong: 'shape' }) as unknown as { dropletId: string },
        listDroplets: async () => ({ droplets: [], hasMore: false }),
      },
    }),
  );

  await assert.rejects(
    () =>
      db.writeDroplet({
        formationId: 'f',
        payload: {},
      }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.match(
        (e as RainDBBoltError).message,
        /did not return dropletId string/,
      );
      return true;
    },
  );
});

// ----------------------------- listDroplets -----------------------------

test('db.listDroplets forwards args and returns array', async () => {
  let called: { f?: string; o?: CursorPaginationOpts | undefined } = {};
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        listDroplets: async (f: string, o?: CursorPaginationOpts) => {
          called = { f, o };
          return {
            droplets: [
              {
                dropletId: 'd-1',
                formationId: f,
                schemaVersion: 1,
                ts: 1767225600000,
                author: 'agent',
                payload: null,
              },
            ],
            hasMore: false,
          };
        },
      },
    }),
  );

  const out = await db.listDroplets({
    formationId: 'broadcast',
    prefix: 'topic/',
    pageSize: 25,
  });
  assert.equal(called.f, 'broadcast');
  assert.deepEqual(called.o, { first: 25, prefix: 'topic/' });
  assert.equal(out.droplets.length, 1);
  assert.equal(out.droplets[0]?.dropletId, 'd-1');
});

// ----------------------------- versionHistory -----------------------------

test('db.versionHistory returns revisions newest-first (built on listDroplets)', async () => {
  let listPrefix: string | undefined;
  setCtx(
    mockCtx({
      db: {
        readLatest: async () => null,
        readDroplet: async () => null,
        writeDroplet: async () => ({ dropletId: 'x' }),
        // Two revisions of one entity, returned oldest-first by the substrate;
        // versionHistory must sort them newest-first by ts.
        listDroplets: async (formationId: string, opts: CursorPaginationOpts) => {
          listPrefix = opts.prefix;
          return {
            droplets: [
              { dropletId: 'd-old', formationId, schemaVersion: 1, ts: 1000, author: 'a', payload: { v: 1 } },
              { dropletId: 'd-new', formationId, schemaVersion: 1, ts: 2000, author: 'a', payload: { v: 2 } },
            ],
            hasMore: false,
          };
        },
      },
    }),
  );

  const history = await db.versionHistory({ formationId: 'notes', scopeValue: 'e-1' });
  assert.equal(history.length, 2);
  assert.equal(history[0]?.dropletId, 'd-new'); // newest first
  assert.equal(history[1]?.dropletId, 'd-old');
  assert.deepEqual(history[0]?.payload, { v: 2 });
  assert.equal(listPrefix, 'e-1/'); // walked the entity prefix
});

// ----------------------------- ambient setup -----------------------------

test('db.readLatest throws when setCtx not called', async () => {
  // _resetCtxForTest already ran in beforeEach; do not setCtx.
  await assert.rejects(
    () =>
      db.readLatest({
        formationId: 'f',
        indexId: 'i',
        scopeValue: 's',
      }),
    (e: unknown) => {
      assert.ok(e instanceof RainDBBoltError);
      assert.match((e as Error).message, /setCtx/);
      return true;
    },
  );
});
